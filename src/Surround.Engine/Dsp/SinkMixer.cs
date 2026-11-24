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
/// <para>
/// Live changes (<see cref="SetRoutes"/>: mix rows, gains and delays, e.g. while a speaker is dragged on the room map) are
/// built on the caller's thread and handed over by reference; the audio thread never locks or allocates for them. The
/// coefficients glide linearly over <see cref="RampMs"/> and a delay change cross-fades from the old tap to the new one
/// over <see cref="DelayFadeMs"/>, so neither produces a click.
/// </para>
/// </summary>
public sealed class SinkMixer
{
    private const int EqZ = EqDesign.StagesWithPeq * 2;
    /// <summary>Glide of the mix coefficients (row × gain) after a live change.</summary>
    public const double RampMs = 10;
    /// <summary>Cross-fade between the old and the new delay tap after a live delay change.</summary>
    public const double DelayFadeMs = 20;
    /// <summary>Each speaker's delay line can grow this much beyond its starting delay without a restart.</summary>
    public const double DelayHeadroomMs = 250;

    private readonly int _devCh, _fs;
    private readonly int _routeCount;
    private readonly int[] _outCh;
    private readonly int[] _routeOf; // active speaker → index in the constructor's route list
    private readonly bool[] _routeMute;
    private readonly int[] _routeDevCh;
    private readonly double[] _routeHp;
    private readonly float[] _bassShare;
    private readonly LinkwitzRiley?[] _hp;
    private readonly FadeDelay[] _delay;
    private readonly int[] _delayMax;
    private readonly double[][] _eqZ;
    private readonly PeakLimiter? _limiter;
    private volatile BiquadCoefs[]?[] _eq;
    private BiquadCoefs[]?[]? _eqApplied;
    private float[] _scratch = new float[8192];

    // Live mix: published by SetRoutes (any thread), taken over by Process (audio thread).
    private volatile MixState _mix;
    // Audio-thread state.
    private MixState _mixApplied;
    private readonly float[][] _from; // dense coefficients where the current glide started
    private readonly int _rampFrames, _fadeFrames;
    private readonly float _invRamp, _invFade;
    private int _rampPos; // frames of the current glide done; >= _rampFrames = idle
    private readonly int[] _dA, _dB, _dPending, _fadePos; // delay taps; _fadePos < 0 = no fade

    /// <summary>Immutable per-speaker mix (row × gain) and delays; built off the audio thread.</summary>
    private sealed class MixState
    {
        public readonly float[][] Dense;
        public readonly int[][] Idx;
        public readonly float[][] Coef;
        public readonly int[] Delay;

        public MixState(int n)
        {
            Dense = new float[n][]; Idx = new int[n][]; Coef = new float[n][]; Delay = new int[n];
        }

        public void Set(int k, SpeakerRoute s)
        {
            float g = (float)Math.Pow(10.0, s.GainDb / 20.0);
            var dense = new float[Channels.Count];
            int nz = 0;
            for (int c = 0; c < Channels.Count && c < s.MixRow.Length; c++)
                if (s.MixRow[c] != 0f) { dense[c] = s.MixRow[c] * g; nz++; }
            var idx = new int[nz]; var coef = new float[nz];
            for (int c = 0, j = 0; c < Channels.Count; c++)
                if (c < s.MixRow.Length && s.MixRow[c] != 0f) { idx[j] = c; coef[j] = dense[c]; j++; }
            Dense[k] = dense; Idx[k] = idx; Coef[k] = coef;
            Delay[k] = Math.Max(0, s.DelaySamples);
        }
    }

