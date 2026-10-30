namespace Surround.Engine.Dsp;

/// <summary>Lock-free single-producer / single-consumer float ring buffer.</summary>
public sealed class RingBuffer
{
    private readonly float[] _data;
    private readonly int _granularity;
    private long _head; // total floats written (producer)
    private long _tail; // total floats consumed (consumer)

    public RingBuffer(int capacity, int granularity = 1)
    {
        if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
        if (granularity <= 0) throw new ArgumentOutOfRangeException(nameof(granularity));
        _granularity = granularity;
        _data = new float[capacity];
    }

    public int Capacity => _data.Length;

    public int Count => (int)(Volatile.Read(ref _head) - Volatile.Read(ref _tail));

    public int Free => _data.Length - Count;

    /// <summary>Producer side. Writes as many whole granules as fit; returns floats written.</summary>
    public int Write(ReadOnlySpan<float> src)
    {
        long head = Volatile.Read(ref _head);
        long tail = Volatile.Read(ref _tail);
        int free = _data.Length - (int)(head - tail);
        int n = Math.Min(src.Length, free);
        n -= n % _granularity;
        if (n <= 0) return 0;
        int pos = (int)(head % _data.Length);
        int first = Math.Min(n, _data.Length - pos);
        src.Slice(0, first).CopyTo(_data.AsSpan(pos, first));
        if (first < n) src.Slice(first, n - first).CopyTo(_data.AsSpan(0, n - first));
        Volatile.Write(ref _head, head + n);
        return n;
    }

    /// <summary>Consumer side. Copies without consuming.</summary>
    public int Peek(Span<float> dst)
    {
        long tail = Volatile.Read(ref _tail);
        long head = Volatile.Read(ref _head);
        int n = Math.Min(dst.Length, (int)(head - tail));
        n -= n % _granularity;
        if (n <= 0) return 0;
        int pos = (int)(tail % _data.Length);
        int first = Math.Min(n, _data.Length - pos);
        _data.AsSpan(pos, first).CopyTo(dst);
        if (first < n) _data.AsSpan(0, n - first).CopyTo(dst.Slice(first));
        return n;
    }

    /// <summary>Consumer side. Discards up to n floats; returns floats discarded.</summary>
    public int Skip(int n)
    {
        long tail = Volatile.Read(ref _tail);
        long head = Volatile.Read(ref _head);
        n = Math.Min(n, (int)(head - tail));
        n -= n % _granularity;
        if (n <= 0) return 0;
        Volatile.Write(ref _tail, tail + n);
        return n;
    }

    public int Read(Span<float> dst)
    {
        int n = Peek(dst);
        return Skip(n);
    }
}
