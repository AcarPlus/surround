namespace Surround.Engine.Dsp;

/// <summary>
/// Decides per sample whether multichannel content is effectively stereo: the peak envelope (10 ms release) of every
/// channel except FL/FR. Stereo when it stays below -70 dBFS for 300 ms; native again as soon as it stays above
/// -64 dBFS for 5 ms. The 6 dB gap and the asymmetric hold times are the hysteresis.
/// </summary>
public sealed class StereoDetector
{
    public const double EnterDb = -70, ExitDb = -64, EnterMs = 300, ExitMs = 5, ReleaseMs = 10;

    private readonly float _enter, _exit, _rel;
    private readonly int _enterN, _exitN;
    private float _env;
    private int _count;

    public StereoDetector(int sampleRate, bool startStereo = true)
    {
        _enter = (float)Math.Pow(10, EnterDb / 20);
        _exit = (float)Math.Pow(10, ExitDb / 20);
        _rel = (float)Math.Exp(-1 / (ReleaseMs / 1000 * sampleRate));
        _enterN = (int)Math.Round(EnterMs / 1000 * sampleRate);
        _exitN = Math.Max(1, (int)Math.Round(ExitMs / 1000 * sampleRate));
        Stereo = startStereo;
    }

    public bool Stereo { get; private set; }

    /// <param name="peak">Largest |sample| of the non-front channels in this frame.</param>
    public bool Step(float peak)
    {
        _env = peak > _env ? peak : _env * _rel;
        if (_env < UpmixTuning.Tiny) _env = 0f;
        if (Stereo)
        {
            if (_env > _exit) { if (++_count >= _exitN) { Stereo = false; _count = 0; } }
            else _count = 0;
        }
        else
        {
            if (_env < _enter) { if (++_count >= _enterN) { Stereo = true; _count = 0; } }
            else _count = 0;
        }
        return Stereo;
    }
}

/// <summary>
/// The upmix stage on interleaved logical frames, in place. For a stereo source the upmixer always runs. For a
/// multichannel source the <see cref="StereoDetector"/> chooses between upmixing FL/FR and passing the 7.1 channels
/// through (with <see cref="NativeHeights"/> deriving the used height lanes from them); the two are crossfaded over
/// 30 ms. The native path is delayed by the upmixer's latency so both are
/// time-aligned (film mode: the whole chain then has that constant latency). The upmixer runs all the time so it is
/// warm when the crossfade starts.
/// </summary>
public sealed class AdaptiveUpmix
{
    private const int Ch = Channels.Count;
    public const double CrossfadeMs = 30;

    private readonly IStereoUpmixer _up;
    private readonly bool _adaptive;
    private readonly StereoDetector _det;
    private readonly DelayLine[] _native;
    private readonly NativeHeights? _heights;
    private readonly float[] _nf = new float[Ch];
    private readonly float _step;
    private float[] _buf = new float[Ch * 4096];
    private float _w;
    private volatile int _state;

    /// <param name="adaptive">Source has more than two channels: detect stereo content instead of always upmixing.</param>
    /// <param name="nativeHeights">Height lanes of the native path (adaptive only); null = silent there.</param>
    public AdaptiveUpmix(int sampleRate, IStereoUpmixer upmixer, bool adaptive, NativeHeights? nativeHeights = null)
    {
        _up = upmixer;
        _adaptive = adaptive;
        _heights = adaptive ? nativeHeights : null;
        _det = new StereoDetector(sampleRate);
        _native = new DelayLine[Channels.SourceCount];
        for (int c = 0; c < _native.Length; c++) _native[c] = new DelayLine(adaptive ? upmixer.LatencyFrames : 0);
        _step = (float)(1000 / (CrossfadeMs * sampleRate));
        _w = 1f;
        _state = (int)UpmixState.Stereo;
    }

    public UpmixState State => (UpmixState)_state;
    public int LatencyFrames => _up.LatencyFrames;
    public IStereoUpmixer Upmixer => _up;

    public void Update(UpmixSettings settings)
    {
        _up.Update(settings);
        _heights?.Update(settings);
    }

    public void Process(Span<float> logical, int frames)
    {
        int total = frames * Ch;
        if (_buf.Length < total) _buf = new float[total * 2];
        var up = _buf.AsSpan(0, total);
        _up.Process(logical, up, frames);
        if (!_adaptive)
        {
            up.CopyTo(logical);
            return;
        }

        bool stereo = _det.Stereo;
        var nf = _nf.AsSpan();
        float hTarget = _heights?.Target ?? 0f;
        for (int f = 0; f < frames; f++)
        {
            int b = f * Ch;
            float peak = 0f;
            // Sources only deliver the 7.1 lanes; the height lanes of the input are always silent.
            for (int c = Channels.FC; c < Channels.SourceCount; c++)
            {
                float v = Math.Abs(logical[b + c]);
                if (v > peak) peak = v;
            }
            stereo = _det.Step(peak);
            _w = stereo ? Math.Min(1f, _w + _step) : Math.Max(0f, _w - _step);
            float g = _w * _w * (3 - 2 * _w); // smoothstep; native and upmix are correlated, so gains sum to 1
            for (int c = 0; c < Channels.SourceCount; c++) nf[c] = _native[c].Process(logical[b + c]);
            // Kept running while upmixing so the native heights are warm when the crossfade starts.
            if (_heights != null) _heights.Render(nf, hTarget);
            for (int c = 0; c < Ch; c++)
            {
                float n = nf[c];
                logical[b + c] = g >= 1f ? up[b + c] : g <= 0f ? n : n + g * (up[b + c] - n);
            }
        }
        _state = (int)(stereo ? UpmixState.Stereo : UpmixState.Native);
    }
}

