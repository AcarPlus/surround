using System.Numerics;

namespace Surround.Engine.Dsp;

/// <summary>
/// In-place iterative radix-2 complex FFT on split real/imaginary float arrays. Tables are built in the constructor,
/// <see cref="Transform"/> allocates nothing. Forward: X[k] = Σ x[n]·e^(-2πikn/N); inverse uses the conjugate kernel
/// and is unscaled (divide by N yourself).
/// </summary>
public sealed class Fft
{
    private readonly int _n;
    private readonly int[] _rev;
    private readonly float[] _cos, _sin;

    public Fft(int n)
    {
        if (n < 2 || (n & (n - 1)) != 0) throw new ArgumentException("FFT size must be a power of two.", nameof(n));
        _n = n;
        int bits = BitOperations.Log2((uint)n);
        _rev = new int[n];
        for (int i = 0; i < n; i++)
        {
            int r = 0;
            for (int b = 0; b < bits; b++) if ((i & (1 << b)) != 0) r |= 1 << (bits - 1 - b);
            _rev[i] = r;
        }
        _cos = new float[n / 2];
        _sin = new float[n / 2];
        for (int i = 0; i < n / 2; i++)
        {
            double a = -2 * Math.PI * i / n;
            _cos[i] = (float)Math.Cos(a);
            _sin[i] = (float)Math.Sin(a);
        }
    }

    public int Size => _n;

    public void Transform(float[] re, float[] im, bool inverse)
    {
        int n = _n;
        for (int i = 0; i < n; i++)
        {
            int j = _rev[i];
            if (j > i)
            {
                (re[i], re[j]) = (re[j], re[i]);
                (im[i], im[j]) = (im[j], im[i]);
            }
        }
        float sign = inverse ? -1f : 1f;
        for (int size = 2; size <= n; size <<= 1)
        {
            int half = size >> 1, step = n / size;
            for (int k = 0, t = 0; k < half; k++, t += step)
            {
                float wr = _cos[t], wi = sign * _sin[t];
                for (int a = k; a < n; a += size)
                {
                    int b = a + half;
                    float xr = re[b] * wr - im[b] * wi;
                    float xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                }
            }
        }
    }
}
