namespace Surround.Engine.Dsp;

/// <summary>
/// High-quality stereo to 7.1 upmixer in the STFT domain (sqrt-Hann analysis/synthesis, 75 % overlap, overlap-add).
/// Frame 1024 at ≤ 50 kHz (2048 above), hop N/4; latency is exactly N frames (21.3 ms at 48 kHz).
/// Per bin, from the smoothed (35 ms, plus 3-bin) complex covariance of L/R:
/// <list type="number">
/// <item>Primary/ambient decomposition: the principal eigenvector v = (cos θ, sin θ·e^-iΔ) of the covariance
/// (Δ = inter-channel phase) gives s = vᴴx and a = v⊥ᴴx; the primary is s·√(1-λ2/λ1) and the rest is rotated back
/// into an ambient L/R pair. Unitary, so energy is preserved bin by bin.</item>
/// <item>FL/FR keep the original L/R (the "bed", as in the flat mode): extracting the center out of them made the film
/// mode thinner and up to 6 dB quieter than the flat mode (a sound shared by L and R adds up in the room, fully so in
/// the bass; moved into one center speaker it does not).</item>
/// <item>FC: the in-phase part of the primary (weight max(0, cos Δ)) panned by its panning index 2θ over FL/FC/FR with
/// constant power; its FC share, scaled so a centered source gets exactly the flat mode's (L+R)/2. Hard-left adds
/// nothing to FC.</item>
/// <item>Ambient: 60 % of its power back to the time domain and through the complementary all-pass decorrelators into
/// the separate SL/SR and BL/BR speakers (<see cref="SurroundRenderer"/>, 10 ms precedence delay). Side/back channels
/// that only share a speaker with a front (<see cref="UpmixLayout.Shared"/>) get plain copies of L/R.</item>
/// <item>Heights (only lanes some speaker plays): the same time-domain ambient pair, high-passed, additively through
/// their own decorrelators (<see cref="HeightRenderer"/>).</item>
/// <item>LFE: LR4 low-pass (120 Hz) of the mid, delayed to line up with the STFT path.</item>
/// </list>
/// Five real outputs (FL, FR, FC, ambient L, ambient R) need three complex inverse FFTs (two signals per FFT; FC
/// goes alone and is skipped when the layout has no center).
/// </summary>
public sealed class FilmUpmixer : IStereoUpmixer
{
    private const int Ch = Channels.Count;
    private const int Outs = 5; // FL, FR, FC, AL, AR
    private const double CovSeconds = 0.035;
    private const float CoherenceBias = 1f / 16;

    private readonly int _n, _h, _bins;
    private readonly Fft _fft;
    private readonly float[] _win;
    private readonly float[] _inL, _inR;
    private readonly float[] _zr, _zi;
    private readonly float[] _xLr, _xLi, _xRr, _xRi;
    private readonly float[] _pLL, _pRR, _cR, _cI;
    private readonly float[][] _yr, _yi; // per output, bins 0..N/2
    private readonly float[] _ola;   // Outs × N
    private readonly float[] _out;   // Outs × H, the last completed hop
    private readonly float _alpha, _gainK, _cgK, _asL, _asR;
    private readonly bool _hasFc, _lfeAllowed;
    private readonly int[] _shL, _shR;
    private readonly SurroundRenderer _sur;
    private readonly HeightRenderer? _hgt;
    private readonly LinkwitzRiley _lfeLp;
    private readonly DelayLine _lfeDelay;
    private volatile UpmixSettings _settings = UpmixSettings.Default;
    private float _cgFrame = 1f, _sg = 1f, _lg, _hg = UpmixSettings.Default.HeightGain;
    private int _pos;

