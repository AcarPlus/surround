namespace Surround.Engine.Calibration;

/// <summary>
/// Exponential sine sweep (ESS) from <see cref="F1"/> to <see cref="F2"/> over <see cref="Seconds"/>, unit peak, with
/// raised-cosine fades. Defined in continuous time so the same sweep can be rendered at the program rate (playback)
/// and at the microphone rate (analysis reference).
/// </summary>
public sealed class SweepSignal
{
    public const double DefaultF1 = 20, DefaultF2 = 16000, DefaultSeconds = 0.6;
    private const double FadeInSec = 0.02, FadeOutSec = 0.01;

    private readonly double _l;

    public SweepSignal(double f1 = DefaultF1, double f2 = DefaultF2, double seconds = DefaultSeconds)
    {
        if (!(f1 > 0 && f2 > f1 && seconds > 0.1)) throw new ArgumentException("Invalid sweep parameters.");
        F1 = f1; F2 = f2; Seconds = seconds;
        _l = seconds / Math.Log(f2 / f1);
    }

    public double F1 { get; }
    public double F2 { get; }
    public double Seconds { get; }

    /// <summary>The sweep that can be played at <paramref name="rate"/>: the top is capped at 0.45·rate.</summary>
    public static SweepSignal ForRate(int rate) => new(DefaultF1, Math.Min(DefaultF2, 0.45 * rate), DefaultSeconds);

    /// <summary>Time (s) at which the instantaneous frequency reaches <paramref name="f"/>.</summary>
    public double TimeAtFrequency(double f) => _l * Math.Log(f / F1);

    /// <summary>Sample at time <paramref name="t"/> (s); 0 outside [0, <paramref name="endSec"/>), fade-out before the end.</summary>
    public double Value(double t, double endSec)
    {
        if (t < 0 || t >= endSec) return 0;
        double env = 1;
        if (t < FadeInSec) env = 0.5 - 0.5 * Math.Cos(Math.PI * t / FadeInSec);
        double tail = endSec - t;
        if (tail < FadeOutSec) env *= 0.5 - 0.5 * Math.Cos(Math.PI * tail / FadeOutSec);
        return env * Math.Sin(2 * Math.PI * F1 * _l * (Math.Exp(t / _l) - 1));
    }

    public double Value(double t) => Value(t, Seconds);

    /// <summary>
    /// Renders the sweep at <paramref name="rate"/> scaled by <paramref name="amplitude"/>. With <paramref name="maxFreq"/>
    /// below <see cref="F2"/> the sweep stops (faded) where it reaches that frequency, so it stays below Nyquist.
    /// </summary>
    public float[] Render(int rate, double amplitude, double maxFreq = double.PositiveInfinity)
    {
        double end = maxFreq < F2 ? TimeAtFrequency(maxFreq) : Seconds;
        int n = (int)Math.Ceiling(end * rate);
        var x = new float[n];
        for (int i = 0; i < n; i++) x[i] = (float)(amplitude * Value(i / (double)rate, end));
        return x;
    }
}
