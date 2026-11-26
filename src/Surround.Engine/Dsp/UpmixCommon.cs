using Surround.Engine.Config;

namespace Surround.Engine.Dsp;

/// <summary>What the upmix stage is doing right now.</summary>
public enum UpmixState
{
    /// <summary>Upmix switched off (or not applicable to the source).</summary>
    Off = 0,
    /// <summary>Content is effectively stereo; FL/FR are upmixed to 7.1 (plus the used height lanes).</summary>
    Stereo = 1,
    /// <summary>Real multichannel content; channels pass through unchanged.</summary>
    Native = 2,
}

/// <summary>Stereo (logical FL/FR) to logical 7.1 + height lanes upmixer. Single audio thread; <see cref="Update"/> from any thread.</summary>
public interface IStereoUpmixer
{
    /// <summary>Delay of the front (FL/FC/FR) outputs relative to the input, in frames.</summary>
    int LatencyFrames { get; }

    /// <summary>
    /// Reads FL/FR from interleaved logical frames <paramref name="input"/> and writes all <see cref="Channels.Count"/> channels of
    /// <paramref name="output"/> (same layout). The two spans must not overlap.
    /// </summary>
    void Process(ReadOnlySpan<float> input, Span<float> output, int frames);

    void Update(UpmixSettings settings);
}

/// <summary>
/// Which logical channels the speaker layout actually plays (from <see cref="ChannelFold"/>'s used set). The upmixers
/// steer only onto available channels, so coherent sources are never summed by the fold (+3 dB errors), and decide
/// whether the ambience needs complementary side/back pairs. Height lanes are derived only when some speaker plays them.
/// </summary>
public sealed class UpmixLayout
{
    private static readonly int[] Surrounds = { Channels.SL, Channels.SR, Channels.BL, Channels.BR };

    private readonly bool[] _available;
    private readonly bool[] _shared;
    private readonly bool[] _silent;
    private UpmixLayout? _steerable;

    /// <param name="available">Per logical channel (FL..TBR; a shorter list leaves the rest unavailable); LFE is ignored.</param>
    /// <param name="lfeAllowed">Some speaker maps LFE explicitly, so a derived LFE is heard (and not only folded).</param>
    /// <param name="shared">
    /// Per logical channel: a side/back channel that is only played by speakers which also play a front channel (e.g.
    /// "distribute by position" with the fronts only). The decoders give it what the flat mode gives it (a plain copy of
    /// L or R, no delay, no decorrelation): ambience rendered into it would be summed with the front in the same speaker
    /// and comb, and would leave that speaker quieter than in the flat mode. Null = none.
    /// </param>
    /// <param name="silent">
    /// Per logical channel: a <paramref name="shared"/> channel whose every speaker already plays a front channel at a
    /// real level (see <see cref="ForSpeakers"/>). A stereo source writes nothing into it: a copy of L or R would be
    /// summed coherently with the same signal on the front channel of that speaker (FR 0.96 + SR 1 + BR 1 is +9.4 dB),
    /// driving the device limiter all the time (quieter, "choppy" sound) without adding any direction. Null = none.
    /// </param>
    public UpmixLayout(IReadOnlyList<bool> available, bool lfeAllowed, IReadOnlyList<bool>? shared = null, IReadOnlyList<bool>? silent = null)
    {
        _available = new bool[Channels.Count];
        _shared = new bool[Channels.Count];
        _silent = new bool[Channels.Count];
        for (int c = 0; c < Channels.Count && c < available.Count; c++) _available[c] = available[c];
        if (shared != null)
            foreach (int c in Surrounds) _shared[c] = _available[c] && c < shared.Count && shared[c];
        if (silent != null)
            foreach (int c in Surrounds) _silent[c] = _shared[c] && c < silent.Count && silent[c];
        LfeAllowed = lfeAllowed;
        SharedLeft = new[] { Channels.SL, Channels.BL }.Where(c => _shared[c] && !_silent[c]).ToArray();
        SharedRight = new[] { Channels.SR, Channels.BR }.Where(c => _shared[c] && !_silent[c]).ToArray();
    }

    /// <summary>A front weight at least this share of the side/back weight in the same speaker makes the copy redundant.</summary>
    internal const float RedundantFrontShare = 0.5f;

