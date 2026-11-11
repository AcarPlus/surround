using Surround.Engine.Config;

namespace Surround.Engine.Dsp;

/// <summary>
/// Immutable, precomputed form of <see cref="ProcessingConfig"/> for one sample rate. Built off the audio thread and
/// handed to <see cref="GlobalProcessor.Update"/>.
/// </summary>
public sealed class ProcessingSettings
{
    // Stage layout: 10 EQ bands, bass boost low shelf, clarity peak, clarity high shelf, 6 parametric bands.
    public const int StageCount = ProcessingConfig.Bands + 3 + PeqBand.MaxBands;
    public const double BassBoostHz = 100, ClarityPeakHz = 3500, ClarityPeakQ = 1.0, ClarityShelfHz = 10000;

    public bool Enabled { get; private init; }
    public float Preamp { get; private init; } = 1f;
    public BiquadCoefs[] Stages { get; private init; } = Flat();
    public bool HasEq { get; private init; }
    // Compressor (dB domain). Ratio 1 = off.
    public float ThresholdDb { get; private init; }
    public float Ratio { get; private init; } = 1f;
    public float MakeupDb { get; private init; }
    /// <summary>Side gain for the M/S pairs (1 = unchanged).</summary>
    public float Width { get; private init; } = 1f;

    public static readonly ProcessingSettings Bypass = new() { Enabled = false };

    private static BiquadCoefs[] Flat()
    {
        var s = new BiquadCoefs[StageCount];
        Array.Fill(s, BiquadCoefs.Identity);
        return s;
    }

    private static double C(double v, double lo, double hi) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : 0;

    /// <summary>All EQ stages of the processing config (10 bands, bass boost, clarity, peq), in <see cref="Stages"/> order.</summary>
    public static BiquadCoefs[] BuildStages(ProcessingConfig p, double fs)
    {
        var stages = new BiquadCoefs[StageCount];
        EqDesign.TenBand(fs, p.Eq).CopyTo(stages, 0);
        int k = ProcessingConfig.Bands;
        double clarity = C(p.ClarityDb, 0, 12);
        stages[k] = BiquadCoefs.LowShelf(fs, BassBoostHz, C(p.BassBoostDb, 0, 12));
        stages[k + 1] = BiquadCoefs.Peaking(fs, ClarityPeakHz, ClarityPeakQ, clarity);
        stages[k + 2] = BiquadCoefs.HighShelf(fs, ClarityShelfHz, clarity / 2);
        EqDesign.Peq(fs, p.Peq).CopyTo(stages, k + 3);
        return stages;
    }

    public static ProcessingSettings Build(ProcessingConfig? p, double fs)
    {
        if (p is null || !p.Enabled) return Bypass;
        var stages = BuildStages(p, fs);
        double preampDb = p.AutoPreamp ? FrequencyResponse.AutoPreampDb(stages, fs) : C(p.PreampDb, -24, 12);

        // dynamicBoost 0..1 → threshold -6..-30 dB, ratio 1..4; half of the reduction at 0 dBFS comes back as makeup.
        double amt = C(p.DynamicBoost, 0, 1);
        double thr = -6 - 24 * amt, ratio = 1 + 3 * amt;
        double makeup = amt == 0 ? 0 : 0.5 * (-thr) * (1 - 1 / ratio);

        return new ProcessingSettings
        {
            Enabled = true,
            Preamp = (float)Math.Pow(10, preampDb / 20),
            Stages = stages,
            HasEq = !EqDesign.IsFlat(stages),
            ThresholdDb = (float)thr,
            Ratio = (float)ratio,
            MakeupDb = (float)makeup,
            Width = (float)(1 + C(p.Ambience, 0, 1)),
        };
    }
}

/// <summary>
/// Global "make cheap speakers sound good" chain on interleaved logical frames, in place:
/// preamp → 10-band EQ → bass boost → clarity → linked compressor (dynamic boost) → M/S ambience.
/// The 7.1 lanes are always processed; height lanes only when the layout plays them (they are silent otherwise).
/// Single audio thread calls <see cref="Process"/>; any thread may call <see cref="Update"/>.
/// Gains are smoothed per sample so live changes do not click; filter coefficients swap at buffer boundaries.
/// </summary>
public sealed class GlobalProcessor
{
    private const int Ch = Channels.Count;
    private const float KneeDb = 6f;

