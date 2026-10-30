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
    private readonly int[][] _idx;
    private readonly float[][] _coef;
    private readonly LinkwitzRiley[] _lp;

    public BassManager(int sampleRate, IReadOnlyList<BassSource> sources)
    {
        int n = sources.Count;
        _idx = new int[n][]; _coef = new float[n][]; _lp = new LinkwitzRiley[n];
        for (int k = 0; k < n; k++)
        {
            var s = sources[k];
            float g = (float)Math.Pow(10.0, s.GainDb / 20.0);
            var idx = new List<int>(); var coef = new List<float>();
            for (int c = 0; c < Channels.Count && c < s.MixRow.Length; c++)
                if (s.MixRow[c] != 0f) { idx.Add(c); coef.Add(s.MixRow[c] * g); }
            _idx[k] = idx.ToArray(); _coef[k] = coef.ToArray();
            _lp[k] = LinkwitzRiley.LowPass(sampleRate, s.HighPassHz);
        }
    }

    public int SourceCount => _lp.Length;

    /// <summary>Writes one bass sample per frame into <paramref name="bass"/>.</summary>
    public void Process(ReadOnlySpan<float> logical, Span<float> bass, int frames)
    {
        bass.Slice(0, frames).Clear();
        for (int k = 0; k < _lp.Length; k++)
        {
            var idx = _idx[k]; var coef = _coef[k]; var lp = _lp[k];
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