/// <summary>
/// Moves logical channels that no unmuted speaker plays into used neighbors, with constant power (one target: gain 1;
/// two: -3 dB each). FC → FL+FR; SL → BL (else FL), SR → BR (else FR); BL → SL (else FL), BR → SR (else FR); FL/FR
/// → FC/sides/backs for unusual layouts. LFE is never folded here — the bass receivers rule handles it. The height
/// lanes are neither folded nor fold targets: they are derived only when some speaker plays them.
/// Runs after the global processing (and the meters), before the bass bus and the sinks.
/// </summary>
public sealed class ChannelFold
{
    private const int Ch = Channels.Count;

    private static readonly int[][][] Candidates = BuildCandidates();

    private readonly int[] _src, _dst;
    private readonly float[] _g;
    private readonly int[] _cleared;

    private ChannelFold(List<(int Src, int Dst, float Gain)> ops)
    {
        Ops = ops;
        _src = ops.Select(o => o.Src).ToArray();
        _dst = ops.Select(o => o.Dst).ToArray();
        _g = ops.Select(o => o.Gain).ToArray();
        _cleared = ops.Select(o => o.Src).Distinct().ToArray();
    }

    public IReadOnlyList<(int Src, int Dst, float Gain)> Ops { get; }

    private static int[][][] BuildCandidates()
    {
        int FL = Channels.FL, FR = Channels.FR, FC = Channels.FC, BL = Channels.BL, BR = Channels.BR, SL = Channels.SL, SR = Channels.SR;
        var c = new int[Ch][][];
        c[FL] = new[] { new[] { FC }, new[] { SL }, new[] { BL }, new[] { FR } };
        c[FR] = new[] { new[] { FC }, new[] { SR }, new[] { BR }, new[] { FL } };
        c[FC] = new[] { new[] { FL, FR }, new[] { SL, SR }, new[] { BL, BR } };
        c[Channels.LFE] = Array.Empty<int[]>();
        c[BL] = new[] { new[] { SL }, new[] { FL }, new[] { FC }, new[] { BR } };
        c[BR] = new[] { new[] { SR }, new[] { FR }, new[] { FC }, new[] { BL } };
        c[SL] = new[] { new[] { BL }, new[] { FL }, new[] { FC }, new[] { SR } };
        c[SR] = new[] { new[] { BR }, new[] { FR }, new[] { FC }, new[] { SL } };
        for (int h = Channels.SourceCount; h < Ch; h++) c[h] = Array.Empty<int[]>();
        return c;
    }

    /// <summary>Fold plan for the given used set (per logical channel); null when nothing needs folding.</summary>
    public static ChannelFold? Plan(IReadOnlyList<bool> used)
    {
        var ops = new List<(int, int, float)>();
        for (int c = 0; c < Ch; c++)
        {
            if (used[c]) continue;
            foreach (var group in Candidates[c])
            {
                var targets = group.Where(t => used[t]).ToArray();
                if (targets.Length == 0) continue;
                float g = 1f / MathF.Sqrt(targets.Length);
                foreach (var t in targets) ops.Add((c, t, g));
                break;
            }
        }
        return ops.Count == 0 ? null : new ChannelFold(ops);
    }

    /// <summary>
    /// Logical channels some unmuted speaker plays (mix row coefficient ≠ 0; high-passed speakers count, their bass
    /// reaches the receivers via the bass bus).
    /// </summary>
    public static bool[] UsedChannels(IEnumerable<(float[] Row, bool Mute)> speakers)
    {
        var used = new bool[Ch];
        foreach (var (row, mute) in speakers)
        {
            if (mute) continue;
            for (int c = 0; c < Ch && c < row.Length; c++) if (row[c] != 0f) used[c] = true;
        }
        return used;
    }

    public void Process(Span<float> logical, int frames)
    {
        for (int f = 0; f < frames; f++)
        {
            int b = f * Ch;
            for (int k = 0; k < _src.Length; k++) logical[b + _dst[k]] += _g[k] * logical[b + _src[k]];
            for (int k = 0; k < _cleared.Length; k++) logical[b + _cleared[k]] = 0f;
        }
    }
}
