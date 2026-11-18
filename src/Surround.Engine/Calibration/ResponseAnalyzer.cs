using Surround.Engine.Dsp;

namespace Surround.Engine.Calibration;

/// <summary>
/// Gated, smoothed power spectrum of one impulse response on <see cref="ResponseGrid"/>: the IR from 2 ms before the
/// direct sound, 60 ms flat and a 20 ms fade, zero-padded FFT, then each grid point averages the power of the bins
/// within ±1/12 octave (1/6-octave smoothing). Values are linear power; sweeps are averaged before going to dB.
/// The gate keeps the direct sound and the early reflections (what sets a speaker's timbre at the seat) and drops
/// the late room tail, which every speaker shares anyway.
/// </summary>
internal sealed class ResponseAnalyzer
{
    private readonly int _pre, _flat, _fade, _m;
    private readonly Fft _fft;
    private readonly float[] _re, _im;
    private readonly (int Lo, int Hi)[] _bins;

    public ResponseAnalyzer(int rate)
    {
        _pre = (int)Math.Round(ResponseGrid.PreSec * rate);
        _flat = (int)Math.Round(ResponseGrid.FlatSec * rate);
        _fade = Math.Max(1, (int)Math.Round(ResponseGrid.FadeSec * rate));
        int len = _pre + _flat + _fade;
        _m = 1;
        while (_m < 2 * len) _m <<= 1;
        _fft = new Fft(_m);
        _re = new float[_m]; _im = new float[_m];
        double df = rate / (double)_m;
        double half = Math.Pow(2, 1.0 / ResponseGrid.PointsPerOctave); // ±1/12 octave = 1/6-octave band
        _bins = new (int, int)[ResponseGrid.Count];
        for (int i = 0; i < _bins.Length; i++)
        {
            double f = ResponseGrid.Hz(i);
            int lo = Math.Max(1, (int)Math.Ceiling(f / half / df));
            int hi = Math.Min(_m / 2 - 1, (int)Math.Floor(f * half / df));
            if (hi < lo) lo = hi = Math.Clamp((int)Math.Round(f / df), 1, _m / 2 - 1);
            _bins[i] = (lo, hi);
        }
    }

    /// <summary>Linear power per grid point of <paramref name="ir"/> (first <paramref name="count"/> lags) gated around lag <paramref name="onset"/>.</summary>
    public double[] Power(float[] ir, int count, double onset)
    {
        Array.Clear(_re); Array.Clear(_im);
        int start = (int)Math.Floor(onset) - _pre;
        int len = _pre + _flat + _fade;
        int fadeIn = Math.Max(1, _pre / 2);
        for (int i = 0; i < len; i++)
        {
            int k = start + i;
            if (k < 0 || k >= count) continue;
            double w = 1;
            if (i < fadeIn) w = 0.5 - 0.5 * Math.Cos(Math.PI * i / fadeIn);
            else if (i >= _pre + _flat) w = 0.5 + 0.5 * Math.Cos(Math.PI * (i - _pre - _flat) / _fade);
            _re[i] = (float)(ir[k] * w);
        }
        _fft.Transform(_re, _im, inverse: false);
        var p = new double[_bins.Length];
        for (int g = 0; g < p.Length; g++)
        {
            var (lo, hi) = _bins[g];
            double acc = 0;
            for (int k = lo; k <= hi; k++) acc += (double)_re[k] * _re[k] + (double)_im[k] * _im[k];
            p[g] = acc / (hi - lo + 1);
        }
        return p;
    }

    /// <summary>Power mean of the sweeps' spectra in dB (rounded to 0.01 dB); null without any.</summary>
    public static double[]? Average(IEnumerable<double[]?> powers)
    {
        double[]? sum = null;
        int n = 0;
        foreach (var p in powers)
        {
            if (p is null) continue;
            sum ??= new double[p.Length];
            for (int i = 0; i < p.Length && i < sum.Length; i++) sum[i] += p[i];
            n++;
        }
        if (sum is null) return null;
        return sum.Select(v => Math.Round(10 * Math.Log10(Math.Max(v / n, 1e-30)), 2)).ToArray();
    }
}
