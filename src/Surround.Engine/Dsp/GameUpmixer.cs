namespace Surround.Engine.Dsp;

/// <summary>
/// Low-latency stereo to 7.1 active matrix decoder (Pro Logic II in spirit, own design). Per sample:
/// <list type="number">
/// <item>Steering: one-pole smoothed (20 ms) covariance of the high-passed (150 Hz) L/R. Its power ratios give the
/// L/R axis <c>(pL-pR)/(pL+pR)</c> and the front/back axis <c>(p(L+R)-p(L-R))/(pL+pR)</c>; together they are one
/// direction φ on a circle (0° L, 90° C, 180° R, -90° back) and the dominance (vector length).</item>
/// <item>Decomposition: rotating (L,R) onto the principal direction gives s (dominant + some ambience) and a
/// (ambience only). With covariance eigenvalues λ1 ≥ λ2, the primary is s·√(1-λ2/λ1); the rest of s and all of a are
/// rotated back into an ambient L/R pair. The rotation is orthonormal, so energy is preserved sample by sample.</item>
/// <item>The primary is panned with constant power between the two neighboring available speakers of the ring
/// FL 0°, FC 90°, FR 180°, SR 210°, BR 250°, BL 290°, SL 330°. Hard-left (φ = 0) stays in FL, centered dialog goes
/// to FC.</item>
/// <item>Ambient: 40 % of its power stays in FL/FR, the rest goes to the side/back channels through complementary
/// all-pass decorrelators and a 10 ms precedence delay (<see cref="SurroundRenderer"/>).</item>
/// <item>Heights (only lanes some speaker plays): the high-passed ambient pair, additively, through their own
/// decorrelators (<see cref="HeightRenderer"/>).</item>
/// </list>
/// Fronts get no added latency.
/// </summary>
public sealed class GameUpmixer : IStereoUpmixer
{
    private const int Ch = Channels.Count;
    private const double SteeringHz = 150, SteeringSeconds = 0.020;

    private static readonly (int Ch, float Deg)[] RingNodes =
    {
        (Channels.FL, 0), (Channels.FC, 90), (Channels.FR, 180), (Channels.SR, 210),
        (Channels.BR, 250), (Channels.BL, 290), (Channels.SL, 330),
    };

    private readonly Ring _full, _layout;
    private readonly SurroundRenderer _sur;
    private readonly HeightRenderer? _hgt;
    private readonly LinkwitzRiley _lfeLp;
    private readonly bool _lfeAllowed;
    private readonly float _hpA, _covK, _gainK, _af, _as;
    private volatile UpmixSettings _settings = UpmixSettings.Default;
    private float _hl, _hr, _xl, _xr, _pLL, _pRR, _pLR;
    private float _cg = 1f, _sg = 1f, _lg = 1f, _hg = UpmixSettings.Default.HeightGain;

    public GameUpmixer(int sampleRate, UpmixLayout? layout = null)
    {
        layout ??= UpmixLayout.Full;
        _full = new Ring(RingNodes);
        _layout = new Ring(RingNodes.Where(n => n.Ch is Channels.FL or Channels.FR || layout.Has(n.Ch)).ToArray());
        _sur = new SurroundRenderer(sampleRate, layout);
        _hgt = HeightRenderer.Create(sampleRate, layout);
        _lfeLp = LinkwitzRiley.LowPass(sampleRate, UpmixTuning.LfeHz);
        _lfeAllowed = layout.LfeAllowed;
        _lg = _lfeAllowed ? 1f : 0f;
        double rc = 1 / (2 * Math.PI * SteeringHz);
        _hpA = (float)(rc / (rc + 1.0 / sampleRate));
        _covK = (float)(1 - Math.Exp(-1 / (SteeringSeconds * sampleRate)));
        _gainK = (float)(1 - Math.Exp(-1 / (UpmixTuning.GainSmoothSeconds * sampleRate)));
        bool sur = layout.AnySurround;
        _af = sur ? MathF.Sqrt(UpmixTuning.FrontAmbientShare) : 1f;
        _as = sur ? MathF.Sqrt(1 - UpmixTuning.FrontAmbientShare) : 0f;
    }

    public int LatencyFrames => 0;

    public void Update(UpmixSettings settings) => _settings = settings ?? UpmixSettings.Default;

