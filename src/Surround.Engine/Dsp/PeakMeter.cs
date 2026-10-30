namespace Surround.Engine.Dsp;

/// <summary>
/// Per-logical-channel peak meter. <see cref="Update"/> is called from the audio thread (no allocations);
/// <see cref="Drain"/> from a UI/timer thread, returning peaks since the previous drain.
/// A rare lost update between the two threads only affects the visual meter and is accepted.
/// </summary>
public sealed class PeakMeter
{
    private readonly float[] _peaks = new float[Channels.Count];

    /// <summary>Floor reported for silence, dBFS.</summary>
    public const float FloorDb = -90f;

    /// <summary>Scans <paramref name="frames"/> interleaved logical frames (<see cref="Channels.Count"/> channels each).</summary>
    public void Update(ReadOnlySpan<float> logical, int frames)
    {
        const int n = Channels.Count;
        if (frames <= 0 || logical.Length < frames * n) return;
        Span<float> local = stackalloc float[n];
        for (int f = 0, i = 0; f < frames; f++)
            for (int c = 0; c < n; c++, i++)
            {
                float v = MathF.Abs(logical[i]);
                if (v > local[c]) local[c] = v;
            }
        for (int c = 0; c < n; c++)
            if (local[c] > Volatile.Read(ref _peaks[c])) Volatile.Write(ref _peaks[c], local[c]);
    }

    /// <summary>Writes linear peaks (<see cref="Channels.Count"/> values) and resets the hold.</summary>
    public void Drain(Span<float> dest)
    {
        for (int c = 0; c < Channels.Count && c < dest.Length; c++)
            dest[c] = Interlocked.Exchange(ref _peaks[c], 0f);
    }

    public static float ToDb(float linear) =>
        linear <= 0 || float.IsNaN(linear) ? FloorDb : Math.Clamp(20f * MathF.Log10(linear), FloorDb, 0f);
}
