namespace Surround.Engine.Dsp;

/// <summary>
/// One speaker's route inside a sink: mix row, gain, device channel (0-based) and delay; optionally an LR4 high-pass,
/// a share of the engine's bass bus (bass receivers) and a 10-band EQ.
/// </summary>
public sealed record SpeakerRoute(string Name, int DeviceChannel, float[] MixRow, double GainDb, bool Mute, int DelaySamples,
    double HighPassHz = 0, float BassShare = 0, double[]? Eq = null, IReadOnlyList<Config.PeqBand>? Peq = null,
    IReadOnlyList<Config.PeqBand>? RoomEq = null);

/// <summary>
/// Builds device-channel frames from logical frames (7.1 + height lanes) and pushes them into the sink's ring buffer. Producer side only.
/// Per speaker: (mix row × gain + bass share) → EQ → high-pass → delay; then the optional device limiter.
/// </summary>
public sealed class SinkMixer
{
    private const int EqZ = EqDesign.StagesWithPeq * 2;

    private readonly int _devCh, _fs;
    private readonly int[][] _idx;
    private readonly float[][] _coef;
    private readonly int[] _outCh;
    private readonly int[] _routeOf; // active speaker → index in the constructor's route list
    private readonly float[] _bassShare;
    private readonly LinkwitzRiley?[] _hp;
    private readonly DelayLine[] _delay;
    private readonly double[][] _eqZ;
    private readonly PeakLimiter? _limiter;
    private volatile BiquadCoefs[]?[] _eq;
    private BiquadCoefs[]?[]? _eqApplied;
    private float[] _scratch = new float[8192];

    public SinkMixer(int deviceChannels, IReadOnlyList<SpeakerRoute> speakers, int sampleRate = 48000, PeakLimiter? limiter = null)
    {
        _devCh = deviceChannels;
        _fs = sampleRate;
        _limiter = limiter;
        int n = 0;
        foreach (var s in speakers) if (!s.Mute) n++;
        _idx = new int[n][]; _coef = new float[n][]; _outCh = new int[n]; _delay = new DelayLine[n];
        _routeOf = new int[n]; _bassShare = new float[n]; _hp = new LinkwitzRiley?[n]; _eqZ = new double[n][];
        var eq = new BiquadCoefs[]?[n];
        int k = 0;
        for (int r = 0; r < speakers.Count; r++)
        {
            var s = speakers[r];
            if (s.Mute) continue;
            if (s.DeviceChannel < 0 || s.DeviceChannel >= deviceChannels)
                throw new ArgumentOutOfRangeException(nameof(speakers), $"{s.Name}: device channel out of range");
            float g = (float)Math.Pow(10.0, s.GainDb / 20.0);
            var idx = new List<int>(); var coef = new List<float>();
            for (int c = 0; c < Channels.Count && c < s.MixRow.Length; c++)
                if (s.MixRow[c] != 0f) { idx.Add(c); coef.Add(s.MixRow[c] * g); }
            _idx[k] = idx.ToArray(); _coef[k] = coef.ToArray();
            _outCh[k] = s.DeviceChannel;
            _delay[k] = new DelayLine(s.DelaySamples);
            _routeOf[k] = r;
            // The bass bus already carries the cut speakers' own gains, so the receiver's gain is not applied to it.
            _bassShare[k] = s.BassShare;
            _hp[k] = s.HighPassHz > 0 ? LinkwitzRiley.HighPass(sampleRate, s.HighPassHz) : null;
            _eqZ[k] = new double[EqZ];
            eq[k] = BuildEq(s.Eq, s.Peq, s.RoomEq);
            k++;
        }
        _eq = eq;
    }

    public int DeviceChannels => _devCh;

    /// <summary>Extra latency added by the limiter (same for every sink at one source rate).</summary>
    public int LatencyFrames => _limiter?.LatencyFrames ?? 0;

    public bool LimiterEnabled
    {
        get => _limiter?.Enabled ?? false;
        set { if (_limiter != null) _limiter.Enabled = value; }
    }

    private BiquadCoefs[]? BuildEq(double[]? gainsDb, IReadOnlyList<Config.PeqBand>? peq, IReadOnlyList<Config.PeqBand>? roomEq)
    {
        if (gainsDb is null && (peq is null || peq.Count == 0) && (roomEq is null || roomEq.Count == 0)) return null;
        var st = EqDesign.TenBandWithPeq(_fs, gainsDb, peq, roomEq);
        return EqDesign.IsFlat(st) ? null : st;
    }

    /// <summary>Per-speaker EQ state for live updates: 10-band gains and parametric bands (either may be null).</summary>
    public readonly record struct SpeakerEq(double[]? Gains, IReadOnlyList<Config.PeqBand>? Peq, IReadOnlyList<Config.PeqBand>? RoomEq = null);

    /// <summary>
    /// Replaces the per-speaker EQs while running. <paramref name="eqPerRoute"/> is aligned with the constructor's
    /// route list (muted entries ignored). Coefficients are built here, on the caller's thread.
    /// </summary>
    public void SetEq(IReadOnlyList<double[]?> eqPerRoute) =>
        SetEq(eqPerRoute.Select(g => new SpeakerEq(g, null)).ToList());

    public void SetEq(IReadOnlyList<SpeakerEq> eqPerRoute)
    {
        var eq = new BiquadCoefs[]?[_idx.Length];
        for (int k = 0; k < eq.Length; k++)
            eq[k] = _routeOf[k] < eqPerRoute.Count
                ? BuildEq(eqPerRoute[_routeOf[k]].Gains, eqPerRoute[_routeOf[k]].Peq, eqPerRoute[_routeOf[k]].RoomEq) : null;
        _eq = eq;
    }

    /// <summary>Returns the number of frames that did not fit into the ring.</summary>
    public int Process(ReadOnlySpan<float> logical, int frames, RingBuffer ring) => Process(logical, default, frames, ring);

    /// <summary><paramref name="bass"/>: one bass-bus sample per frame (may be empty when no speaker is high-passed).</summary>
    public int Process(ReadOnlySpan<float> logical, ReadOnlySpan<float> bass, int frames, RingBuffer ring)
    {
        int total = frames * _devCh;
        if (_scratch.Length < total) _scratch = new float[total * 2];
        var scratch = _scratch.AsSpan(0, total);
        scratch.Clear();

        var eqs = _eq;
        if (!ReferenceEquals(eqs, _eqApplied))
        {
            for (int k = 0; k < eqs.Length; k++)
                if (eqs[k] is { } st) BiquadCascade.ClearIdle(st, _eqZ[k]);
                else Array.Clear(_eqZ[k]);
            _eqApplied = eqs;
        }

        bool haveBass = bass.Length >= frames;
        for (int k = 0; k < _idx.Length; k++)
        {
            var idx = _idx[k]; var coef = _coef[k]; var dl = _delay[k];
            var hp = _hp[k]; var eq = eqs[k]; var z = _eqZ[k];
            float share = haveBass ? _bassShare[k] : 0f;
            int oc = _outCh[k];
            for (int f = 0; f < frames; f++)
            {
                float acc = 0f;
                int b = f * Channels.Count;
                for (int j = 0; j < idx.Length; j++) acc += logical[b + idx[j]] * coef[j];
                if (share != 0f) acc += bass[f] * share;
                if (eq != null) acc = (float)BiquadCascade.Process(eq, z, acc);
                if (hp != null) acc = hp.Process(acc);
                scratch[f * _devCh + oc] += dl.Process(acc);
            }
        }
        _limiter?.Process(scratch, frames);
        int written = ring.Write(scratch);
        return (total - written) / _devCh;
    }
}