    public SinkMixer(int deviceChannels, IReadOnlyList<SpeakerRoute> speakers, int sampleRate = 48000, PeakLimiter? limiter = null)
    {
        _devCh = deviceChannels;
        _fs = sampleRate;
        _limiter = limiter;
        _routeCount = speakers.Count;
        _routeMute = new bool[_routeCount]; _routeDevCh = new int[_routeCount]; _routeHp = new double[_routeCount];
        int n = 0;
        for (int r = 0; r < speakers.Count; r++)
        {
            var s = speakers[r];
            _routeMute[r] = s.Mute; _routeDevCh[r] = s.DeviceChannel; _routeHp[r] = s.HighPassHz;
            if (!s.Mute) n++;
        }
        _outCh = new int[n]; _delay = new FadeDelay[n]; _delayMax = new int[n];
        _routeOf = new int[n]; _bassShare = new float[n]; _hp = new LinkwitzRiley?[n]; _eqZ = new double[n][];
        _from = new float[n][];
        _dA = new int[n]; _dB = new int[n]; _dPending = new int[n]; _fadePos = new int[n];
        var eq = new BiquadCoefs[]?[n];
        var mix = new MixState(n);
        int headroom = (int)Math.Round(DelayHeadroomMs * sampleRate / 1000.0);
        int k = 0;
        for (int r = 0; r < speakers.Count; r++)
        {
            var s = speakers[r];
            if (s.Mute) continue;
            if (s.DeviceChannel < 0 || s.DeviceChannel >= deviceChannels)
                throw new ArgumentOutOfRangeException(nameof(speakers), $"{s.Name}: device channel out of range");
            mix.Set(k, s);
            _outCh[k] = s.DeviceChannel;
            _delayMax[k] = mix.Delay[k] + headroom;
            _delay[k] = new FadeDelay(_delayMax[k]);
            _dA[k] = _dB[k] = mix.Delay[k]; _dPending[k] = -1; _fadePos[k] = -1;
            _from[k] = (float[])mix.Dense[k].Clone();
            _routeOf[k] = r;
            // The bass bus already carries the cut speakers' own gains, so the receiver's gain is not applied to it.
            _bassShare[k] = s.BassShare;
            _hp[k] = s.HighPassHz > 0 ? LinkwitzRiley.HighPass(sampleRate, s.HighPassHz) : null;
            _eqZ[k] = new double[EqZ];
            eq[k] = BuildEq(s.Eq, s.Peq, s.RoomEq);
            k++;
        }
        _eq = eq;
        _mix = _mixApplied = mix;
        _rampFrames = Math.Max(1, (int)Math.Round(RampMs * sampleRate / 1000.0));
        _fadeFrames = Math.Max(1, (int)Math.Round(DelayFadeMs * sampleRate / 1000.0));
        _invRamp = 1f / _rampFrames;
        _invFade = 1f / _fadeFrames;
        _rampPos = _rampFrames;
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
        var eq = new BiquadCoefs[]?[_outCh.Length];
        for (int k = 0; k < eq.Length; k++)
            eq[k] = _routeOf[k] < eqPerRoute.Count
                ? BuildEq(eqPerRoute[_routeOf[k]].Gains, eqPerRoute[_routeOf[k]].Peq, eqPerRoute[_routeOf[k]].RoomEq) : null;
        _eq = eq;
    }

    /// <summary>
    /// Live change of the mix rows, gains and delays (e.g. a speaker moved on the room map). <paramref name="routes"/> must
    /// have the constructor's structure (same count, mute flags, device channels, high-passes and bass shares); EQs are not
    /// taken from here (see <see cref="SetEq"/>). Built on the caller's thread; the audio thread glides to it.
    /// Returns false (nothing changed) when the structure differs or a delay outgrows its line: the caller must rebuild.
    /// </summary>
    public bool SetRoutes(IReadOnlyList<SpeakerRoute> routes)
    {
        if (routes.Count != _routeCount) return false;
        for (int r = 0; r < routes.Count; r++)
        {
            var s = routes[r];
            if (s.Mute != _routeMute[r] || s.DeviceChannel != _routeDevCh[r] || s.HighPassHz != _routeHp[r]) return false;
        }
        var mix = new MixState(_outCh.Length);
        for (int k = 0; k < _outCh.Length; k++)
        {
            var s = routes[_routeOf[k]];
            if (s.BassShare != _bassShare[k]) return false;
            mix.Set(k, s);
            if (mix.Delay[k] > _delayMax[k]) return false;
        }
        _mix = mix;
        return true;
    }