    public static UpmixLayout Full { get; } = new(Enumerable.Repeat(true, Channels.Count).ToArray(), true);

    /// <summary>
    /// The layout the upmixer works for, from the unmuted speakers' mix rows: the channels they play, whether one maps
    /// LFE, which side/back channels only share a speaker with a front channel (see <see cref="Shared"/>), and which of
    /// those need no stereo copy at all because every speaker playing them already plays a front (see <see cref="Silent"/>).
    /// </summary>
    public static UpmixLayout ForSpeakers(IEnumerable<float[]> rows)
    {
        var list = rows.ToList();
        var used = ChannelFold.UsedChannels(list.Select(r => (r, false)));
        static bool Plays(float[] r, int c) => c < r.Length && r[c] != 0f;
        static bool Front(float[] r) => Plays(r, Channels.FL) || Plays(r, Channels.FR) || Plays(r, Channels.FC);
        static float FrontWeight(float[] r) => new[] { Channels.FL, Channels.FR, Channels.FC }.Max(c => c < r.Length ? Math.Abs(r[c]) : 0f);
        var shared = new bool[Channels.Count];
        var silent = new bool[Channels.Count];
        foreach (int c in Surrounds)
        {
            var players = list.Where(r => Plays(r, c)).ToList();
            shared[c] = used[c] && players.All(Front);
            silent[c] = shared[c] && players.All(r => FrontWeight(r) >= RedundantFrontShare * Math.Abs(r[c]));
        }
        return new UpmixLayout(used, list.Any(r => Plays(r, Channels.LFE)), shared, silent);
    }

    /// <summary>Side/back channel played only by speakers that also play a front channel (see the constructor).</summary>
    public bool Shared(int channel) => _shared[channel];
    /// <summary>Shared channel a stereo source leaves empty (see the constructor); native multichannel content still plays it.</summary>
    public bool Silent(int channel) => _silent[channel];
    /// <summary>The <see cref="Shared"/> channels of the left (SL, BL) and the right side (SR, BR).</summary>
    public int[] SharedLeft { get; }
    public int[] SharedRight { get; }

    /// <summary>What the decoders steer into and render ambience into: this layout without the shared channels.</summary>
    public UpmixLayout Steerable => _steerable ??= !_shared.Any(s => s) ? this
        : new UpmixLayout(_available.Select((a, c) => a && !_shared[c]).ToArray(), LfeAllowed);

    public bool Has(int channel) => _available[channel];
    public bool LfeAllowed { get; }
    public bool AnySurround => LeftSurround || RightSurround;
    public bool LeftSurround => Has(Channels.SL) || Has(Channels.BL);
    public bool RightSurround => Has(Channels.SR) || Has(Channels.BR);
    public bool AnyHeight => Has(Channels.TFL) || Has(Channels.TFR) || Has(Channels.TBL) || Has(Channels.TBR);
}

/// <summary>Immutable, linear form of the live-updatable <see cref="UpmixOptions"/> fields.</summary>
public sealed class UpmixSettings
{
    public float CenterGain { get; private init; } = 1f;
    public float SurroundGain { get; private init; } = 1f;
    public float LfeGain { get; private init; } = 1f;
    public float HeightGain { get; private init; } = DefaultHeightGain;
    /// <summary>Extra delay of the side/back outputs in ms (0..25).</summary>
    public double SurroundDelayMs { get; private init; } = UpmixOptions.DefaultSurroundDelayMs;
    /// <summary>2nd-order low-pass on the side/back outputs in Hz; 0 = off.</summary>
    public double HighCutHz { get; private init; }
    /// <summary>0..1: share of the all-pass decorrelated signal in the side/back ambience (1 = fully decorrelated).</summary>
    public double Diffusion { get; private init; } = UpmixOptions.DefaultDiffusion;

    private static readonly float DefaultHeightGain = (float)Math.Pow(10, UpmixOptions.DefaultHeightDb / 20);

    public static UpmixSettings Default { get; } = new();

