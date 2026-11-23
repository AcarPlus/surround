using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

/// <summary>Limiting must not audibly distort bass (the old 1 ms / 80 ms limiter measured −39…−51 dB THD).</summary>
public class LimiterDistortionTests
{
    static double Thd(float[] y, double f, int fs, int from)
    {
        // Harmonic power 2..10 over fundamental, by projection.
        double P(double fr) { double re = 0, im = 0; for (int i = from; i < y.Length; i++) { double w = 2 * Math.PI * fr * i / fs; re += y[i] * Math.Cos(w); im += y[i] * Math.Sin(w); } return re * re + im * im; }
        double h = 0; for (int k = 2; k <= 10; k++) h += P(f * k);
        return 10 * Math.Log10(h / P(f));
    }

    [Theory]
    [InlineData(1.0)]
    [InlineData(3.0)]
    [InlineData(6.0)]
    public void BassStaysCleanWhileLimiting(double overDb)
    {
        const int fs = 48000, n = fs * 2;
        var lim = new PeakLimiter(1, fs);
        // 60 Hz bass + 3 kHz detail, peaks overDb above the -1 dBFS ceiling.
        var x = new float[n];
        double a = Math.Pow(10, (overDb - 1) / 20);
        for (int i = 0; i < n; i++) x[i] = (float)(a * (0.8 * Math.Sin(2 * Math.PI * 60 * i / fs) + 0.2 * Math.Sin(2 * Math.PI * 3000 * i / fs)));
        lim.Process(x, n);
        double thd = Thd(x, 60, fs, fs / 2);
        Assert.True(thd < -70, $"THD {thd:0.0} dB");
        for (int i = 0; i < n; i++) Assert.True(Math.Abs(x[i]) <= PeakLimiter.DefaultCeiling + 1e-6f);
    }
}
