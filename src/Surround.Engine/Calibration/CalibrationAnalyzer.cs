using Surround.Engine.Dsp;

namespace Surround.Engine.Calibration;

/// <summary>
/// Timestamped clocks of a run: the microphone's delivered sample count and, per output sink, the program frames its
/// reader has consumed, both against <see cref="System.Diagnostics.Stopwatch"/> ticks. Straight lines fitted over the
/// measurement window give each sink's ring latency (produced − consumed) without the sawtooth of the bursty capture
/// packets, so the analysis can report latencies as in steady state (ring latency = configured buffer), whatever the
/// ring held while the sweep played. The mic's own delivery delay is common to all sinks and cancels.
/// </summary>
public sealed class LatencyTrack
{
    private readonly int _rate, _micRate;
    private readonly long[] _micTicks, _micFrames;
    private readonly int _micCount;
    private readonly long[][] _sinkTicks, _sinkConsumed;
    private readonly int[] _sinkCounts;
    private long _t0;
    private (double A, double B)? _mic;
    private (double A, double B)?[] _sink = Array.Empty<(double, double)?>();

    public LatencyTrack(int programRate, int micRate, long[] micTicks, long[] micFrames, int micCount,
        long[][] sinkTicks, long[][] sinkConsumed, int[] sinkCounts, double[] targetMs)
    {
        _rate = programRate; _micRate = micRate;
        _micTicks = micTicks; _micFrames = micFrames; _micCount = Math.Min(micCount, micTicks.Length);
        _sinkTicks = sinkTicks; _sinkConsumed = sinkConsumed; _sinkCounts = sinkCounts;
        TargetMs = targetMs;
    }

    public IReadOnlyList<double> TargetMs { get; }

    /// <summary>Fits the clock lines over microphone positions [<paramref name="from"/>, <paramref name="to"/>).</summary>
    public void Fit(long from, long to)
    {
        _sink = new (double, double)?[_sinkTicks.Length];
        _mic = null;
        if (_micCount < 2) return;
        _t0 = _micTicks[0];
        _mic = Line(_micTicks, _micFrames, _micCount, i => _micFrames[i] >= from && _micFrames[i] < to);
        if (_mic is not { } m || m.B <= 0) { _mic = null; return; }
        double tFrom = (from - m.A) / m.B + _t0, tTo = (to - m.A) / m.B + _t0;
        for (int s = 0; s < _sinkTicks.Length; s++)
        {
            var ticks = _sinkTicks[s]; var cons = _sinkConsumed[s];
            _sink[s] = Line(ticks, cons, Math.Min(_sinkCounts[s], ticks.Length), i => ticks[i] >= tFrom && ticks[i] < tTo && cons[i] > 0);
        }
    }

    private (double A, double B)? Line(long[] x, long[] y, int count, Func<int, bool> use)
    {
        double n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (int i = 0; i < count; i++)
        {
            if (!use(i)) continue;
            double xi = x[i] - _t0, yi = y[i];
            n++; sx += xi; sy += yi; sxx += xi * xi; sxy += xi * yi;
        }
        if (n < 2) return null;
        double den = n * sxx - sx * sx;
        if (!(den > 0)) return null;
        double b = (n * sxy - sx * sy) / den;
        return ((sy - b * sx) / n, b);
    }

    /// <summary>Ring latency of <paramref name="sink"/> above its target (ms) at microphone position <paramref name="micPos"/>; 0 without data.</summary>
    public double ExcessAt(int sink, double micPos)
    {
        if (_mic is not { } m || sink < 0 || sink >= _sink.Length || _sink[sink] is not { } c) return 0;
        double t = (micPos - m.A) / m.B;
        double frames = micPos * _rate / _micRate - (c.A + c.B * t);
        return frames * 1000.0 / _rate - TargetMs[sink];
    }
}

/// <summary>Runtime facts the pure analysis cannot see in the recording.</summary>
public sealed class CalibrationExtras
{
    public LatencyTrack? Latency { get; init; }
    /// <summary>Per step: an underrun/overrun happened in an involved sink (timing of that step is unusable).</summary>
    public bool[]? StepGlitched { get; init; }
    /// <summary>Microphone positions where any raw channel clipped (the mono mix can hide it).</summary>
    public IReadOnlyList<long>? ClipPositions { get; init; }
    /// <summary>Diagnostics: one line per analysed sweep (raw latency, fill excess, SNR, level).</summary>
    public Action<string>? Log { get; init; }
}