    public static UpmixSettings Build(UpmixOptions? o)
    {
        if (o is null) return Default;
        static float G(double db, double min = UpmixOptions.MinDb, double max = UpmixOptions.MaxDb, double fallback = 0) =>
            (float)Math.Pow(10, (double.IsFinite(db) ? Math.Clamp(db, min, max) : fallback) / 20);
        return new UpmixSettings
        {
            CenterGain = G(o.CenterDb), SurroundGain = G(o.SurroundDb), LfeGain = o.LfeEnabled ? 1f : 0f,
            HeightGain = G(o.HeightDb, UpmixOptions.MinHeightDb, UpmixOptions.MaxHeightDb, UpmixOptions.DefaultHeightDb),
            SurroundDelayMs = double.IsFinite(o.SurroundDelayMs)
                ? Math.Clamp(o.SurroundDelayMs, 0, UpmixOptions.MaxSurroundDelayMs) : UpmixOptions.DefaultSurroundDelayMs,
            HighCutHz = double.IsFinite(o.SurroundHighCutHz) && o.SurroundHighCutHz > 0
                ? Math.Clamp(o.SurroundHighCutHz, UpmixOptions.MinHighCutHz, UpmixOptions.MaxHighCutHz) : 0,
            Diffusion = double.IsFinite(o.Diffusion) ? Math.Clamp(o.Diffusion, 0, 1) : UpmixOptions.DefaultDiffusion,
        };
    }
}

/// <summary>Tuning shared by both upmix modes (see docs/upmix.md).</summary>
public static class UpmixTuning
{
    /// <summary>Share of the ambient power kept in FL/FR; the rest goes to the side/back channels.</summary>
    public const float FrontAmbientShare = 0.4f;
    /// <summary>Extra delay of every side/back output (precedence effect keeps the image in front).</summary>
    public const double SurroundDelayMs = UpmixOptions.DefaultSurroundDelayMs;
    public const double LfeHz = 120;
    /// <summary>Smoothing of live gain changes.</summary>
    public const double GainSmoothSeconds = 0.03;
    /// <summary>Below this every internal state is flushed to zero (no denormals on silence).</summary>
    public const float Tiny = 1e-20f;

    internal static float Flush(float v) => v > -Tiny && v < Tiny ? 0f : v;

    /// <summary>
    /// Amplitude split of one side's ambience between its front channel and its surround speakers. A side without any
    /// side/back speaker keeps all of it in front: rendering it through the decorrelators and the precedence delay only
    /// for the fold to add it back onto the front channel (which already carries the same ambience) combs and echoes.
    /// </summary>
    internal static (float Front, float Surround) AmbientSplit(bool sideHasSurround) =>
        sideHasSurround ? (MathF.Sqrt(FrontAmbientShare), MathF.Sqrt(1 - FrontAmbientShare)) : (1f, 0f);
}

/// <summary>Schroeder all-pass section: H(z) = (-g + z^-D) / (1 - g·z^-D). Flat magnitude, dispersed phase.</summary>
internal sealed class AllPass
{
    private readonly float[] _buf;
    private readonly float _g;
    private int _pos;

    public AllPass(int delay, float g)
    {
        _buf = new float[Math.Max(1, delay)];
        _g = g;
    }

    public float Process(float x)
    {
        float vd = _buf[_pos];
        float v = UpmixTuning.Flush(x + _g * vd);
        _buf[_pos] = v;
        if (++_pos == _buf.Length) _pos = 0;
        return vd - _g * v;
    }
}

/// <summary>Cascade of three all-pass sections: an all-pass decorrelator (no coloration on its own).</summary>
internal sealed class Decorrelator
{
    private readonly AllPass _a, _b, _c;

    public Decorrelator(int fs, double ms1, double ms2, double ms3, float g = 0.5f)
    {
        static int D(int fs, double ms) => Math.Max(1, (int)Math.Round(ms * fs / 1000));
        _a = new AllPass(D(fs, ms1), g);
        _b = new AllPass(D(fs, ms2), g);
        _c = new AllPass(D(fs, ms3), g);
    }

    public float Process(float x) => _c.Process(_b.Process(_a.Process(x)));
}

/// <summary>
/// Delay line with a live-changeable delay: a change cross-fades (about 30 ms) between the old and the new tap, so
/// there is neither a click nor a pitch bend. With a fixed delay it is exactly <see cref="DelayLine"/>.
/// </summary>
internal sealed class FadeDelay
{
    private readonly float[] _buf;
    private readonly int _mask;
    private int _w;

    public FadeDelay(int maxSamples)
    {
        int n = 4;
        while (n < maxSamples + 2) n <<= 1;
        _buf = new float[n];
        _mask = n - 1;
    }