    public FilmUpmixer(int sampleRate, UpmixLayout? layout = null)
    {
        layout ??= UpmixLayout.Full;
        _n = sampleRate <= 50000 ? 1024 : 2048;
        _h = _n / 4;
        _bins = _n / 2 + 1;
        _fft = new Fft(_n);
        _win = new float[_n];
        for (int i = 0; i < _n; i++) _win[i] = (float)Math.Sqrt(0.5 - 0.5 * Math.Cos(2 * Math.PI * i / _n));
        _inL = new float[_n]; _inR = new float[_n];
        _zr = new float[_n]; _zi = new float[_n];
        _xLr = new float[_bins]; _xLi = new float[_bins]; _xRr = new float[_bins]; _xRi = new float[_bins];
        _pLL = new float[_bins]; _pRR = new float[_bins]; _cR = new float[_bins]; _cI = new float[_bins];
        _yr = new float[Outs][]; _yi = new float[Outs][];
        for (int k = 0; k < Outs; k++) { _yr[k] = new float[_bins]; _yi[k] = new float[_bins]; }
        _ola = new float[Outs * _n];
        _out = new float[Outs * _h];
        _pos = _n - _h;

        _alpha = (float)Math.Exp(-_h / (CovSeconds * sampleRate));
        _gainK = (float)(1 - Math.Exp(-1 / (UpmixTuning.GainSmoothSeconds * sampleRate)));
        _cgK = (float)(1 - Math.Exp(-_h / (UpmixTuning.GainSmoothSeconds * sampleRate)));
        var steer = layout.Steerable;
        _hasFc = layout.Has(Channels.FC);
        (_, _asL) = UpmixTuning.AmbientSplit(steer.LeftSurround);
        (_, _asR) = UpmixTuning.AmbientSplit(steer.RightSurround);
        _shL = layout.SharedLeft;
        _shR = layout.SharedRight;
        _sur = new SurroundRenderer(sampleRate, steer);
        _hgt = HeightRenderer.Create(sampleRate, layout);
        _lfeLp = LinkwitzRiley.LowPass(sampleRate, UpmixTuning.LfeHz);
        _lfeDelay = new DelayLine(_n);
        _lfeAllowed = layout.LfeAllowed;
        _lg = _lfeAllowed ? 1f : 0f;
    }

    public int LatencyFrames => _n;
    public int FrameSize => _n;

    public void Update(UpmixSettings settings) => _settings = settings ?? UpmixSettings.Default;

    public void Process(ReadOnlySpan<float> input, Span<float> output, int frames)
    {
        var st = _settings;
        _sur.Configure(st);
        float lfeTarget = _lfeAllowed ? st.LfeGain : 0f;
        int lat = _n - _h;
        for (int f = 0; f < frames; f++)
        {
            int b = f * Ch;
            float l = input[b + Channels.FL], r = input[b + Channels.FR];
            _inL[_pos] = l;
            _inR[_pos] = r;
            int j = _pos - lat;
            float fl = _out[j], fr = _out[_h + j], fc = _out[2 * _h + j], al = _out[3 * _h + j], ar = _out[4 * _h + j];
            if (++_pos == _n)
            {
                ProcessFrame(st.CenterGain);
                _pos = lat;
            }

            _sg = GlobalProcessor.Approach(_sg, st.SurroundGain, _gainK);
            _lg = GlobalProcessor.Approach(_lg, lfeTarget, _gainK);
            _hg = GlobalProcessor.Approach(_hg, st.HeightGain, _gainK);
            var o = output.Slice(b, Ch);
            o[Channels.FL] = fl;
            o[Channels.FR] = fr;
            o[Channels.FC] = fc;
            o[Channels.LFE] = _lfeDelay.Process(_lfeLp.Process(0.5f * (l + r))) * _lg;
            _sur.Render(al * _asL, ar * _asR, _sg, 0, 0, 0, 0, o);
            foreach (int c in _shL) o[c] = fl;
            foreach (int c in _shR) o[c] = fr;
            if (_hgt != null) _hgt.Render(al, ar, _hg, o);
            else o.Slice(Channels.SourceCount).Clear();
        }
    }

