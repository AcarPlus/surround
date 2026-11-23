namespace Surround.Engine.Dsp;

/// <summary>
/// Variable-ratio band-limited interpolator for interleaved audio: Kaiser-windowed sinc, <see cref="Taps"/> taps,
/// <see cref="Phases"/> precomputed fractional phases with linear interpolation between neighbouring phases.
/// ratio = input frames consumed per output frame (same contract and state handling as the old 4-point Hermite).
/// <para>
/// Why: the drift controller keeps the ratio a few ppm off 1, so the fractional phase sweeps slowly through 0..1. A cubic
/// interpolator's treble depends on that phase (Hermite: 0 dB at phase 0, −1.9 dB at 14 kHz and −5.3 dB at 18 kHz at
/// phase 0.5), which made cymbals and air "breathe". This one stays within ±0.01 dB to 20 kHz at every phase, and at
/// phase 0 it is an exact pass-through. When downsampling (nominal ratio &gt; 1) the cutoff follows the output Nyquist.
/// </para>
/// Latency: <see cref="Taps"/>/2 input frames (0.33 ms at 48 kHz), identical on every sink.
/// </summary>
public sealed class SincResampler
{
    public const int Taps = 32;
    public const int Phases = 512;
    private const double Beta = 6.0;
    private const int Centre = Taps / 2 - 1;

    private readonly int _ch;
    private readonly float[] _table;   // (Phases + 1) rows × Taps
    private readonly float[] _hist;    // per channel: 2 × Taps (mirrored ring, contiguous reads)
    private int _pos;                  // next write index in [0, Taps)
    private double _mu = 1.0;
    private readonly float[] _coef = new float[Taps];

    /// <param name="nominalRatio">Expected input/output rate ratio; above 1 the anti-alias cutoff is lowered to match.</param>
    public SincResampler(int channels, double nominalRatio = 1.0)
    {
        _ch = channels;
        _hist = new float[channels * 2 * Taps];
        _table = BuildTable(nominalRatio > 1.0005 ? 0.97 / nominalRatio : 1.0);
    }

    public double Phase => _mu;

    public void Reset()
    {
        Array.Clear(_hist);
        _pos = 0;
        _mu = 1.0;
    }

    private static double I0(double x)
    {
        double s = 1, t = 1;
        for (int k = 1; k < 64; k++)
        {
            t *= x / (2 * k) * (x / (2 * k));
            s += t;
            if (t < 1e-14 * s) break;
        }
        return s;
    }

    /// <summary>Row p holds the taps for fractional position p/Phases between the centre tap and the next one.</summary>
    private static float[] BuildTable(double cutoff)
    {
        var t = new float[(Phases + 1) * Taps];
        double i0b = I0(Beta), half = Taps / 2.0;
        for (int p = 0; p <= Phases; p++)
        {
            double frac = (double)p / Phases;
            double sum = 0;
            var row = new double[Taps];
            for (int k = 0; k < Taps; k++)
            {
                double x = k - Centre - frac;
                double a = x / half;
                double w = Math.Abs(a) >= 1 ? 0 : I0(Beta * Math.Sqrt(1 - a * a)) / i0b;
                double s = Math.Abs(x) < 1e-12 ? 1 : Math.Sin(Math.PI * cutoff * x) / (Math.PI * x) / cutoff;
                // Exact pass-through at integer positions when not low-passing.
                if (cutoff == 1.0 && (p == 0 || p == Phases)) s = Math.Abs(x) < 1e-12 ? 1 : 0;
                row[k] = s * w;
                sum += row[k];
            }
            // Unity DC gain at every phase (no level wobble as the phase drifts).
            for (int k = 0; k < Taps; k++) t[p * Taps + k] = (float)(row[k] / sum);
        }
        return t;
    }

    public int Process(ReadOnlySpan<float> input, int inputFrames, Span<float> output, int maxOutputFrames,
        double ratio, out int consumed)
    {
        int ch = _ch, inPos = 0, outPos = 0;
        var hist = _hist;
        var coef = _coef.AsSpan();
        while (outPos < maxOutputFrames)
        {
            while (_mu >= 1.0)
            {
                if (inPos >= inputFrames) { consumed = inPos; return outPos; }
                int src = inPos * ch;
                for (int c = 0; c < ch; c++)
                {
                    int b = c * 2 * Taps;
                    float v = input[src + c];
                    hist[b + _pos] = v;
                    hist[b + _pos + Taps] = v;
                }
                if (++_pos == Taps) _pos = 0;
                inPos++;
                _mu -= 1.0;
            }

            double ph = _mu * Phases;
            int p0 = (int)ph;
            if (p0 >= Phases) p0 = Phases - 1;
            float a = (float)(ph - p0);
            int r0 = p0 * Taps, r1 = r0 + Taps;
            for (int k = 0; k < Taps; k++) coef[k] = _table[r0 + k] + a * (_table[r1 + k] - _table[r0 + k]);

            // Oldest frame sits at _pos (the slot about to be overwritten); the mirrored half keeps the window contiguous.
            for (int c = 0; c < ch; c++)
            {
                int b = c * 2 * Taps + _pos;
                float acc = 0f;
                for (int k = 0; k < Taps; k++) acc += hist[b + k] * coef[k];
                output[outPos * ch + c] = acc;
            }
            outPos++;
            _mu += ratio;
        }
        consumed = inPos;
        return outPos;
    }
}
