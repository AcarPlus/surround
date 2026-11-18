namespace Surround.Engine.Calibration;

/// <summary>
/// Finds a <see cref="CalibrationPlan"/> inside a recording made on another clock (the phone): where it starts and at
/// what rate it runs. The recording is deconvolved with the sweep in chunks into one broadband envelope, pooled to
/// 1 ms bins, and the plan's sweep pattern (reference at every step start, test one offset later) is slid over it;
/// the best fit gives the coarse offset (the full pattern matches only at the true offset; a shift by a whole step or
/// repeat loses at least one step). Then each step's reference peak is located precisely and a robust line through
/// them (Theil–Sen) gives the rate, so the two clocks' difference (phone vs PC, tens of ppm) does not bias the
/// relative arrivals. The resulting map puts every push <see cref="LeadSec"/> before the reference's arrival.
/// </summary>
public static class ExternalAlignment
{
    /// <summary>Mapped push → reference arrival; other speakers may arrive up to this much earlier.</summary>
    public const double LeadSec = 0.4;
    /// <summary>Arrival search window after a mapped push (arrivals up to <see cref="LeadSec"/> later than the reference).</summary>
    public const double WindowSec = 0.8;
    private const double MaxPpm = 2000;

    public sealed record Alignment(RecordingMap Map, double ClockPpm, int ReferenceHits, int Steps);

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
        long first = plan.Steps.Count > 0 ? plan.Steps[0].StartFrame : 0;
        var marks = new List<int>(); // pattern times relative to the first reference push, in bins
        foreach (var st in plan.Steps)
        {
            marks.Add((int)Math.Round((st.StartFrame - first) * ratio / bin));
            marks.Add((int)Math.Round((st.StartFrame + plan.OffsetFrames - first) * ratio / bin));
        }
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

        // ---- fine: the reference peak of every step ----
        double noise = Percentile(pooled, 0.2);
        int search = (int)Math.Round(0.03 * micRate);
        var xs = new List<double>(); var ys = new List<double>();
        foreach (var st in plan.Steps)
        {
            double expect = bestO * bin + (st.StartFrame - first) * ratio;
            int lo = Math.Max(1, (int)expect - search), hi = Math.Min(len - 2, (int)expect + search + 2 * bin);
            if (hi <= lo) continue;
            int k = lo;
            for (int i = lo; i <= hi; i++) if (env[i] > env[k]) k = i;
            if (!(env[k] > 4 * noise)) continue; // ~12 dB above the typical envelope: a real arrival
            double y0 = env[k - 1], y1 = env[k], y2 = env[k + 1], den = y0 - 2 * y1 + y2;
            double d = den < 0 ? Math.Clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
            xs.Add(st.StartFrame); ys.Add(k + d);
        }
        if (xs.Count == 0)
            throw new InvalidOperationException("Telefon kaydında referans hoparlör bulunamadı. Telefonu dinleme noktasına koyup tekrar deneyin.");

        double scale = ratio;
        if (xs.Count >= 3)
        {
            var slopes = new List<double>();
            for (int i = 0; i < xs.Count; i++)
                for (int j = i + 1; j < xs.Count; j++)
                    if (xs[j] - xs[i] > plan.Rate) slopes.Add((ys[j] - ys[i]) / (xs[j] - xs[i]));
            if (slopes.Count > 0)
            {
                double m = Median(slopes);
                if (Math.Abs(m / ratio - 1) * 1e6 <= MaxPpm) scale = m;
            }
        }
        double intercept = Median(xs.Select((x, i) => ys[i] - x * scale).ToList());
        var map = new RecordingMap(intercept - LeadSec * micRate, scale);
        return new Alignment(map, Math.Round((scale / ratio - 1) * 1e6, 1), xs.Count, plan.Steps.Count);
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
