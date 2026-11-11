using System.Runtime.CompilerServices;

namespace Surround.Engine.Dsp;

/// <summary>
/// Immutable normalized biquad coefficients (RBJ cookbook). State lives with the caller so a coefficient set can be
/// swapped under a running filter (live EQ changes) without touching the audio thread's state arrays.
/// </summary>
public readonly struct BiquadCoefs
{
    public readonly double B0, B1, B2, A1, A2;

    public static readonly BiquadCoefs Identity = new(1, 0, 0, 1, 0, 0);

    private BiquadCoefs(double b0, double b1, double b2, double a0, double a1, double a2)
    {
        B0 = b0 / a0; B1 = b1 / a0; B2 = b2 / a0;
        A1 = a1 / a0; A2 = a2 / a0;
    }

    public bool IsIdentity => B0 == 1 && B1 == 0 && B2 == 0 && A1 == 0 && A2 == 0;

    /// <summary>Keeps design frequencies below Nyquist at low sample rates.</summary>
    private static double W0(double fs, double f) => 2 * Math.PI * Math.Min(f, 0.45 * fs) / fs;

    public static BiquadCoefs Peaking(double fs, double f, double q, double gainDb)
    {
        if (gainDb == 0) return Identity;
        double a = Math.Pow(10, gainDb / 40), w0 = W0(fs, f);
        double cos = Math.Cos(w0), alpha = Math.Sin(w0) / (2 * q);
        return new(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a);
    }

    /// <summary>RBJ low-pass (used for the live-adjustable rear high-cut; never identity).</summary>
    public static BiquadCoefs LowPass(double fs, double f, double q = 0.70710678)
    {
        double w0 = W0(fs, f), cos = Math.Cos(w0), alpha = Math.Sin(w0) / (2 * q);
        return new((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
    }

    public static BiquadCoefs LowShelf(double fs, double f, double gainDb, double q = 0.70710678)
    {
        if (gainDb == 0) return Identity;
        double a = Math.Pow(10, gainDb / 40), w0 = W0(fs, f);
        double cos = Math.Cos(w0), alpha = Math.Sin(w0) / (2 * q), sq = 2 * Math.Sqrt(a) * alpha;
        return new(
            a * ((a + 1) - (a - 1) * cos + sq),
            2 * a * ((a - 1) - (a + 1) * cos),
            a * ((a + 1) - (a - 1) * cos - sq),
            (a + 1) + (a - 1) * cos + sq,
            -2 * ((a - 1) + (a + 1) * cos),
            (a + 1) + (a - 1) * cos - sq);
    }

    public static BiquadCoefs HighShelf(double fs, double f, double gainDb, double q = 0.70710678)
    {
        if (gainDb == 0) return Identity;
        double a = Math.Pow(10, gainDb / 40), w0 = W0(fs, f);
        double cos = Math.Cos(w0), alpha = Math.Sin(w0) / (2 * q), sq = 2 * Math.Sqrt(a) * alpha;
        return new(
            a * ((a + 1) + (a - 1) * cos + sq),
            -2 * a * ((a - 1) + (a + 1) * cos),
            a * ((a + 1) + (a - 1) * cos - sq),
            (a + 1) - (a - 1) * cos + sq,
            2 * ((a - 1) - (a + 1) * cos),
            (a + 1) - (a - 1) * cos - sq);
    }

    /// <summary>Magnitude |H(e^jw)| at <paramref name="f"/> Hz for sample rate <paramref name="fs"/>.</summary>
    public double Magnitude(double fs, double f)
    {
        double w = 2 * Math.PI * f / fs;
        double c1 = Math.Cos(w), s1 = Math.Sin(w), c2 = Math.Cos(2 * w), s2 = Math.Sin(2 * w);
        double nr = B0 + B1 * c1 + B2 * c2, ni = -(B1 * s1 + B2 * s2);
        double dr = 1 + A1 * c1 + A2 * c2, di = -(A1 * s1 + A2 * s2);
        return Math.Sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }

    /// <summary>Direct form II transposed step with external state.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public double Process(double x, ref double z1, ref double z2)
    {
        double y = B0 * x + z1;
        z1 = B1 * x - A1 * y + z2;
        z2 = B2 * x - A2 * y;
        return y;
    }
}

/// <summary>
/// A fixed-length cascade of biquads whose coefficients can be replaced while it runs. Identity stages are skipped
/// and their state cleared, so a band that is switched off costs nothing and starts clean when switched on again.
/// </summary>
public static class BiquadCascade
{
    /// <summary>
    /// Runs <paramref name="x"/> through <paramref name="stages"/>. <paramref name="z"/> holds 2 doubles per stage.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static double Process(BiquadCoefs[] stages, Span<double> z, double x)
    {
        for (int i = 0; i < stages.Length; i++)
        {
            ref readonly var c = ref stages[i];
            if (c.IsIdentity) continue;
            x = c.Process(x, ref z[2 * i], ref z[2 * i + 1]);
        }
        return x;
    }

    /// <summary>Clears the state of identity stages (call once per buffer after a coefficient swap).</summary>
    public static void ClearIdle(BiquadCoefs[] stages, Span<double> z)
    {
        for (int i = 0; i < stages.Length; i++)
            if (stages[i].IsIdentity) { z[2 * i] = 0; z[2 * i + 1] = 0; }
    }
}

/// <summary>Coefficient designs shared by the global and per-speaker equalizers.</summary>
public static class EqDesign
{
    public const double PeakQ = 1.4;

    /// <summary>10-band graphic EQ: low shelf at 31 Hz, peaking 62 Hz..8 kHz, high shelf at 16 kHz.</summary>
    public static BiquadCoefs[] TenBand(double fs, IReadOnlyList<double>? gainsDb)
    {
        var bands = Config.ProcessingConfig.BandHz;
        var st = new BiquadCoefs[bands.Length];
        for (int b = 0; b < bands.Length; b++)
        {
            double g = gainsDb != null && b < gainsDb.Count && double.IsFinite(gainsDb[b])
                ? Math.Clamp(gainsDb[b], -Config.ConfigValidator.MaxEqDb, Config.ConfigValidator.MaxEqDb) : 0;
            st[b] = b == 0 ? BiquadCoefs.LowShelf(fs, bands[b], g)
                : b == bands.Length - 1 ? BiquadCoefs.HighShelf(fs, bands[b], g)
                : BiquadCoefs.Peaking(fs, bands[b], PeakQ, g);
        }
        return st;
    }

    /// <summary>
    /// Parametric bands as a fixed <see cref="Config.PeqBand.MaxBands"/>-stage cascade (identity for unused, disabled,
    /// 0 dB or invalid bands; values are clamped to the validator's ranges; bands beyond the sixth are ignored).
    /// </summary>
    public static BiquadCoefs[] Peq(double fs, IReadOnlyList<Config.PeqBand>? bands)
    {
        var st = new BiquadCoefs[Config.PeqBand.MaxBands];
        Array.Fill(st, BiquadCoefs.Identity);
        if (bands is null) return st;
        static double C(double v, double lo, double hi, double fallback) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : fallback;
        for (int i = 0; i < st.Length && i < bands.Count; i++)
        {
            var b = bands[i];
            if (b is null || !b.Enabled) continue;
            double f = C(b.FreqHz, Config.PeqBand.MinFreqHz, Config.PeqBand.MaxFreqHz, 1000);
            double g = C(b.GainDb, -Config.PeqBand.MaxGainDb, Config.PeqBand.MaxGainDb, 0);
            double q = C(b.Q, Config.PeqBand.MinQ, Config.PeqBand.MaxQ, 1);
            st[i] = b.Type switch
            {
                Config.PeqBand.Peak => BiquadCoefs.Peaking(fs, f, q, g),
                Config.PeqBand.LowShelf => BiquadCoefs.LowShelf(fs, f, g, q),
                Config.PeqBand.HighShelf => BiquadCoefs.HighShelf(fs, f, g, q),
                _ => BiquadCoefs.Identity,
            };
        }
        return st;
    }

    /// <summary>10-band EQ followed by the parametric bands (the per-speaker cascade; <see cref="StagesWithPeq"/> long).</summary>
    public static BiquadCoefs[] TenBandWithPeq(double fs, IReadOnlyList<double>? gainsDb, IReadOnlyList<Config.PeqBand>? peq)
    {
        var st = new BiquadCoefs[StagesWithPeq];
        TenBand(fs, gainsDb).CopyTo(st, 0);
        Peq(fs, peq).CopyTo(st, Config.ProcessingConfig.Bands);
        return st;
    }

    public const int StagesWithPeq = Config.ProcessingConfig.Bands + Config.PeqBand.MaxBands;

    public static bool IsFlat(BiquadCoefs[] stages)
    {
        foreach (var s in stages) if (!s.IsIdentity) return false;
        return true;
    }
}

/// <summary>Combined magnitude response of a biquad cascade, and the auto-preamp derived from it.</summary>
public static class FrequencyResponse
{
    public const double MinHz = 20, MaxHz = 20000;
    /// <summary>Log-spaced analysis grid for the peak search; the UI mirror uses the same grid.</summary>
    public const int GridPoints = 1000;

    public static double MagnitudeDb(IEnumerable<BiquadCoefs> stages, double fs, double f)
    {
        double m = 1;
        foreach (var s in stages) if (!s.IsIdentity) m *= s.Magnitude(fs, f);
        return 20 * Math.Log10(m);
    }

    /// <summary>Highest gain (dB) of the cascade over <see cref="MinHz"/>..<see cref="MaxHz"/> (can be below 0 dB).</summary>
    public static double PeakDb(IReadOnlyList<BiquadCoefs> stages, double fs)
    {
        double peak = double.NegativeInfinity;
        double ratio = Math.Pow(MaxHz / MinHz, 1.0 / (GridPoints - 1));
        double f = MinHz;
        for (int i = 0; i < GridPoints; i++, f *= ratio)
            peak = Math.Max(peak, MagnitudeDb(stages, fs, Math.Min(f, MaxHz)));
        return peak;
    }

    /// <summary>
    /// The single definition of the automatic preamp: -max(0, peak of the combined 10-band EQ + bass boost + clarity + peq
    /// response) in dB, limited to the preamp range. <paramref name="fs"/> only matters through the filter warping near Nyquist.
    /// </summary>
    public static double AutoPreampDb(Config.ProcessingConfig p, double fs = 48000) =>
        AutoPreampDb(ProcessingSettings.BuildStages(p, fs), fs);

    public static double AutoPreampDb(IReadOnlyList<BiquadCoefs> stages, double fs) =>
        Math.Max(-24, -Math.Max(0, PeakDb(stages, fs)));
}
