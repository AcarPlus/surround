namespace Surround.Engine.Dsp;

/// <summary>Simple stereo to 7.1 upmixer (center from mid, LFE from lowpassed mid, surrounds from delayed side).</summary>
public sealed class Upmixer
{
    private readonly Biquad _lfeLp;
    private readonly Biquad _surLp;
    private readonly DelayLine _surDelay;

    public Upmixer(int sampleRate, double lfeCutoffHz = 120, double surroundCutoffHz = 7000, double surroundDelayMs = 12)
    {
        _lfeLp = Biquad.LowPass(sampleRate, lfeCutoffHz);
        _surLp = Biquad.LowPass(sampleRate, surroundCutoffHz);
        _surDelay = new DelayLine((int)Math.Round(surroundDelayMs * sampleRate / 1000.0));
    }

    /// <summary>Input: interleaved stereo. Output: interleaved 8-channel logical frames.</summary>
    public void Process(ReadOnlySpan<float> stereo, Span<float> logical, int frames)
    {
        for (int f = 0; f < frames; f++)
        {
            float l = stereo[f * 2], r = stereo[f * 2 + 1];
            float mid = 0.5f * (l + r);
            float side = 0.5f * (l - r);
            float s = _surLp.Process(_surDelay.Process(side));
            int o = f * Channels.Count;
            logical[o + Channels.FL] = l;
            logical[o + Channels.FR] = r;
            logical[o + Channels.FC] = mid;
            logical[o + Channels.LFE] = _lfeLp.Process(mid);
            logical[o + Channels.BL] = s;
            logical[o + Channels.BR] = -s;
            logical[o + Channels.SL] = s;
            logical[o + Channels.SR] = -s;
        }
    }

    public void Reset()
    {
        _lfeLp.Reset(); _surLp.Reset(); _surDelay.Reset();
    }
}