/// <summary>
/// Turns the microphone recording of a <see cref="CalibrationPlan"/> into per-speaker relative arrival and level.
/// Each sweep is deconvolved (regularized spectral division by the sweep rendered at the microphone rate) and
/// band-limited into an analytic impulse response; the arrival is the onset of the direct sound: the first envelope
/// sample above 35 % of the window maximum (searched shortly before the maximum, as a later reflection can be
/// stronger), refined to the peak of that first lobe with parabolic interpolation. Everything is computed in
/// microphone samples and converted to ms at the end.
/// </summary>
public static class CalibrationAnalyzer
{
    public const double MinSnrDb = 10, WarnSnrDb = 15;
    private const double OnsetFraction = 0.35;
    private const double DetectSnrDb = 6;
    private const double MaxSnrDb = 100;
    private const double ClipLevel = 0.999;

    private readonly record struct Band(double Lo0, double Lo1, double Hi1, double Hi0);

    private sealed record Shape(float[] Window, double WeightHz, double BackSec, double LobeSec, double PreSec, double PostSec);

    private readonly record struct Event(bool Found, double Arrival, double Snr, double LevelDb, bool Clipped);

    public static CalibrationResult Analyze(CalibrationPlan plan, float[] mic, int micLength, int micRate, string micDeviceId,
        CalibrationExtras? extras = null, Action<CalibrationProgress>? progress = null)
    {
        micLength = Math.Min(micLength, mic.Length);
        double ratio = micRate / (double)plan.Rate;
        double cap = Math.Min(plan.Sweep.F2, 0.45 * micRate);
        var reference = plan.Sweep.Render(micRate, plan.Amplitude, cap);

        int pre = (int)Math.Round(0.01 * micRate);
        int guard = (int)Math.Round(0.005 * micRate);
        int win = (int)Math.Round(CalibrationPlan.MaxLatencySec * micRate);
        // After the latency window, a stretch of each sweep's own IR serves as an in-run noise estimate: a noise-
        // cancelling (ENC) mic may gate the silent lead-in to digital zero but not the noise while the sweep plays.
        int quietFrom = pre + win + guard, quietTo = pre + win + (int)Math.Round(0.1 * micRate);
        int segLen = quietTo + reference.Length + (int)Math.Round(0.05 * micRate);
        int n = 1;
        while (n < segLen + reference.Length) n <<= 1;
        var dec = new SweepDeconvolver(reference, n);

        Shape Make(Band b, double back, double lobe, double preW, double postW)
        {
            var w = dec.BandWindow(b.Lo0, b.Lo1, b.Hi1, b.Hi0, micRate, out double hz);
            return new Shape(w, hz, back, lobe, preW, postW);
        }
        var broad = Make(new Band(150, 300, 0.65 * cap, 0.9 * cap), 0.02, 0.0003, 0.002, 0.005);
        var level = Make(new Band(200, 400, Math.Min(4000, 0.5 * cap), Math.Min(6000, 0.7 * cap)), 0.02, 0.0003, 0.002, 0.005);
        var low = Make(new Band(25, 40, 120, 180), 0.06, 0.008, 0.01, 0.04);

        // Noise: the silent lead-in through the same deconvolution (only lags with full sweep support).
        long noiseStart = (long)Math.Round(plan.NoiseStartFrame * ratio);
        int noiseLen = (int)Math.Min(segLen, Math.Round(plan.NoiseFrames * ratio));
        double noisePow = 0;
        for (int i = 0; i < noiseLen; i++)
        {
            long p = noiseStart + i;
            if (p >= 0 && p < micLength) noisePow += (double)mic[p] * mic[p];
        }
        double noiseFloorDb = noiseLen > 0 ? 10 * Math.Log10(Math.Max(noisePow / noiseLen, 1e-12)) : -120;
        dec.Load(mic, micLength, noiseStart, noiseLen);
        int nFrom = 0, nTo = Math.Max(1, noiseLen - reference.Length);
        var env = new float[segLen];
        var noiseRms = new Dictionary<Shape, double>();
        foreach (var s in new[] { broad, low })
        {
            dec.Envelope(s.Window, env, segLen);
            double acc = 0;
            for (int i = nFrom; i < nTo; i++) acc += (double)env[i] * env[i];
            noiseRms[s] = Math.Sqrt(acc / (nTo - nFrom));
        }

        var clips = new List<long>();
        if (extras?.ClipPositions is { } cp) clips.AddRange(cp);
        for (int i = 0; i < micLength; i++) if (Math.Abs(mic[i]) >= ClipLevel) clips.Add(i);
        clips.Sort();
        bool micClipped = clips.Count > 0;

        var envT = new float[segLen];
        var envL = new float[segLen];

        Event Analyze(double pos, CalibrationSpeaker spk, Shape timing)
        {
            long b = (long)Math.Floor(pos) - pre;
            dec.Load(mic, micLength, b, segLen);
            dec.Envelope(timing.Window, envT, segLen);
            var t = Detect(envT, pre - guard, pre + win, timing, micRate);
            double quiet = 0;
            for (int i = quietFrom; i < quietTo; i++) quiet += (double)envT[i] * envT[i];
            double snr = Snr(t.Peak, Math.Max(noiseRms[timing], Math.Sqrt(quiet / (quietTo - quietFrom))));
            bool found = t.Found && snr >= DetectSnrDb;

            var lvlShape = spk.LowBand ? low : level;
            double levelDb = -200;
            if (found)
            {
                float[] e = envT;
                if (!ReferenceEquals(lvlShape, timing)) { dec.Envelope(lvlShape.Window, envL, segLen); e = envL; }
                // Locate the window with the level band's own onset (group delay differs between bands).
                var l = Detect(e, pre - guard, pre + win, lvlShape, micRate);
                double at = l.Found ? l.Arrival : t.Arrival;
                int from = Math.Max(0, (int)Math.Floor(at - lvlShape.PreSec * micRate));
                int to = Math.Min(segLen - 1, (int)Math.Ceiling(at + lvlShape.PostSec * micRate));
                double energy = 0;
                for (int i = from; i <= to; i++) energy += (double)e[i] * e[i];
                levelDb = 10 * Math.Log10(Math.Max(energy / lvlShape.WeightHz, 1e-30));
            }

            double arrival = t.Arrival + b - pos;
            double excess = extras?.Latency?.ExcessAt(spk.Sink, pos + plan.Sweep.Seconds / 2 * micRate) ?? 0;
            arrival -= excess * micRate / 1000.0;
            extras?.Log?.Invoke(FormattableString.Invariant(
                $"{spk.Id}: push {pos / micRate:0.000} s, gecikme {(t.Arrival + b - pos) * 1000.0 / micRate:0.000} ms, halka fazlası {excess:0.000} ms, SNR {snr:0.0} dB, seviye {levelDb:0.00} dB"));

            int ci = clips.BinarySearch(b);
            if (ci < 0) ci = ~ci;
            bool clipped = ci < clips.Count && clips[ci] < b + segLen;
            return new Event(found, arrival, snr, levelDb, clipped);
        }

        var spk = plan.Speakers;
        int refIdx = plan.Reference;
        var steps = plan.Steps;
        if (steps.Count > 0) extras?.Latency?.Fit((long)(steps[0].StartFrame * ratio), micLength);
        var evR = new Event[steps.Count];
        var evS = new Event[steps.Count];
        var stepLow = new bool[steps.Count];
        for (int i = 0; i < steps.Count; i++)
        {
            var st = steps[i];
            progress?.Invoke(new CalibrationProgress(CalibrationPhase.Analyzing, spk[st.Test].Id, i + 1, steps.Count,
                $"Analiz ediliyor ({i + 1}/{steps.Count})"));
            stepLow[i] = spk[refIdx].LowBand || spk[st.Test].LowBand;
            var timing = stepLow[i] ? low : broad;
            evR[i] = Analyze(st.StartFrame * ratio, spk[refIdx], timing);
            evS[i] = Analyze((st.StartFrame + plan.OffsetFrames) * ratio, spk[st.Test], timing);
        }

        bool Glitched(int i) => extras?.StepGlitched is { } g && i < g.Length && g[i];
        static bool Usable(Event e) => e.Found && e.Snr >= MinSnrDb;

        var results = new List<SpeakerCalibration>(spk.Count);
        for (int s = 0; s < spk.Count; s++)
        {
            var msgs = new List<string>();
            var idx = Enumerable.Range(0, steps.Count).Where(i => steps[i].Test == s || s == refIdx).ToList();
            var clean = idx.Where(i => !Glitched(i)).ToList();
            if (clean.Count < idx.Count) msgs.Add(clean.Count == 0 ? "Ses akışında kesinti oldu; tekrar deneyin." : "Bir ölçümde ses akışı kesildi; o tekrar atlandı.");

            if (s == refIdx)
            {
                // Reference: its own sweep in every step (and the test sweep too when it is measured against itself).
                var own = clean.SelectMany(i => steps[i].Test == s ? new[] { evR[i], evS[i] } : new[] { evR[i] }).ToList();
                double snr = Median(own.Select(e => e.Snr).ToList());
                bool ok = own.Any(Usable);
                AddSignalMessages(msgs, own, snr, own.Any(e => e.Found), isRef: true);
                results.Add(new SpeakerCalibration(spk[s].Id, ok, 0, 0, Round(snr, 1), 0, spk[s].LowBand, Join(msgs)));
                continue;
            }

            var testEv = clean.Select(i => evS[i]).ToList();
            var arr = new List<double>();
            var lvl = new List<double>();
            bool refMissing = false;
            foreach (int i in clean)
            {
                if (!Usable(evR[i])) { refMissing = true; continue; }
                if (!Usable(evS[i])) continue;
                arr.Add((evS[i].Arrival - evR[i].Arrival) * 1000.0 / micRate);
                lvl.Add(evS[i].LevelDb - evR[i].LevelDb);
            }
            double tsnr = Median(testEv.Select(e => e.Snr).ToList());
            bool tok = arr.Count > 0;
            bool lowBand = idx.Any(i => stepLow[i]);
            if (refMissing && arr.Count == 0) msgs.Add("Referans hoparlör algılanamadı.");
            AddSignalMessages(msgs, testEv, tsnr, testEv.Any(e => e.Found), isRef: false);
            double spread = arr.Count > 1 ? arr.Max() - arr.Min() : 0;
            if (spread > (lowBand ? 3.0 : 0.5)) msgs.Add($"Tekrarlar tutarsız (fark {spread:0.0#} ms).");
            if (tok && lowBand) msgs.Add("Bas bandında ölçüldü; zamanlama daha az güvenilir.");
            results.Add(new SpeakerCalibration(spk[s].Id, tok,
                tok ? Round(Median(arr), 3) : 0, tok ? Round(Median(lvl), 2) : 0,
                Round(tsnr, 1), Round(spread, 3), lowBand, Join(msgs)));
        }

        progress?.Invoke(new CalibrationProgress(CalibrationPhase.Done, null, steps.Count, steps.Count, "Kalibrasyon tamamlandı."));
        return new CalibrationResult(spk[refIdx].Id, micDeviceId, Round(noiseFloorDb, 1), micClipped, results);
    }

