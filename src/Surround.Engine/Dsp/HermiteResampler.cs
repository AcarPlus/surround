namespace Surround.Engine.Dsp;

/// <summary>
/// Variable-ratio 4-point Hermite (cubic) interpolator for interleaved audio.
/// ratio = input frames consumed per output frame. State carries across calls.
/// </summary>
public sealed class HermiteResampler
{
    private readonly int _ch;
    private readonly float[] _hist; // 4 frames: x0 x1 x2 x3 (x3 newest)
    private double _mu = 1.0;

    public HermiteResampler(int channels)
    {
        _ch = channels;
        _hist = new float[4 * channels];
    }

    public double Phase => _mu;

    public void Reset()
    {
        Array.Clear(_hist);
        _mu = 1.0;
    }

    public int Process(ReadOnlySpan<float> input, int inputFrames, Span<float> output, int maxOutputFrames,
        double ratio, out int consumed)
    {
        int ch = _ch;
        int inPos = 0, outPos = 0;
        while (outPos < maxOutputFrames)
        {
            while (_mu >= 1.0)
            {
                if (inPos >= inputFrames) { consumed = inPos; return outPos; }
                Array.Copy(_hist, ch, _hist, 0, 3 * ch);
                input.Slice(inPos * ch, ch).CopyTo(_hist.AsSpan(3 * ch, ch));
                inPos++;
                _mu -= 1.0;
            }
            float m = (float)_mu;
            for (int c = 0; c < ch; c++)
            {
                float x0 = _hist[c], x1 = _hist[ch + c], x2 = _hist[2 * ch + c], x3 = _hist[3 * ch + c];
                float c1 = 0.5f * (x2 - x0);
                float c2 = x0 - 2.5f * x1 + 2f * x2 - 0.5f * x3;
                float c3 = 0.5f * (x3 - x0) + 1.5f * (x1 - x2);
                output[outPos * ch + c] = ((c3 * m + c2) * m + c1) * m + x1;
            }
            outPos++;
            _mu += ratio;
        }
        consumed = inPos;
        return outPos;
    }
}
