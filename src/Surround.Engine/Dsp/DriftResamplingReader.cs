namespace Surround.Engine.Dsp;

/// <summary>
/// Extra jitter-buffer latency shared by all outputs of one engine. An underrun on any output grows it for every
/// output, so the speakers stay time-aligned (a per-output growth would delay just that device and silently break
/// calibration). After a long underrun-free period it decays back slowly, again for all outputs together.
/// </summary>
public sealed class LatencyGroup
{
    public const double MaxExtraMs = 110;
    public const double DecayStepMs = 5;
    private readonly Func<long> _nowMs;
    private readonly long _decayAfterMs;
    private double _extraMs;
    private long _lastEventMs;

    public LatencyGroup(long decayAfterMs = 120_000, Func<long>? nowMs = null)
    {
        _decayAfterMs = decayAfterMs;
        _nowMs = nowMs ?? (() => Environment.TickCount64);
        _lastEventMs = _nowMs();
    }

    public double ExtraMs => Volatile.Read(ref _extraMs);

    /// <summary>An output with base target <paramref name="baseMs"/> underran: make sure its effective target grows.</summary>
    public void Grow(double baseMs, double effectiveMs, double maxEffectiveMs)
    {
        double wanted = Math.Min(effectiveMs * 1.25 + 5, maxEffectiveMs) - baseMs;
        lock (this)
        {
            _extraMs = Math.Min(MaxExtraMs, Math.Max(_extraMs, wanted));
            _lastEventMs = _nowMs();
        }
    }

    /// <summary>Called from the render path; cheap unless a decay step is due.</summary>
    public void MaybeDecay()
    {
        if (Volatile.Read(ref _extraMs) <= 0) return;
        long now = _nowMs();
        if (now - Volatile.Read(ref _lastEventMs) < _decayAfterMs) return;
        lock (this)
        {
            if (now - _lastEventMs < _decayAfterMs || _extraMs <= 0) return;
            _extraMs = Math.Max(0, _extraMs - DecayStepMs);
            _lastEventMs = now;
        }
    }
}

/// <summary>
/// Consumer side of a sink: pulls source-rate frames from the ring, resamples to the device rate
/// with drift compensation, and handles underflow/overflow. Device-clock driven (call Render per callback).
/// </summary>
public sealed class DriftResamplingReader
{
    private readonly RingBuffer _ring;
    private readonly int _ch;
    private readonly double _srcRate, _devRate, _maxTargetMs, _baseMs;
    private readonly LatencyGroup _group;
    private double _targetMs;
    private readonly DriftController _ctl;
    private readonly SincResampler _res;
    private float[] _in = new float[4096];
    private bool _primed;
    private long _underruns, _overruns;
    private double _fillMs;
    private long _consumed;

    /// <param name="controller">Optional drift controller (e.g. a slow one for calibration); default gains otherwise.</param>
    public DriftResamplingReader(RingBuffer ring, int channels, double srcRate, double devRate, double targetMs, DriftController? controller = null, LatencyGroup? group = null)
    {
        _ring = ring; _ch = channels; _srcRate = srcRate; _devRate = devRate; _targetMs = targetMs; _baseMs = targetMs;
        _group = group ?? new LatencyGroup();
        // Adaptive jitter buffer: each underrun grows the target (independent source/sink clocks such as
        // VB-Cable vs. a sound card occasionally drain a tight ring), capped so latency stays bounded.
        _maxTargetMs = Math.Max(3 * targetMs, 150);
        _ctl = controller ?? new DriftController(targetMs);
        _res = new SincResampler(channels, srcRate / devRate);
    }

    public double FillMs => Volatile.Read(ref _fillMs);

    /// <summary>
    /// Diagnostics/calibration: called at the end of every <see cref="Render"/> (on the device thread) with the total
    /// number of source frames consumed so far. Null in normal playback.
    /// </summary>
    public Action<long>? RenderObserver { get; set; }
    public double TargetMs => Volatile.Read(ref _targetMs);
    public double CorrectionPpm => _ctl.Correction * 1e6;
    public long Underruns => Interlocked.Read(ref _underruns);
    public long Overruns => Interlocked.Read(ref _overruns);
    public void AddOverruns(long n) => Interlocked.Add(ref _overruns, n);

    public void Render(Span<float> output)
    {
        int ch = _ch;
        int frames = output.Length / ch;
        SyncTarget();
        int fillFrames = _ring.Count / ch;
        double fillMs = fillFrames * 1000.0 / _srcRate;
        Volatile.Write(ref _fillMs, fillMs);

        if (!_primed)
        {
            if (fillMs < _targetMs) { output.Clear(); RenderObserver?.Invoke(_consumed); return; }
            _primed = true;
            _ctl.Reset();
        }
        else if (fillMs > 3 * _targetMs)
        {
            int targetFrames = (int)(_targetMs * _srcRate / 1000.0);
            _ring.Skip((fillFrames - targetFrames) * ch);
            _consumed += fillFrames - targetFrames;
            Interlocked.Increment(ref _overruns);
            _ctl.Reset();
            fillFrames = _ring.Count / ch;
            fillMs = fillFrames * 1000.0 / _srcRate;
            Volatile.Write(ref _fillMs, fillMs);
        }

        double corr = _ctl.Update(fillMs, frames / _devRate);
        double ratio = _srcRate / _devRate * (1 + corr);
        int need = (int)Math.Ceiling(frames * ratio + _res.Phase) + 2;
        need = Math.Min(need, fillFrames);
        if (_in.Length < need * ch) _in = new float[need * ch * 2];

        int got = _ring.Peek(_in.AsSpan(0, need * ch)) / ch;
        int produced = _res.Process(_in, got, output, frames, ratio, out int consumed);
        _ring.Skip(consumed * ch);
        _consumed += consumed;

        if (produced < frames)
        {
            output.Slice(produced * ch).Clear();
            Interlocked.Increment(ref _underruns);
            _primed = false;
            _group.Grow(_baseMs, _targetMs, _maxTargetMs);
            SyncTarget();
        }
        RenderObserver?.Invoke(_consumed);
    }

    /// <summary>Adopts the group's shared extra latency (grown by any output's underrun, or decayed).</summary>
    private void SyncTarget()
    {
        _group.MaybeDecay();
        double t = Math.Min(_baseMs + _group.ExtraMs, _maxTargetMs);
        if (t == _targetMs) return;
        Volatile.Write(ref _targetMs, t);
        _ctl.TargetMs = t;
    }
}