    private void ProcessFrame(float centerTarget)
    {
        int n = _n, h = _h, bins = _bins;
        var zr = _zr; var zi = _zi;
        for (int i = 0; i < n; i++) { zr[i] = _win[i] * _inL[i]; zi[i] = _win[i] * _inR[i]; }
        _fft.Transform(zr, zi, false);

        // Split the packed spectrum (L + iR) and update the per-bin covariance.
        float a = _alpha, a1 = 1 - _alpha;
        for (int k = 0; k < bins; k++)
        {
            int nk = (n - k) & (n - 1);
            float lr = 0.5f * (zr[k] + zr[nk]), li = 0.5f * (zi[k] - zi[nk]);
            float rr = 0.5f * (zi[k] + zi[nk]), ri = 0.5f * (zr[nk] - zr[k]);
            _xLr[k] = lr; _xLi[k] = li; _xRr[k] = rr; _xRi[k] = ri;
            _pLL[k] = a * _pLL[k] + a1 * (lr * lr + li * li) + UpmixTuning.Tiny;
            _pRR[k] = a * _pRR[k] + a1 * (rr * rr + ri * ri) + UpmixTuning.Tiny;
            // E[L·R*]
            _cR[k] = UpmixTuning.Flush(a * _cR[k] + a1 * (lr * rr + li * ri));
            _cI[k] = UpmixTuning.Flush(a * _cI[k] + a1 * (li * rr - lr * ri));
        }

        // Center level changes once per frame; the overlap-add crossfades it.
        _cgFrame += (centerTarget - _cgFrame) * _cgK;
        if (MathF.Abs(centerTarget - _cgFrame) < 1e-4f) _cgFrame = centerTarget;

        for (int k = 0; k < bins; k++)
        {
            int k0 = k > 0 ? k - 1 : k, k2 = k < bins - 1 ? k + 1 : k;
            float pLL = 0.25f * (_pLL[k0] + _pLL[k2]) + 0.5f * _pLL[k];
            float pRR = 0.25f * (_pRR[k0] + _pRR[k2]) + 0.5f * _pRR[k];
            float cR = 0.25f * (_cR[k0] + _cR[k2]) + 0.5f * _cR[k];
            float cI = 0.25f * (_cI[k0] + _cI[k2]) + 0.5f * _cI[k];
            float lr = _xLr[k], li = _xLi[k], rr = _xRr[k], ri = _xRi[k];

            float mag = MathF.Sqrt(cR * cR + cI * cI);
            // Unbias the coherence: averaged over ~16 independent frames/bins, uncorrelated signals still show
            // |γ|² ≈ 1/16. γ'² = (γ² - b)/(1 - b) maps that to 0 and keeps fully coherent sources at 1.
            float pp = pLL * pRR;
            float mag2c = MathF.Max(0f, (mag * mag - CoherenceBias * pp) * (1f / (1f - CoherenceBias)));
            float magc = MathF.Sqrt(mag2c);
            float tr = pLL + pRR, diff = pLL - pRR;
            float disc = MathF.Sqrt(diff * diff + 4 * mag2c);
            float cos2, sin2;
            if (disc > 1e-30f) { cos2 = diff / disc; sin2 = 2 * magc / disc; }
            else { cos2 = 1f; sin2 = 0f; }
            float lam1 = 0.5f * (tr + disc), lam2 = MathF.Max(0f, 0.5f * (tr - disc));
            float amb = lam1 > 0f ? MathF.Min(1f, lam2 / lam1) : 1f;
            float ce = MathF.Sqrt(MathF.Max(0f, 0.5f * (1 + cos2)));
            float se = MathF.Sqrt(MathF.Max(0f, 0.5f * (1 - cos2)));
            // u = e^{iΔ}: rotates R onto L's phase.
            float ur = 1f, ui = 0f;
            if (mag > 1e-30f) { ur = cR / mag; ui = cI / mag; }
            float uxr = ur * rr - ui * ri, uxi = ur * ri + ui * rr;

            float sr = ce * lr + se * uxr, si = ce * li + se * uxi;
            float ar = -se * lr + ce * uxr, ai = -se * li + ce * uxi;
            float kp = MathF.Sqrt(1f - amb), ka = MathF.Sqrt(amb);
            // Ambient back in L/R: AL = ce·ka·s - se·a; AR = conj(u)·(se·ka·s + ce·a).
            float alr = ce * ka * sr - se * ar, ali = ce * ka * si - se * ai;
            float tR = se * ka * sr + ce * ar, tI = se * ka * si + ce * ai;
            float arr = ur * tR + ui * tI, ari = ur * tI - ui * tR;

            // Front gains: in-phase part panned L–C–R (constant power), the rest kept passive (cos θ, 0, sin θ).
            float rho = mag > 1e-30f ? MathF.Max(0f, ur) : 0f;
            float pasL = ce, pasR = se;
            float panL = MathF.Max(cos2, 0f), panC = sin2, panR = MathF.Max(-cos2, 0f);
            float gL = rho * panL + (1 - rho) * pasL, gC = rho * panC, gR = rho * panR + (1 - rho) * pasR;
            float norm = MathF.Sqrt(gL * gL + gC * gC + gR * gR);
            if (norm > 0f) { gL /= norm; gC /= norm; gR /= norm; }
            // FL/FR: the bed, unchanged (the analysis/synthesis pair reconstructs it exactly, time-aligned with FC).
            _yr[0][k] = lr; _yi[0][k] = li;
            _yr[1][k] = rr; _yi[1][k] = ri;
            // FC half-way between the two phases: sqrt(conj u).
            float hr = MathF.Sqrt(MathF.Max(0f, 0.5f * (1 + ur)));
            float hi = MathF.Sqrt(MathF.Max(0f, 0.5f * (1 - ur)));
            if (ui > 0f) hi = -hi;
            float gc = gC * kp * _cgFrame * GameUpmixer.CenterScale;
            _yr[2][k] = gc * (hr * sr - hi * si); _yi[2][k] = gc * (hr * si + hi * sr);
            _yr[3][k] = alr; _yi[3][k] = ali;
            _yr[4][k] = arr; _yi[4][k] = ari;
        }

        Synthesize(0, 1);
        Synthesize(3, 4);
        if (_hasFc) Synthesize(2, -1);

        // Hand out the completed hop, slide the accumulators and the input window.
        for (int o = 0; o < Outs; o++)
        {
            int ob = o * n;
            Array.Copy(_ola, ob, _out, o * h, h);
            Array.Copy(_ola, ob + h, _ola, ob, n - h);
            Array.Clear(_ola, ob + n - h, h);
        }
        Array.Copy(_inL, h, _inL, 0, n - h);
        Array.Copy(_inR, h, _inR, 0, n - h);
    }