    public void Process(ReadOnlySpan<float> input, Span<float> output, int frames)
    {
        var st = _settings;
        float lfeTarget = _lfeAllowed ? st.LfeGain : 0f;
        Span<float> lev = stackalloc float[Ch];

        for (int f = 0; f < frames; f++)
        {
            int b = f * Ch;
            float l = input[b + Channels.FL], r = input[b + Channels.FR];

            _cg = GlobalProcessor.Approach(_cg, st.CenterGain, _gainK);
            _sg = GlobalProcessor.Approach(_sg, st.SurroundGain, _gainK);
            _lg = GlobalProcessor.Approach(_lg, lfeTarget, _gainK);
            _hg = GlobalProcessor.Approach(_hg, st.HeightGain, _gainK);

            // Steering detector on the high-passed pair: low bass would make the estimates wobble at 2× its frequency.
            _hl = UpmixTuning.Flush(_hpA * (_hl + l - _xl)); _xl = l;
            _hr = UpmixTuning.Flush(_hpA * (_hr + r - _xr)); _xr = r;
            _pLL += _covK * (_hl * _hl - _pLL) + UpmixTuning.Tiny;
            _pRR += _covK * (_hr * _hr - _pRR) + UpmixTuning.Tiny;
            _pLR = UpmixTuning.Flush(_pLR + _covK * (_hl * _hr - _pLR));

            float tr = _pLL + _pRR, diff = _pLL - _pRR;
            float disc = MathF.Sqrt(diff * diff + 4 * _pLR * _pLR);
            float cos2, sin2;
            if (disc > 1e-9f * tr && disc > 1e-30f) { cos2 = diff / disc; sin2 = 2 * _pLR / disc; }
            else { cos2 = 1f; sin2 = 0f; }
            float lam1 = 0.5f * (tr + disc), lam2 = MathF.Max(0f, 0.5f * (tr - disc));
            float amb = lam1 > 0f ? MathF.Min(1f, lam2 / lam1) : 1f;

            // Principal direction e = (cos φ/2, sin φ/2); s along e, a along e⊥.
            float ce = MathF.Sqrt(MathF.Max(0f, 0.5f * (1 + cos2)));
            float se = MathF.Sqrt(MathF.Max(0f, 0.5f * (1 - cos2)));
            if (sin2 < 0f) se = -se;
            float s = ce * l + se * r, a = -se * l + ce * r;
            float kp = MathF.Sqrt(1f - amb), ka = MathF.Sqrt(amb);
            float sa = s * ka;
            float al = ce * sa - se * a, ar = se * sa + ce * a;

            float deg = MathF.Atan2(sin2, cos2) * (180f / MathF.PI);
            if (deg < 0f) deg += 360f;

            // Level controls follow the full 7.1 position, so they work even when FC or the sides are folded away.
            lev[Channels.FL] = lev[Channels.FR] = lev[Channels.LFE] = 1f;
            lev[Channels.FC] = _cg;
            lev[Channels.SL] = lev[Channels.SR] = lev[Channels.BL] = lev[Channels.BR] = _sg;
            _full.Pan(deg, out int f0, out float fg0, out int f1, out float fg1);
            float pm = kp * MathF.Sqrt(fg0 * fg0 * lev[f0] * lev[f0] + fg1 * fg1 * lev[f1] * lev[f1]);

            // The eigenvector sign is ambiguous (e and -e); s flips where cos(φ/2) or sin(φ/2) crosses zero, i.e. at
            // hard right (180°) and hard left (0°). Right-hand nodes take R's polarity, left-hand nodes L's, so every
            // node is continuous: each one's gain is zero at the point where its own reference flips.
            float polR = se < 0f ? -1f : 1f;
            var o = output.Slice(b, Ch);
            o.Clear();
            float gfl = 0f, gfr = 0f, sl = 0f, bl = 0f, sr = 0f, br = 0f;
            _layout.Pan(deg, out int c0, out float g0, out int c1, out float g1);
            Route(o, c0, g0, pm * s, polR, ref gfl, ref gfr, ref sl, ref bl, ref sr, ref br);
            Route(o, c1, g1, pm * s, polR, ref gfl, ref gfr, ref sl, ref bl, ref sr, ref br);

            // FL/FR = steered primary + front ambient share. Both contain s; their coefficients are combined as a
            // power sum so the coherent overlap does not add energy (s and a are uncorrelated by construction).
            float afk = _af * ka;
            o[Channels.FL] = MathF.Sqrt(gfl * gfl * pm * pm + afk * afk * ce * ce) * s - _af * se * a;
            o[Channels.FR] = polR * MathF.Sqrt(gfr * gfr * pm * pm + afk * afk * se * se) * s + _af * ce * a;
            _sur.Render(al, ar, _as * _sg, sl, bl, sr, br, o);
            _hgt?.Render(al, ar, _hg, o);
            o[Channels.LFE] = _lfeLp.Process(0.5f * (l + r)) * _lg;
        }
    }

    /// <summary>Collects FL/FR gains, sends side/back to the delayed surround bus and writes FC directly.</summary>
    private static void Route(Span<float> o, int ch, float g, float ps, float polR,
        ref float gfl, ref float gfr, ref float sl, ref float bl, ref float sr, ref float br)
    {
        switch (ch)
        {
            case Channels.FL: gfl += g; break;
            case Channels.FR: gfr += g; break;
            case Channels.SL: sl += g * ps; break;
            case Channels.BL: bl += g * ps; break;
            case Channels.SR: sr += g * ps * polR; break;
            case Channels.BR: br += g * ps * polR; break;
            default: o[ch] += g * ps; break;
        }
    }

    /// <summary>Speakers on the steering circle; pairwise constant-power (sin/cos) panning between neighbors.</summary>
    private sealed class Ring
    {
        private readonly int[] _ch;
        private readonly float[] _deg;
        private readonly int _n;

        public Ring((int Ch, float Deg)[] nodes)
        {
            var sorted = nodes.OrderBy(n => n.Deg).ToArray();
            _n = sorted.Length;
            _ch = new int[_n + 1];
            _deg = new float[_n + 1];
            for (int i = 0; i < _n; i++) { _ch[i] = sorted[i].Ch; _deg[i] = sorted[i].Deg; }
            _ch[_n] = _ch[0];
            _deg[_n] = _deg[0] + 360f;
        }

        /// <param name="deg">Direction in [0, 360); the first node is at 0°.</param>
        public void Pan(float deg, out int c0, out float g0, out int c1, out float g1)
        {
            int i = 0;
            while (i < _n - 1 && deg >= _deg[i + 1]) i++;
            float span = _deg[i + 1] - _deg[i];
            float t = span > 0f ? Math.Clamp((deg - _deg[i]) / span, 0f, 1f) : 0f;
            c0 = _ch[i]; c1 = _ch[i + 1];
            g0 = MathF.Cos(t * (MathF.PI / 2));
            g1 = MathF.Sin(t * (MathF.PI / 2));
        }
    }
}
