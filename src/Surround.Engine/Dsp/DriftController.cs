namespace Surround.Engine.Dsp;

/// <summary>
/// PI controller that trims the resampling ratio so the ring fill converges to the target.
/// Positive correction = consume input faster (fill above target).
/// </summary>
public sealed class DriftController
{
    private readonly double _kp, _ki, _tau, _maxCorr;
    private double _smoothed, _integral;
    private bool _init;

    public DriftController(double targetMs, double maxCorr = 0.005, double kp = 4e-4, double ki = 4e-5, double smoothingTauSeconds = 0.5)
    {
        TargetMs = targetMs;
        _maxCorr = maxCorr;
        _kp = kp; _ki = ki; _tau = smoothingTauSeconds;
    }

    /// <summary>Settable so the reader can grow its jitter buffer after underruns.</summary>
    public double TargetMs { get; set; }
    public double SmoothedFillMs => _smoothed;
    public double Correction { get; private set; }

    public void Reset()
    {
        _init = false;
        _integral = 0;
        Correction = 0;
    }

    public double Update(double fillMs, double dtSeconds)
    {
        if (!_init) { _smoothed = fillMs; _init = true; }
        else
        {
            double a = 1 - Math.Exp(-dtSeconds / _tau);
            _smoothed += a * (fillMs - _smoothed);
        }
        double e = _smoothed - TargetMs;
        double iMax = _maxCorr / _ki;
        _integral = Math.Clamp(_integral + e * dtSeconds, -iMax, iMax);
        Correction = Math.Clamp(_kp * e + _ki * _integral, -_maxCorr, _maxCorr);
        return Correction;
    }
}
