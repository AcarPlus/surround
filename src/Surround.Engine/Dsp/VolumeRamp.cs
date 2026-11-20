namespace Surround.Engine.Dsp;

/// <summary>
/// Master volume on the interleaved logical channels. The target may be set from any thread; each block ramps
/// linearly from the previous gain to the target, so a volume step never clicks.
/// </summary>
public sealed class VolumeRamp
{
    private float _target;
    private float _current;

    public VolumeRamp(float initial = 1f)
    {
        _target = _current = Clamp(initial);
    }

    public float Target => Volatile.Read(ref _target);

    public void SetTarget(float gain) => Volatile.Write(ref _target, Clamp(gain));

    /// <summary>Jumps to <paramref name="gain"/> without a ramp (before the first block).</summary>
    public void Reset(float gain)
    {
        float g = Clamp(gain);
        Volatile.Write(ref _target, g);
        _current = g;
    }

    public void Process(Span<float> interleaved, int frames, int channels)
    {
        float target = Volatile.Read(ref _target);
        float start = _current;
        if (frames <= 0 || channels <= 0) return;
        if (start == target)
        {
            if (target == 1f) return;
            interleaved[..(frames * channels)].MultiplyInPlace(target);
            return;
        }
        float step = (target - start) / frames;
        for (int f = 0; f < frames; f++)
        {
            float g = start + step * (f + 1);
            var frame = interleaved.Slice(f * channels, channels);
            for (int c = 0; c < channels; c++) frame[c] *= g;
        }
        _current = target;
    }

    private static float Clamp(float g) => float.IsFinite(g) ? Math.Clamp(g, 0f, 1f) : 1f;
}

internal static class SpanGain
{
    public static void MultiplyInPlace(this Span<float> s, float g)
    {
        for (int i = 0; i < s.Length; i++) s[i] *= g;
    }
}
