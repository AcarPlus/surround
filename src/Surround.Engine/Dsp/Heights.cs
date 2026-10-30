namespace Surround.Engine.Dsp;

/// <summary>Tuning of the derived height lanes (see docs/duzen.md).</summary>
public static class HeightTuning
{
    /// <summary>Only the ambience above this reaches the height lanes (2nd-order Butterworth high-pass).</summary>
    public const double HighPassHz = 200;

    // All-pass delay sets (ms) of the height decorrelators; all differ from the floor surround sets in
    // SurroundRenderer, so the heights are decorrelated from the side/back channels.
    internal static readonly double[] L1 = { 1.3, 3.7, 6.7 }, L2 = { 1.7, 4.1, 7.3 };
    internal static readonly double[] R1 = { 1.5, 3.9, 7.1 }, R2 = { 2.1, 4.6, 6.9 };

    internal static Decorrelator? Make(int fs, double[] ms, bool needed) =>
        needed ? new Decorrelator(fs, ms[0], ms[1], ms[2]) : null;

    internal static int DelayFrames(int fs) => (int)Math.Round(UpmixTuning.SurroundDelayMs * fs / 1000);
}

/// <summary>
/// Upmix side of the height lanes: the ambient L/R pair (high-passed at <see cref="HeightTuning.HighPassHz"/>) goes
/// through height-only all-pass decorrelators into TFL/TBL and TFR/TBR, then the same precedence delay as the
/// surrounds. Additive (the floor channels keep all their energy). Per side, with both a front and a back height the
/// complementary pair is used (front = (H1 + H2)/2, back = (H1 - H2)/2: the powers sum to the ambient power × gain²
/// and front + back = H1, so a top-center speaker gets no comb); with one of them that lane gets the flat H1.
/// Lanes no speaker uses are written as 0 and cost nothing.
/// </summary>
internal sealed class HeightRenderer
{
    private readonly Biquad? _hpL, _hpR;
    private readonly Decorrelator? _l1, _l2, _r1, _r2;
    private readonly DelayLine _dTFL, _dTBL, _dTFR, _dTBR;
    private readonly bool _tfl, _tbl, _tfr, _tbr;

    private HeightRenderer(int fs, UpmixLayout layout)
    {
        _tfl = layout.Has(Channels.TFL); _tbl = layout.Has(Channels.TBL);
        _tfr = layout.Has(Channels.TFR); _tbr = layout.Has(Channels.TBR);
        if (_tfl || _tbl) _hpL = Biquad.HighPass(fs, HeightTuning.HighPassHz);
        if (_tfr || _tbr) _hpR = Biquad.HighPass(fs, HeightTuning.HighPassHz);
        _l1 = HeightTuning.Make(fs, HeightTuning.L1, _tfl || _tbl);
        _l2 = HeightTuning.Make(fs, HeightTuning.L2, _tfl && _tbl);
        _r1 = HeightTuning.Make(fs, HeightTuning.R1, _tfr || _tbr);
        _r2 = HeightTuning.Make(fs, HeightTuning.R2, _tfr && _tbr);
        int d = HeightTuning.DelayFrames(fs);
        _dTFL = new DelayLine(_tfl ? d : 0); _dTBL = new DelayLine(_tbl ? d : 0);
        _dTFR = new DelayLine(_tfr ? d : 0); _dTBR = new DelayLine(_tbr ? d : 0);
    }

    /// <summary>Null when no speaker plays a height lane.</summary>
    public static HeightRenderer? Create(int fs, UpmixLayout layout) => layout.AnyHeight ? new HeightRenderer(fs, layout) : null;

    /// <param name="frame">The logical samples of this output frame; TFL/TFR/TBL/TBR are overwritten.</param>
    public void Render(float al, float ar, float gain, Span<float> frame)
    {
        float tfl = 0f, tbl = 0f, tfr = 0f, tbr = 0f;
        if (_l1 != null)
        {
            float x = _hpL!.Process(al) * gain;
            float h1 = _l1.Process(x);
            if (_l2 != null)
            {
                float h2 = _l2.Process(x);
                tfl = 0.5f * (h1 + h2);
                tbl = 0.5f * (h1 - h2);
            }
            else if (_tfl) tfl = h1;
            else tbl = h1;
        }
        if (_r1 != null)
        {
            float x = _hpR!.Process(ar) * gain;
            float h1 = _r1.Process(x);
            if (_r2 != null)
            {
                float h2 = _r2.Process(x);
                tfr = 0.5f * (h1 + h2);
                tbr = 0.5f * (h1 - h2);
            }
            else if (_tfr) tfr = h1;
            else tbr = h1;
        }
        frame[Channels.TFL] = _tfl ? _dTFL.Process(tfl) : 0f;
        frame[Channels.TBL] = _tbl ? _dTBL.Process(tbl) : 0f;
        frame[Channels.TFR] = _tfr ? _dTFR.Process(tfr) : 0f;
        frame[Channels.TBR] = _tbr ? _dTBR.Process(tbr) : 0f;
    }
}

