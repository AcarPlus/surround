namespace Surround.Engine.Dsp;

/// <summary>
/// 4th-order Linkwitz-Riley section (two cascaded Butterworth biquads). The high-pass and low-pass at the same
/// frequency sum to an all-pass, so a satellite's cut bass replayed on a receiver keeps the overall level flat.
/// </summary>
public sealed class LinkwitzRiley
{
    private readonly Biquad _a, _b;

    private LinkwitzRiley(Biquad a, Biquad b) { _a = a; _b = b; }

    public static LinkwitzRiley HighPass(double sampleRate, double hz) =>
        new(Biquad.HighPass(sampleRate, hz), Biquad.HighPass(sampleRate, hz));

    public static LinkwitzRiley LowPass(double sampleRate, double hz) =>
        new(Biquad.LowPass(sampleRate, hz), Biquad.LowPass(sampleRate, hz));

    public float Process(float x) => _b.Process(_a.Process(x));

    public void Reset() { _a.Reset(); _b.Reset(); }
}

/// <summary>One high-passed speaker as seen by the bass bus: its mix row (× its gain) and crossover frequency.</summary>
public sealed record BassSource(float[] MixRow, double GainDb, double HighPassHz);

/// <summary>
/// Builds the bass bus from logical frames: for every high-passed speaker, the LR4 low-pass of its mix-row signal
/// (the part its own high-pass removes), summed. Runs once per buffer in the engine, before the per-device sinks,
/// because the receivers may sit on a different device than the speakers whose bass was cut.
/// </summary>
public sealed class BassManager
{
    /// <summary>Immutable sparse rows (× gain) of the sources; swapped by reference on a live change.</summary>
    private sealed record Rows(int[][] Idx, float[][] Coef);

    private volatile Rows _rows;
    private readonly double[] _hz;
    private readonly LinkwitzRiley[] _lp;

    public BassManager(int sampleRate, IReadOnlyList<BassSource> sources)
    {
        int n = sources.Count;
        _lp = new LinkwitzRiley[n];
        _hz = new double[n];
        for (int k = 0; k < n; k++)
        {
            _hz[k] = sources[k].HighPassHz;
            _lp[k] = LinkwitzRiley.LowPass(sampleRate, sources[k].HighPassHz);
        }
        _rows = Build(sources);
    }

    private static Rows Build(IReadOnlyList<BassSource> sources)
    {
        int n = sources.Count;
        var idxs = new int[n][]; var coefs = new float[n][];
        for (int k = 0; k < n; k++)
        {
            var s = sources[k];
            float g = (float)Math.Pow(10.0, s.GainDb / 20.0);
            var idx = new List<int>(); var coef = new List<float>();
            for (int c = 0; c < Channels.Count && c < s.MixRow.Length; c++)
                if (s.MixRow[c] != 0f) { idx.Add(c); coef.Add(s.MixRow[c] * g); }
            idxs[k] = idx.ToArray(); coefs[k] = coef.ToArray();
        }
        return new Rows(idxs, coefs);
    }

    public int SourceCount => _lp.Length;

    /// <summary>
    /// Live change of the sources' mix rows and gains (same count and crossover frequencies as at construction, else false
    /// and nothing changes). Built on the caller's thread and swapped by reference. No glide is needed: the step only
    /// reaches the bus through each source's LR4 low-pass, whose output stays continuous.
    /// </summary>
    public bool SetSources(IReadOnlyList<BassSource> sources)
    {
        if (sources.Count != _lp.Length) return false;
        for (int k = 0; k < sources.Count; k++) if (sources[k].HighPassHz != _hz[k]) return false;
        _rows = Build(sources);
        return true;
    }

    /// <summary>Writes one bass sample per frame into <paramref name="bass"/>.</summary>
    public void Process(ReadOnlySpan<float> logical, Span<float> bass, int frames)
    {
        bass.Slice(0, frames).Clear();
        var rows = _rows;
        for (int k = 0; k < _lp.Length; k++)
        {
            var idx = rows.Idx[k]; var coef = rows.Coef[k]; var lp = _lp[k];
            for (int f = 0; f < frames; f++)
            {
                float acc = 0f;
                int b = f * Channels.Count;
                for (int j = 0; j < idx.Length; j++) acc += logical[b + idx[j]] * coef[j];
                bass[f] += lp.Process(acc);
            }
        }
    }
}