    /// <summary>Audio thread: takes over a new <see cref="MixState"/> (no allocation).</summary>
    private void Retarget(MixState mix)
    {
        var old = _mixApplied;
        bool rowsChanged = false;
        for (int k = 0; k < _outCh.Length && !rowsChanged; k++)
        {
            float[] a = old.Dense[k], b = mix.Dense[k];
            for (int c = 0; c < Channels.Count; c++) if (a[c] != b[c]) { rowsChanged = true; break; }
        }
        if (rowsChanged)
        {
            // Start the new glide where the signal is now (mid-glide included).
            bool gliding = _rampPos < _rampFrames;
            float t = gliding ? _rampPos * _invRamp : 1f;
            for (int k = 0; k < _outCh.Length; k++)
            {
                float[] from = _from[k], to = old.Dense[k];
                for (int c = 0; c < Channels.Count; c++)
                    from[c] = gliding ? from[c] + (to[c] - from[c]) * t : to[c];
            }
            _rampPos = 0;
        }
        for (int k = 0; k < _outCh.Length; k++)
        {
            int d = mix.Delay[k];
            if (_fadePos[k] >= 0)
            {
                int last = _dPending[k] >= 0 ? _dPending[k] : _dB[k];
                if (d != last) _dPending[k] = d;
            }
            else if (d != _dA[k])
            {
                _dB[k] = d; _fadePos[k] = 0;
            }
        }
        _mixApplied = mix;
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

        var mix = _mix;
        if (!ReferenceEquals(mix, _mixApplied)) Retarget(mix);
        int rampPos = _rampPos;
        bool gliding = rampPos < _rampFrames;

        bool haveBass = bass.Length >= frames;
        for (int k = 0; k < _outCh.Length; k++)
        {
            var idx = mix.Idx[k]; var coef = mix.Coef[k]; var dl = _delay[k];
            var hp = _hp[k]; var eq = eqs[k]; var z = _eqZ[k];
            float share = haveBass ? _bassShare[k] : 0f;
            int oc = _outCh[k];
            int dA = _dA[k];
            if (!gliding && _fadePos[k] < 0)
            {
                // Steady state: sparse row, fixed tap.
                for (int f = 0; f < frames; f++)
                {
                    float acc = 0f;
                    int b = f * Channels.Count;
                    for (int j = 0; j < idx.Length; j++) acc += logical[b + idx[j]] * coef[j];
                    if (share != 0f) acc += bass[f] * share;
                    if (eq != null) acc = (float)BiquadCascade.Process(eq, z, acc);
                    if (hp != null) acc = hp.Process(acc);
                    scratch[f * _devCh + oc] += dl.Process(acc, dA, dA, 0f);
                }
                continue;
            }

            // A live change is under way: gliding coefficients and/or a delay cross-fade.
            var from = _from[k]; var to = mix.Dense[k];
            int dB = _dB[k], fade = _fadePos[k];
            for (int f = 0; f < frames; f++)
            {
                float acc = 0f;
                int b = f * Channels.Count;
                int rp = rampPos + f;
                if (rp < _rampFrames)
                {
                    float t = (rp + 1) * _invRamp;
                    for (int c = 0; c < Channels.Count; c++)
                    {
                        float a0 = from[c], a1 = to[c];
                        if (a0 == 0f && a1 == 0f) continue;
                        acc += logical[b + c] * (a0 + (a1 - a0) * t);
                    }
                }
                else
                {
                    for (int j = 0; j < idx.Length; j++) acc += logical[b + idx[j]] * coef[j];
                }
                if (share != 0f) acc += bass[f] * share;
                if (eq != null) acc = (float)BiquadCascade.Process(eq, z, acc);
                if (hp != null) acc = hp.Process(acc);
                float y;
                if (fade >= 0)
                {
                    y = dl.Process(acc, dA, dB, (fade + 1) * _invFade);
                    if (++fade >= _fadeFrames)
                    {
                        dA = dB; fade = -1;
                        int p = _dPending[k];
                        if (p >= 0)
                        {
                            _dPending[k] = -1;
                            if (p != dA) { dB = p; fade = 0; }
                        }
                    }
                }
                else y = dl.Process(acc, dA, dA, 0f);
                scratch[f * _devCh + oc] += y;
            }
            _dA[k] = dA; _dB[k] = dB; _fadePos[k] = fade;
        }
        if (gliding) _rampPos = Math.Min(_rampFrames, rampPos + frames);
        _limiter?.Process(scratch, frames);
        int written = ring.Write(scratch);
        return (total - written) / _devCh;
    }
}