/// <summary>
/// Height lanes for native (multichannel, or not upmixed) content, in place on logical frames: the front ambience
/// (side signal (FL - FR)/2) feeds TFL (+) and TFR (-), the surround ambience ((SL + BL) - (SR + BR))/(2√2) feeds
/// TBL (+) and TBR (-). Both are high-passed at <see cref="HeightTuning.HighPassHz"/>, decorrelated per lane with the
/// height all-pass sets and delayed like the surrounds; level <see cref="UpmixSettings.HeightGain"/> (smoothed).
/// Uncorrelated FL/FR of power p give TFL/TFR p/2 × gain² each, the same as the upmix with both heights on a side.
/// Additive: the floor lanes are not changed. Lanes no speaker uses are written as 0 and cost nothing.
/// Single audio thread; <see cref="Update"/> from any thread.
/// </summary>
public sealed class NativeHeights
{
    private const int Ch = Channels.Count;
    private static readonly float RearNorm = 1f / (2f * MathF.Sqrt(2f));

    private readonly Biquad? _hpF, _hpB;
    private readonly Decorrelator? _dfl, _dfr, _dbl, _dbr;
    private readonly DelayLine _tFL, _tFR, _tBL, _tBR;
    private readonly float _gainK;
    private volatile UpmixSettings _settings = UpmixSettings.Default;
    private float _g;

    private NativeHeights(int fs, UpmixLayout layout)
    {
        bool tfl = layout.Has(Channels.TFL), tfr = layout.Has(Channels.TFR);
        bool tbl = layout.Has(Channels.TBL), tbr = layout.Has(Channels.TBR);
        if (tfl || tfr) _hpF = Biquad.HighPass(fs, HeightTuning.HighPassHz);
        if (tbl || tbr) _hpB = Biquad.HighPass(fs, HeightTuning.HighPassHz);
        _dfl = HeightTuning.Make(fs, HeightTuning.L1, tfl);
        _dfr = HeightTuning.Make(fs, HeightTuning.R1, tfr);
        _dbl = HeightTuning.Make(fs, HeightTuning.L2, tbl);
        _dbr = HeightTuning.Make(fs, HeightTuning.R2, tbr);
        int d = HeightTuning.DelayFrames(fs);
        _tFL = new DelayLine(d); _tFR = new DelayLine(d); _tBL = new DelayLine(d); _tBR = new DelayLine(d);
        _gainK = (float)(1 - Math.Exp(-1 / (UpmixTuning.GainSmoothSeconds * fs)));
        _g = UpmixSettings.Default.HeightGain;
    }

    /// <summary>Null when no speaker plays a height lane.</summary>
    public static NativeHeights? Create(int fs, UpmixLayout layout) => layout.AnyHeight ? new NativeHeights(fs, layout) : null;

    public void Update(UpmixSettings settings) => _settings = settings ?? UpmixSettings.Default;

    /// <summary>Reads the floor lanes of one logical frame and overwrites its height lanes.</summary>
    public void Render(Span<float> frame, float target)
    {
        _g = GlobalProcessor.Approach(_g, target, _gainK);
        float tfl = 0f, tfr = 0f, tbl = 0f, tbr = 0f;
        if (_hpF != null)
        {
            float s = _hpF.Process(0.5f * (frame[Channels.FL] - frame[Channels.FR])) * _g;
            if (_dfl != null) tfl = _tFL.Process(_dfl.Process(s));
            if (_dfr != null) tfr = -_tFR.Process(_dfr.Process(s));
        }
        if (_hpB != null)
        {
            float s = _hpB.Process(RearNorm * (frame[Channels.SL] + frame[Channels.BL] - frame[Channels.SR] - frame[Channels.BR])) * _g;
            if (_dbl != null) tbl = _tBL.Process(_dbl.Process(s));
            if (_dbr != null) tbr = -_tBR.Process(_dbr.Process(s));
        }
        frame[Channels.TFL] = tfl;
        frame[Channels.TFR] = tfr;
        frame[Channels.TBL] = tbl;
        frame[Channels.TBR] = tbr;
    }

    /// <summary>Current target level (the live setting).</summary>
    public float Target => _settings.HeightGain;

    /// <summary>In place on interleaved logical frames.</summary>
    public void Process(Span<float> logical, int frames)
    {
        float target = _settings.HeightGain;
        for (int f = 0; f < frames; f++) Render(logical.Slice(f * Ch, Ch), target);
    }
}