    /// <param name="mix">0 = tap <paramref name="a"/> only; 1 = tap <paramref name="b"/> only.</param>
    public float Process(float x, int a, int b, float mix)
    {
        _buf[_w] = x;
        float ya = _buf[(_w - a) & _mask];
        float y = mix <= 0f ? ya : ya + mix * (_buf[(_w - b) & _mask] - ya);
        _w = (_w + 1) & _mask;
        return y;
    }
}

/// <summary>
/// Writes the side/back channels of one output frame: the ambient pair through complementary all-pass decorrelators
/// plus optional direct (steered) signals, then a short precedence delay and an optional rear high-cut.
/// Complementary pair per side: side = (H1·A + H2·A)/2, back = (H1·A - H2·A)/2 — the powers sum to the input power
/// and side + back = H1·A (flat), so a layout that folds one into the other loses nothing and gains no comb.
/// Left and right, and side and back, all get different filters.
/// Live parameters (<see cref="Configure"/>, from <see cref="UpmixSettings"/>): delay (cross-faded), 2nd-order
/// Butterworth low-pass (cross-faded in and out, cutoff glides in the log domain) and diffusion, the share of the
/// decorrelated signal: H' = d·H + (1-d)·A, so 0 is the dry ambience (the pair collapses to side = A, back = 0)
/// and 1 is the original behaviour, sample for sample.
/// </summary>
internal sealed class SurroundRenderer
{
    private const int CutBlock = 16;

    private readonly Decorrelator _l1, _l2, _r1, _r2;
    private readonly FadeDelay _dSL, _dBL, _dSR, _dBR;
    private readonly bool _lPair, _rPair, _lBack, _rBack;
    private readonly int _fs;
    private readonly float _smoothK, _fadeStep;

    private UpmixSettings? _applied;
    // Delay: current tap, fade target tap, cross-fade position (a fade is running while _fading).
    private int _dA, _dB, _dPending = -1;
    private float _mix;
    private bool _fading;
    // Diffusion.
    private float _diff = 1f, _tDiff = 1f;
    // High-cut.
    private double _tCut, _cutLog = Math.Log(16000);
    private float _cutMix;
    private BiquadCoefs _lp = BiquadCoefs.Identity;
    private readonly double[] _z = new double[8];
    private int _block;
    private bool _cutIdle = true;

    public SurroundRenderer(int fs, UpmixLayout layout, double delayMs = UpmixTuning.SurroundDelayMs)
    {
        _fs = fs;
        _l1 = new Decorrelator(fs, 1.9, 4.4, 7.9);
        _l2 = new Decorrelator(fs, 2.7, 5.3, 9.1);
        _r1 = new Decorrelator(fs, 2.3, 4.9, 8.3);
        _r2 = new Decorrelator(fs, 3.1, 5.9, 9.7);
        int max = DelaySamples(UpmixOptions.MaxSurroundDelayMs);
        _dSL = new FadeDelay(max); _dBL = new FadeDelay(max); _dSR = new FadeDelay(max); _dBR = new FadeDelay(max);
        _dA = _dB = DelaySamples(delayMs);
        _lPair = layout.Has(Channels.SL) && layout.Has(Channels.BL);
        _rPair = layout.Has(Channels.SR) && layout.Has(Channels.BR);
        // A side with one surround speaker gets the flat H1 signal there; with none, the fold moves SL/SR elsewhere.
        _lBack = !layout.Has(Channels.SL) && layout.Has(Channels.BL);
        _rBack = !layout.Has(Channels.SR) && layout.Has(Channels.BR);
        _smoothK = (float)(1 - Math.Exp(-1 / (UpmixTuning.GainSmoothSeconds * fs)));
        _fadeStep = (float)(1 / (UpmixTuning.GainSmoothSeconds * fs));
    }

    private int DelaySamples(double ms) => (int)Math.Round(ms * _fs / 1000);

