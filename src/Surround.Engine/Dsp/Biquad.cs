namespace Surround.Engine.Dsp;

/// <summary>Direct form II transposed biquad (RBJ cookbook coefficients).</summary>
public sealed class Biquad
{
    private readonly double _b0, _b1, _b2, _a1, _a2;
    private double _z1, _z2;

    private Biquad(double b0, double b1, double b2, double a0, double a1, double a2)
    {
        _b0 = b0 / a0; _b1 = b1 / a0; _b2 = b2 / a0;
        _a1 = a1 / a0; _a2 = a2 / a0;
    }

    public static Biquad LowPass(double sampleRate, double cutoffHz, double q = 0.70710678)
    {
        double w0 = 2 * Math.PI * cutoffHz / sampleRate;
        double cos = Math.Cos(w0), alpha = Math.Sin(w0) / (2 * q);
        return new Biquad((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
    }

    public static Biquad HighPass(double sampleRate, double cutoffHz, double q = 0.70710678)
    {
        double w0 = 2 * Math.PI * cutoffHz / sampleRate;
        double cos = Math.Cos(w0), alpha = Math.Sin(w0) / (2 * q);
        return new Biquad((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
    }

    public float Process(float x)
    {
        double y = _b0 * x + _z1;
        _z1 = _b1 * x - _a1 * y + _z2;
        _z2 = _b2 * x - _a2 * y;
        return (float)y;
    }

    public void Reset() { _z1 = _z2 = 0; }
}