    private static void AddSignalMessages(List<string> msgs, List<Event> ev, double snr, bool detected, bool isRef)
    {
        if (ev.Count == 0) return;
        if (!detected) msgs.Add(isRef ? "Referans hoparlör algılanamadı." : "Hoparlör sesi algılanamadı.");
        else if (snr < WarnSnrDb) msgs.Add($"Sinyal çok zayıf (SNR {snr:0} dB).");
        if (ev.Any(e => e.Clipped)) msgs.Add("Mikrofon sinyali kırpıldı; seviyeyi düşürün.");
    }

    private static string? Join(List<string> msgs) => msgs.Count == 0 ? null : string.Join(" ", msgs.Distinct());

    private static double Snr(double peak, double noiseRms)
    {
        if (peak <= 0) return 0;
        if (noiseRms <= 0) return MaxSnrDb;
        return Math.Clamp(20 * Math.Log10(peak / noiseRms), -MaxSnrDb, MaxSnrDb);
    }

    private static double Median(List<double> v)
    {
        if (v.Count == 0) return 0;
        v.Sort();
        int m = v.Count / 2;
        return v.Count % 2 == 1 ? v[m] : 0.5 * (v[m - 1] + v[m]);
    }

    private static double Round(double v, int digits) => double.IsFinite(v) ? Math.Round(v, digits) : 0;