    /// <summary>Takes the live parameters; call once per buffer (cheap when unchanged). The first call snaps, later ones glide.</summary>
    public void Configure(UpmixSettings st)
    {
        if (ReferenceEquals(st, _applied)) return;
        bool first = _applied is null;
        _applied = st;
        _tDiff = (float)st.Diffusion;
        _tCut = st.HighCutHz;
        int tDelay = DelaySamples(st.SurroundDelayMs);
        if (first)
        {
            _diff = _tDiff;
            _dA = _dB = tDelay; _fading = false; _dPending = -1;
            if (_tCut > 0) { _cutLog = Math.Log(_tCut); _cutMix = 1f; _cutIdle = false; _lp = BiquadCoefs.LowPass(_fs, _tCut); }
        }
        else if (_fading) _dPending = tDelay;
        else if (tDelay != _dA) StartFade(tDelay);
    }

    private void StartFade(int target)
    {
        _dB = target; _mix = 0f; _fading = true; _dPending = -1;
    }

    /// <param name="frame">The 8 logical samples of this output frame; SL/SR/BL/BR are overwritten.</param>
    public void Render(float al, float ar, float ambGain, float sl, float bl, float sr, float br, Span<float> frame)
    {
        if (_diff != _tDiff) _diff = GlobalProcessor.Approach(_diff, _tDiff, _smoothK);
        float d = _diff, wd = 1f - d;

        float h1 = _l1.Process(al);
        if (d != 1f) h1 = d * h1 + wd * al;
        h1 *= ambGain;
        if (_lPair)
        {
            float h2 = _l2.Process(al);
            if (d != 1f) h2 = d * h2 + wd * al;
            h2 *= ambGain;
            sl += 0.5f * (h1 + h2);
            bl += 0.5f * (h1 - h2);
        }
        else if (_lBack) bl += h1;
        else sl += h1;

        h1 = _r1.Process(ar);
        if (d != 1f) h1 = d * h1 + wd * ar;
        h1 *= ambGain;
        if (_rPair)
        {
            float h2 = _r2.Process(ar);
            if (d != 1f) h2 = d * h2 + wd * ar;
            h2 *= ambGain;
            sr += 0.5f * (h1 + h2);
            br += 0.5f * (h1 - h2);
        }
        else if (_rBack) br += h1;
        else sr += h1;

        int a = _dA, b = _dB;
        float m = _fading ? _mix : 0f;
        float ysl = _dSL.Process(sl, a, b, m), ybl = _dBL.Process(bl, a, b, m);
        float ysr = _dSR.Process(sr, a, b, m), ybr = _dBR.Process(br, a, b, m);
        if (_fading)
        {
            _mix += _fadeStep;
            if (_mix >= 1f)
            {
                _dA = _dB; _mix = 0f; _fading = false;
                if (_dPending >= 0 && _dPending != _dA) StartFade(_dPending);
                _dPending = -1;
            }
        }

        if (_tCut > 0 || _cutMix > 0f) HighCut(ref ysl, ref ybl, ref ysr, ref ybr);
        else if (!_cutIdle) { Array.Clear(_z); _cutIdle = true; }

        frame[Channels.SL] = ysl;
        frame[Channels.BL] = ybl;
        frame[Channels.SR] = ysr;
        frame[Channels.BR] = ybr;
    }

    private void HighCut(ref float sl, ref float bl, ref float sr, ref float br)
    {
        if (_cutIdle)
        {
            _cutIdle = false;
            _cutLog = Math.Log(_tCut > 0 ? _tCut : 16000);
            _lp = BiquadCoefs.LowPass(_fs, Math.Exp(_cutLog));
        }
        _cutMix = GlobalProcessor.Approach(_cutMix, _tCut > 0 ? 1f : 0f, _smoothK);
        if (_tCut > 0 && ++_block >= CutBlock)
        {
            _block = 0;
            double target = Math.Log(_tCut), diff = target - _cutLog;
            if (Math.Abs(diff) > 1e-4)
            {
                _cutLog = Math.Abs(diff) < 1e-3 ? target : _cutLog + diff * CutBlock * _smoothK;
                _lp = BiquadCoefs.LowPass(_fs, Math.Exp(_cutLog));
            }
        }
        sl = Lp(sl, 0); bl = Lp(bl, 2); sr = Lp(sr, 4); br = Lp(br, 6);

        float Lp(float x, int zi)
        {
            float y = (float)_lp.Process(x, ref _z[zi], ref _z[zi + 1]);
            if (Math.Abs(_z[zi]) < 1e-25) _z[zi] = 0;
            if (Math.Abs(_z[zi + 1]) < 1e-25) _z[zi + 1] = 0;
            return x + _cutMix * (y - x);
        }
    }
}
