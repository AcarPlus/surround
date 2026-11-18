namespace Surround.Engine.Calibration;

/// <summary>
/// Finds a <see cref="CalibrationPlan"/> inside a recording made on another clock (the phone): where it starts, at what
/// rate it runs, and where the recording lost (or gained) audio. The recording is deconvolved with the sweep in chunks
/// into one broadband envelope, pooled to 1 ms bins, and the plan's sweep pattern (reference at every step start, test
/// one offset later) is slid over it; the best fit gives the coarse offset. Then the reference peak of every step (and
/// of the plan's closing reference) is tracked one after another, each searched around where the previous one predicts
/// it (±<see cref="TrackSec"/>), so a gap in the recording (phone browsers drop blocks of tens of ms) moves the
/// following anchors instead of losing them. The rate comes from the spacings that agree with the nominal one (gaps
/// are outliers); each step gets its own map from its own reference, and a step whose two framing references are not
/// as far apart as the program played them had a gap inside it: <see cref="Alignment.StepGap"/> (its relative arrival
/// would be wrong by the gap).
/// </summary>
public static class ExternalAlignment
{
    /// <summary>Mapped push → reference arrival; other speakers may arrive up to this much earlier.</summary>
    public const double LeadSec = 0.4;
    /// <summary>Arrival search window after a mapped push (arrivals up to <see cref="LeadSec"/> later than the reference).</summary>
    public const double WindowSec = 0.8;
    /// <summary>Search range of a reference around the position the previous one predicts (largest tolerated gap).</summary>
    public const double TrackSec = 0.25;
    /// <summary>Two framing references further off their played spacing than this: the step had a gap.</summary>
    public const double GapToleranceMs = 0.5;
    private const double MaxPpm = 2000;

    /// <param name="Map">Map of the first step (noise window).</param>
    public sealed record Alignment(RecordingMap Map, double ClockPpm, int ReferenceHits, int Steps)
    {
        /// <summary>Per step: anchored on that step's own reference.</summary>
        public IReadOnlyList<RecordingMap> StepMaps { get; init; } = Array.Empty<RecordingMap>();
        /// <summary>Per step: the recording lost or gained audio between its reference and the next one.</summary>
        public IReadOnlyList<bool> StepGap { get; init; } = Array.Empty<bool>();
        public int Gaps => StepGap.Count(g => g);
        /// <summary>Total size of the gaps found (ms, absolute).</summary>
        public double GapMs { get; init; }
        /// <summary>Recording position (s) of every tracked reference (steps, then the closing one); null = not found.</summary>
        public IReadOnlyList<double?> AnchorsSec { get; init; } = Array.Empty<double?>();
    }