    private volatile ProcessingSettings _settings = ProcessingSettings.Bypass;
    private ProcessingSettings? _applied;
    private readonly double[] _z = new double[Ch * ProcessingSettings.StageCount * 2];
    private readonly int[] _lanes;
    private readonly bool _top, _topBack;
    private readonly float _atk, _rel, _smooth;
    private float _preamp = 1f, _width = 1f, _makeup, _grDb;
    private bool _active;

    /// <param name="used">Per logical channel; height lanes not marked are skipped. Null = all lanes.</param>
    public GlobalProcessor(int sampleRate, IReadOnlyList<bool>? used = null)
    {
        _lanes = Enumerable.Range(0, Ch)
            .Where(c => !Channels.IsHeight(c) || used is null || (c < used.Count && used[c]))
            .ToArray();
        _top = _lanes.Contains(Channels.TFL) && _lanes.Contains(Channels.TFR);
        _topBack = _lanes.Contains(Channels.TBL) && _lanes.Contains(Channels.TBR);
        _atk = Coef(sampleRate, 0.005);
        _rel = Coef(sampleRate, 0.150);
        _smooth = Coef(sampleRate, 0.030);
    }

    private static float Coef(double fs, double seconds) => (float)(1 - Math.Exp(-1 / (seconds * fs)));

    public void Update(ProcessingSettings settings) => _settings = settings ?? ProcessingSettings.Bypass;

    public void Process(Span<float> buf, int frames)
    {
        var s = _settings;
        if (!ReferenceEquals(s, _applied))
        {
            foreach (int c in _lanes)
                BiquadCascade.ClearIdle(s.Stages, _z.AsSpan(c * ProcessingSettings.StageCount * 2, ProcessingSettings.StageCount * 2));
            if (!s.Enabled && _active) { Array.Clear(_z); _preamp = 1f; _width = 1f; _makeup = 0; _grDb = 0; }
            _applied = s;
            _active = s.Enabled;
        }
        if (!s.Enabled) return;

        bool eq = s.HasEq;
        float invRatio = 1f / s.Ratio, slope = 1f - invRatio;
        int zStride = ProcessingSettings.StageCount * 2;
        var lanes = _lanes;

        for (int f = 0; f < frames; f++)
        {
            int b = f * Ch;
            _preamp = Approach(_preamp, s.Preamp, _smooth);
            float peak = 0f;
            for (int i = 0; i < lanes.Length; i++)
            {
                int c = lanes[i];
                float x = buf[b + c] * _preamp;
                if (eq) x = (float)BiquadCascade.Process(s.Stages, _z.AsSpan(c * zStride, zStride), x);
                buf[b + c] = x;
                float a = Math.Abs(x);
                if (a > peak) peak = a;
            }

            // Feed-forward compressor, one detector for all channels so the image does not shift.
            _makeup = Approach(_makeup, s.MakeupDb, _smooth);
            if (slope > 0f || _grDb > 1e-4f || Math.Abs(_makeup) > 1e-4f)
            {
                float over = (peak > 1e-6f ? 20f * MathF.Log10(peak) : -120f) - s.ThresholdDb;
                float target = 2f * over < -KneeDb ? 0f
                    : 2f * over > KneeDb ? over * slope
                    : slope * (over + KneeDb / 2) * (over + KneeDb / 2) / (2 * KneeDb);
                _grDb += (target - _grDb) * (target > _grDb ? _atk : _rel);
                float g = MathF.Exp((_makeup - _grDb) * 0.11512925f); // ln(10)/20
                for (int i = 0; i < lanes.Length; i++) buf[b + lanes[i]] *= g;
            }

            _width = Approach(_width, s.Width, _smooth);
            if (_width != 1f)
            {
                Widen(buf, b + Channels.FL, b + Channels.FR, _width);
                Widen(buf, b + Channels.BL, b + Channels.BR, _width);
                Widen(buf, b + Channels.SL, b + Channels.SR, _width);
                if (_top) Widen(buf, b + Channels.TFL, b + Channels.TFR, _width);
                if (_topBack) Widen(buf, b + Channels.TBL, b + Channels.TBR, _width);
            }
        }
    }

    /// <summary>One-pole step toward <paramref name="target"/>, snapping when close so bypass checks become exact.</summary>
    internal static float Approach(float cur, float target, float coef)
    {
        float d = target - cur;
        return Math.Abs(d) < 1e-5f ? target : cur + d * coef;
    }

    private static void Widen(Span<float> buf, int l, int r, float w)
    {
        float m = 0.5f * (buf[l] + buf[r]), side = 0.5f * (buf[l] - buf[r]) * w;
        buf[l] = m + side;
        buf[r] = m - side;
    }
}