    private readonly record struct Detection(bool Found, double Arrival, double Peak);

    /// <summary>Onset of the first strong arrival in env[lo..hi] (lags), refined to its lobe peak.</summary>
    private static Detection Detect(float[] env, int lo, int hi, Shape s, int rate)
    {
        lo = Math.Max(1, lo);
        hi = Math.Min(env.Length - 2, hi);
        int kmax = lo;
        for (int k = lo; k <= hi; k++) if (env[k] > env[kmax]) kmax = k;
        double emax = env[kmax];
        if (!(emax > 0)) return new Detection(false, 0, 0);

        double thr = OnsetFraction * emax;
        int from = Math.Max(lo, kmax - (int)Math.Round(s.BackSec * rate));
        int k0 = kmax;
        for (int k = from; k <= kmax; k++) if (env[k] >= thr) { k0 = k; break; }
        int lobe = Math.Max(1, (int)Math.Round(s.LobeSec * rate));
        int p = k0;
        for (int k = k0; k <= Math.Min(hi, k0 + lobe); k++) if (env[k] > env[p]) p = k;

        double y0 = env[p - 1], y1 = env[p], y2 = env[p + 1];
        double den = y0 - 2 * y1 + y2;
        double d = den < 0 ? Math.Clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
        return new Detection(true, p + d, y1);
    }
}

