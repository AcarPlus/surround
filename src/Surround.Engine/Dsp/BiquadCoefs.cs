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

    public static bool IsFlat(BiquadCoefs[] stages)
    {
        foreach (var s in stages) if (!s.IsIdentity) return false;
        return true;
    }
}