    public static Alignment Find(CalibrationPlan plan, float[] mic, int len, int micRate, CancellationToken ct = default)
    {
        len = Math.Min(len, mic.Length);
        double ratio = micRate / (double)plan.Rate;
        var env = BroadbandEnvelope(plan, mic, len, micRate, ct);

        // ---- coarse: pattern score over 1 ms bins ----
        int bin = Math.Max(1, micRate / 1000);
        int nb = len / bin;
        var pooled = new float[nb];
        for (int b = 0; b < nb; b++)
        {
            float m = 0;
            for (int i = b * bin; i < (b + 1) * bin; i++) if (env[i] > m) m = env[i];
            pooled[b] = m;
        }
        // Reference pushes: every step start, then the closing reference.
        var refs = plan.Steps.Select(st => st.StartFrame).ToList();
        if (plan.ClosingFrame is { } closing) refs.Add(closing);
        long first = refs.Count > 0 ? refs[0] : 0;
        var marks = new List<int>(); // pattern times relative to the first reference push, in bins
        foreach (var st in plan.Steps)
        {
            marks.Add((int)Math.Round((st.StartFrame - first) * ratio / bin));
            marks.Add((int)Math.Round((st.StartFrame + plan.OffsetFrames - first) * ratio / bin));
        }
        if (plan.ClosingFrame is { } cf) marks.Add((int)Math.Round((cf - first) * ratio / bin));
        if (marks.Count == 0) throw new InvalidOperationException("Ölçüm programı boş.");
        int span = marks.Max();
        // Pool ±2 bins so the per-speaker latency differences inside a step (< ±0.4 s are allowed, but most are a
        // few ms) still add up; the reference marks dominate as the reference plays in every step.
        float At(int b) { float m = 0; for (int d = -2; d <= 2; d++) { int k = b + d; if (k >= 0 && k < nb && pooled[k] > m) m = pooled[k]; } return m; }
        int bestO = -1; double best = 0;
        for (int o = 0; o + span < nb; o++)
        {
            double s = 0;
            foreach (int mk in marks) s += At(o + mk);
            if (s > best) { best = s; bestO = o; }
        }
        if (bestO < 0 || !(best > 0))
            throw new InvalidOperationException("Telefon kaydında ölçüm sesi bulunamadı. Telefon hoparlörleri duyabiliyor mu?");
        ct.ThrowIfCancellationRequested();

        // ---- fine: track the reference peaks one after another ----
        // Nothing else plays within ±TrackSec of a reference: the test sweeps are ≥ 0.6 s away (offset 1 s, relative
        // arrivals within ±0.4 s).
        double noise = Percentile(pooled, 0.2);
        int track = (int)Math.Round(TrackSec * micRate);
        double?[] Track(double startPos)
        {
            var a = new double?[refs.Count];
            double lastPos = startPos; long lastFrame = first;
            for (int r = 0; r < refs.Count; r++)
            {
                double expect = lastPos + (refs[r] - lastFrame) * ratio;
                int lo = Math.Max(1, (int)expect - track), hi = Math.Min(len - 2, (int)expect + track);
                if (hi <= lo) continue;
                int k = lo;
                for (int i = lo; i <= hi; i++) if (env[i] > env[k]) k = i;
                if (!(env[k] > 4 * noise)) continue; // ~12 dB above the typical envelope: a real arrival
                double y0 = env[k - 1], y1 = env[k], y2 = env[k + 1], den = y0 - 2 * y1 + y2;
                double d = den < 0 ? Math.Clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
                a[r] = k + d;
                lastPos = k + d; lastFrame = refs[r];
            }
            return a;
        }
        // Gaps shift the later part of the pattern, so the coarse fit can lock a whole step early or late. Each start a
        // few steps around it is tracked; the true one finds every reference (a shifted one misses the silent slot
        // before the first or after the closing reference), the earliest-found start wins a tie.
        long period = refs.Count > 1 ? refs[1] - refs[0] : 0;
        double?[] anchor = Track(bestO * bin);
        int bestHits = anchor.Count(x => x.HasValue);
        for (int sh = 1; period > 0 && sh <= 3; sh++)
            foreach (int sign in new[] { -1, 1 })
            {
                var a = Track(bestO * bin + sign * sh * period * ratio);
                int h = a.Count(x => x.HasValue);
                if (h > bestHits) { bestHits = h; anchor = a; }
            }
        int hits = 0;
        for (int i = 0; i < plan.Steps.Count; i++) if (anchor[i].HasValue) hits++;
        if (hits == 0)
            throw new InvalidOperationException("Telefon kaydında referans hoparlör bulunamadı. Telefonu dinleme noktasına koyup tekrar deneyin.");

        // ---- rate: spacings of neighbouring anchors that agree with the nominal rate (a gap is far outside) ----
        var slopes = new List<double>();
        for (int r = 0; r + 1 < refs.Count; r++)
            if (anchor[r] is { } a && anchor[r + 1] is { } b)
            {
                double m = (b - a) / (refs[r + 1] - refs[r]);
                if (Math.Abs(m / ratio - 1) * 1e6 <= MaxPpm) slopes.Add(m);
            }
        double scale = slopes.Count > 0 ? Median(slopes) : ratio;

        // ---- per step: own map, gap check against the next reference ----
        var maps = new RecordingMap[plan.Steps.Count];
        var gap = new bool[plan.Steps.Count];
        double gapMs = 0;
        double? prev = null; long prevFrame = 0;
        for (int i = 0; i < plan.Steps.Count; i++)
        {
            long f = refs[i];
            double pos = anchor[i] ?? (prev is { } p ? p + (f - prevFrame) * scale : bestO * bin + (f - first) * ratio);
            if (anchor[i] is { } ai) { prev = ai; prevFrame = f; }
            maps[i] = new RecordingMap(pos - f * scale - LeadSec * micRate, scale);
            if (anchor[i] is { } a && i + 1 < refs.Count && anchor[i + 1] is { } b)
            {
                double dev = (b - a - (refs[i + 1] - f) * scale) * 1000.0 / micRate;
                if (Math.Abs(dev) > GapToleranceMs) { gap[i] = true; gapMs += Math.Abs(dev); }
            }
        }
        return new Alignment(maps[0], Math.Round((scale / ratio - 1) * 1e6, 1), hits, plan.Steps.Count)
            {
                StepMaps = maps, StepGap = gap, GapMs = Math.Round(gapMs, 1),
                AnchorsSec = anchor.Select(a => a is { } v ? Math.Round(v / micRate, 5) : (double?)null).ToList(),
            };
    }

    /// <summary>|analytic IR| of the whole recording in a 300 Hz – 0.65·top band; index = sweep start sample.</summary>
    private static float[] BroadbandEnvelope(CalibrationPlan plan, float[] mic, int len, int micRate, CancellationToken ct)
    {
        double cap = Math.Min(plan.Sweep.F2, 0.45 * micRate);
        var reference = plan.Sweep.Render(micRate, plan.Amplitude, cap);
        int n = 1;
        while (n < 4 * reference.Length) n <<= 1;
        var dec = new SweepDeconvolver(reference, n);
        var w = dec.BandWindow(150, 300, 0.65 * cap, 0.9 * cap, micRate, out _);
        int hop = n - reference.Length - 1;
        var env = new float[len];
        var buf = new float[hop];
        for (long b = 0; b < len; b += hop)
        {
            ct.ThrowIfCancellationRequested();
            dec.Load(mic, len, b, n);
            dec.Envelope(w, buf, hop);
            for (int k = 0; k < hop && b + k < len; k++) env[b + k] = buf[k];
        }
        return env;
    }

    private static double Median(List<double> v)
    {
        v.Sort();
        int m = v.Count / 2;
        return v.Count % 2 == 1 ? v[m] : 0.5 * (v[m - 1] + v[m]);
    }

    private static float Percentile(float[] v, double q)
    {
        if (v.Length == 0) return 0;
        var c = (float[])v.Clone();
        Array.Sort(c);
        return c[(int)Math.Clamp(q * (c.Length - 1), 0, c.Length - 1)];
    }
}