/// <summary>
/// Deconvolves recordings of a known sweep: X = FFT(segment)·conj(S)/(|S|² + ε), then any band of it as an analytic
/// impulse response (envelope). Lag k of the result is the delay of the sweep's start relative to the segment start.
/// </summary>
internal sealed class SweepDeconvolver
{
    private readonly int _n;
    private readonly Fft _fft;
    private readonly float[] _gRe, _gIm, _xRe, _xIm, _re, _im;

    public SweepDeconvolver(float[] reference, int n)
    {
        _n = n;
        _fft = new Fft(n);
        _re = new float[n]; _im = new float[n];
        int h = n / 2 + 1;
        _gRe = new float[h]; _gIm = new float[h]; _xRe = new float[h]; _xIm = new float[h];

        Array.Copy(reference, _re, Math.Min(reference.Length, n));
        _fft.Transform(_re, _im, inverse: false);
        double max = 0;
        for (int k = 0; k < h; k++) max = Math.Max(max, (double)_re[k] * _re[k] + (double)_im[k] * _im[k]);
        double eps = 1e-5 * max;
        for (int k = 0; k < h; k++)
        {
            double p = (double)_re[k] * _re[k] + (double)_im[k] * _im[k];
            _gRe[k] = (float)(_re[k] / (p + eps));
            _gIm[k] = (float)(-_im[k] / (p + eps));
        }
    }

    /// <summary>Raised-cosine band window over bins 0..N/2 and its weight in Hz (Σw²·Δf).</summary>
    public float[] BandWindow(double lo0, double lo1, double hi1, double hi0, int rate, out double weightHz)
    {
        var w = new float[_n / 2 + 1];
        double df = rate / (double)_n, sum = 0;
        for (int k = 1; k < _n / 2; k++)
        {
            double f = k * df, g;
            if (f <= lo0 || f >= hi0) g = 0;
            else if (f < lo1) g = 0.5 - 0.5 * Math.Cos(Math.PI * (f - lo0) / (lo1 - lo0));
            else if (f > hi1) g = 0.5 + 0.5 * Math.Cos(Math.PI * (f - hi1) / (hi0 - hi1));
            else g = 1;
            w[k] = (float)g;
            sum += g * g;
        }
        weightHz = sum * df;
        return w;
    }

    /// <summary>Loads src[start .. start+len) (zeros outside [0, srcLen)) and deconvolves it.</summary>
    public void Load(float[] src, int srcLen, long start, int len)
    {
        Array.Clear(_re); Array.Clear(_im);
        for (int i = 0; i < len && i < _n; i++)
        {
            long p = start + i;
            if (p >= 0 && p < srcLen) _re[i] = src[p];
        }
        _fft.Transform(_re, _im, inverse: false);
        for (int k = 0; k <= _n / 2; k++)
        {
            float a = _re[k], b = _im[k];
            _xRe[k] = a * _gRe[k] - b * _gIm[k];
            _xIm[k] = a * _gIm[k] + b * _gRe[k];
        }
    }

    /// <summary>Envelope (|analytic IR|) of the loaded segment in band <paramref name="w"/>, first <paramref name="count"/> lags.</summary>
    public void Envelope(float[] w, float[] env, int count)
    {
        Array.Clear(_re); Array.Clear(_im);
        for (int k = 1; k < _n / 2; k++)
        {
            float g = 2 * w[k];
            if (g == 0) continue;
            _re[k] = _xRe[k] * g;
            _im[k] = _xIm[k] * g;
        }
        _fft.Transform(_re, _im, inverse: true);
        float inv = 1f / _n;
        for (int i = 0; i < count && i < _n; i++) env[i] = MathF.Sqrt(_re[i] * _re[i] + _im[i] * _im[i]) * inv;
    }
}
