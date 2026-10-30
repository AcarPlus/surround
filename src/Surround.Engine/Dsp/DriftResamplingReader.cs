namespace Surround.Engine.Dsp;

/// <summary>
/// Consumer side of a sink: pulls source-rate frames from the ring, resamples to the device rate
/// with drift compensation, and handles underflow/overflow. Device-clock driven (call Render per callback).
/// </summary>
public sealed class DriftResamplingReader
{
    private readonly RingBuffer _ring;
    private readonly int _ch;
    private readonly double _srcRate, _devRate, _maxTargetMs;
    private double _targetMs;
    private readonly DriftController _ctl;
    private readonly HermiteResampler _res;
    private float[] _in = new float[4096];
    private bool _primed;
    private long _underruns, _overruns;
    private double _fillMs;

    public DriftResamplingReader(RingBuffer ring, int channels, double srcRate, double devRate, double targetMs)
    {
        _ring = ring; _ch = channels; _srcRate = srcRate; _devRate = devRate; _targetMs = targetMs;
        // Adaptive jitter buffer: each underrun grows the target (independent source/sink clocks such as
        // VB-Cable vs. a sound card occasionally drain a tight ring), capped so latency stays bounded.
        _maxTargetMs = Math.Max(3 * targetMs, 150);
        _ctl = new DriftController(targetMs);
        _res = new HermiteResampler(channels);
    }

    public double FillMs => Volatile.Read(ref _fillMs);
    public double TargetMs => Volatile.Read(ref _targetMs);
    public double CorrectionPpm => _ctl.Correction * 1e6;
    public long Underruns => Interlocked.Read(ref _underruns);
    public long Overruns => Interlocked.Read(ref _overruns);
    public void AddOverruns(long n) => Interlocked.Add(ref _overruns, n);

    public void Render(Span<float> output)
    {
        int ch = _ch;
        int frames = output.Length / ch;
        int fillFrames = _ring.Count / ch;
        double fillMs = fillFrames * 1000.0 / _srcRate;
        Volatile.Write(ref _fillMs, fillMs);

        if (!_primed)
        {
            if (fillMs < _targetMs) { output.Clear(); return; }
            _primed = true;
            _ctl.Reset();
        }
        else if (fillMs > 3 * _targetMs)
        {
            int targetFrames = (int)(_targetMs * _srcRate / 1000.0);
            _ring.Skip((fillFrames - targetFrames) * ch);
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

        if (produced < frames)
        {
            output.Slice(produced * ch).Clear();
            Interlocked.Increment(ref _underruns);
            _primed = false;
            Volatile.Write(ref _targetMs, Math.Min(_targetMs * 1.25 + 5, _maxTargetMs));
            _ctl.TargetMs = _targetMs;
        }
    }
}
