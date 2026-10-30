namespace Surround.Engine.Dsp;

/// <summary>Fixed integer-sample delay. Output is the input delayed by exactly DelaySamples.</summary>
public sealed class DelayLine
{
    private readonly float[] _buf;
    private int _pos;

    public DelayLine(int delaySamples)
    {
        if (delaySamples < 0) throw new ArgumentOutOfRangeException(nameof(delaySamples));
        DelaySamples = delaySamples;
        _buf = new float[delaySamples];
    }

    public int DelaySamples { get; }

    public float Process(float x)
    {
        if (_buf.Length == 0) return x;
        float y = _buf[_pos];
        _buf[_pos] = x;
        if (++_pos == _buf.Length) _pos = 0;
        return y;
    }

    public void Reset()
    {
        Array.Clear(_buf);
        _pos = 0;
    }
}