    /// <summary>Inverse FFT of two real outputs at once (A + iB), windowed into their overlap-add accumulators.</summary>
    private void Synthesize(int oa, int ob)
    {
        int n = _n, bins = _bins;
        var zr = _zr; var zi = _zi;
        var ar = _yr[oa]; var ai = _yi[oa];
        for (int k = 0; k < bins; k++)
        {
            float br = 0f, bi = 0f, air = ai[k];
            if (ob >= 0) { br = _yr[ob][k]; bi = _yi[ob][k]; }
            if (k == 0 || k == bins - 1) { air = 0f; bi = 0f; } // real signals: DC and Nyquist bins are real
            zr[k] = ar[k] - bi;
            zi[k] = air + br;
            if (k > 0 && k < bins - 1)
            {
                zr[n - k] = ar[k] + bi;
                zi[n - k] = -air + br;
            }
        }
        _fft.Transform(zr, zi, true);
        // Periodic sqrt-Hann at hop N/4: Σ w² = 2; the inverse FFT is unscaled.
        float scale = 1f / (2f * n);
        int oA = oa * n, oB = ob * n;
        for (int i = 0; i < n; i++)
        {
            float w = _win[i] * scale;
            _ola[oA + i] += w * zr[i];
            if (ob >= 0) _ola[oB + i] += w * zi[i];
        }
    }
}
