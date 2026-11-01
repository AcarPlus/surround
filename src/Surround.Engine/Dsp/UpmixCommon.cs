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
    private readonly bool[] _available;

    /// <param name="available">Per logical channel (FL..TBR; a shorter list leaves the rest unavailable); LFE is ignored.</param>
    /// <param name="lfeAllowed">Some speaker maps LFE explicitly, so a derived LFE is heard (and not only folded).</param>
    public UpmixLayout(IReadOnlyList<bool> available, bool lfeAllowed)
    {
        _available = new bool[Channels.Count];
        for (int c = 0; c < Channels.Count && c < available.Count; c++) _available[c] = available[c];
        LfeAllowed = lfeAllowed;
    }

    public static UpmixLayout Full { get; } = new(Enumerable.Repeat(true, Channels.Count).ToArray(), true);

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
        };
    }
}

/// <summary>Tuning shared by both upmix modes (see docs/upmix.md).</summary>
public static class UpmixTuning
{
    /// <summary>Share of the ambient power kept in FL/FR; the rest goes to the side/back channels.</summary>
    public const float FrontAmbientShare = 0.4f;
    /// <summary>Extra delay of every side/back output (precedence effect keeps the image in front).</summary>
    public const double SurroundDelayMs = 10;
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
/// Writes the side/back channels of one output frame: the ambient pair through complementary all-pass decorrelators
/// plus optional direct (steered) signals, then a short precedence delay.
/// Complementary pair per side: side = (H1·A + H2·A)/2, back = (H1·A - H2·A)/2 — the powers sum to the input power
/// and side + back = H1·A (flat), so a layout that folds one into the other loses nothing and gains no comb.
/// Left and right, and side and back, all get different filters.
/// </summary>
internal sealed class SurroundRenderer
{
    private readonly Decorrelator _l1, _l2, _r1, _r2;
    private readonly DelayLine _dSL, _dBL, _dSR, _dBR;
    private readonly bool _lPair, _rPair, _lBack, _rBack;

    public SurroundRenderer(int fs, UpmixLayout layout, double delayMs = UpmixTuning.SurroundDelayMs)
    {
        _l1 = new Decorrelator(fs, 1.9, 4.4, 7.9);
        _l2 = new Decorrelator(fs, 2.7, 5.3, 9.1);
        _r1 = new Decorrelator(fs, 2.3, 4.9, 8.3);
        _r2 = new Decorrelator(fs, 3.1, 5.9, 9.7);
        int d = (int)Math.Round(delayMs * fs / 1000);
        _dSL = new DelayLine(d); _dBL = new DelayLine(d); _dSR = new DelayLine(d); _dBR = new DelayLine(d);
        _lPair = layout.Has(Channels.SL) && layout.Has(Channels.BL);
        _rPair = layout.Has(Channels.SR) && layout.Has(Channels.BR);
        // A side with one surround speaker gets the flat H1 signal there; with none, the fold moves SL/SR elsewhere.
        _lBack = !layout.Has(Channels.SL) && layout.Has(Channels.BL);
        _rBack = !layout.Has(Channels.SR) && layout.Has(Channels.BR);
    }

    /// <param name="frame">The 8 logical samples of this output frame; SL/SR/BL/BR are overwritten.</param>
    public void Render(float al, float ar, float ambGain, float sl, float bl, float sr, float br, Span<float> frame)
    {
        float h1 = _l1.Process(al) * ambGain;
        if (_lPair)
        {
            float h2 = _l2.Process(al) * ambGain;
            sl += 0.5f * (h1 + h2);
            bl += 0.5f * (h1 - h2);
        }
        else if (_lBack) bl += h1;
        else sl += h1;

        h1 = _r1.Process(ar) * ambGain;
        if (_rPair)
        {
            float h2 = _r2.Process(ar) * ambGain;
            sr += 0.5f * (h1 + h2);
            br += 0.5f * (h1 - h2);
        }
        else if (_rBack) br += h1;
        else sr += h1;

        frame[Channels.SL] = _dSL.Process(sl);
        frame[Channels.BL] = _dBL.Process(bl);
        frame[Channels.SR] = _dSR.Process(sr);
        frame[Channels.BR] = _dBR.Process(br);
    }
}
