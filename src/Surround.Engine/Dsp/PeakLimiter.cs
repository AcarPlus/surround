namespace Surround.Engine.Dsp;

/// <summary>
/// Look-ahead peak limiter on interleaved device frames, one gain for all channels (linked) so the image stays put.
/// Required gain per frame → sliding minimum over the look-ahead window → instant attack / smooth release →
/// moving average over the same window. Because every gain averaged at a peak's output time is at or below that
/// peak's requirement, the delayed signal stays under the ceiling; a final clamp only catches rounding.
/// The audio is delayed by <see cref="LatencyFrames"/> whether or not limiting is enabled, so toggling it never
/// shifts timing between outputs.
/// </summary>
public sealed class PeakLimiter
{
    public static readonly float DefaultCeiling = (float)Math.Pow(10, -1.0 / 20); // -1 dBFS

    private readonly int _ch, _win;
    private readonly float _ceiling, _release;
    private readonly float[] _req;     // required gain per frame, ring of _win
    private readonly float[] _env;     // smoothed gain per frame, ring of _win (for the moving average)
    private readonly float[] _delay;   // audio ring, _win - 1 frames x channels
    private int _pos, _dpos;
    private double _sum;
    private float _rel = 1f;

    /// <remarks>
    /// Defaults 5 ms look-ahead / 200 ms release: a 60 Hz tone pushed 1–6 dB over the ceiling stays at about −77 dB THD
    /// (1 ms / 80 ms gave −39…−51 dB, i.e. audibly distorted bass whenever EQ boosts or dynamics hit the ceiling).
    /// </remarks>
    public PeakLimiter(int channels, int sampleRate, double lookaheadMs = 5.0, double releaseMs = 200, float? ceiling = null)
    {
        _ch = channels;
        _win = Math.Max(1, (int)Math.Round(lookaheadMs * sampleRate / 1000.0));
        _ceiling = ceiling ?? DefaultCeiling;
        _release = (float)(1 - Math.Exp(-1 / (releaseMs / 1000.0 * sampleRate)));
        _req = new float[_win]; Array.Fill(_req, 1f);
        _env = new float[_win]; Array.Fill(_env, 1f);
        _sum = _win;
        _delay = new float[(_win - 1) * channels];
    }

    public int LatencyFrames => _win - 1;

    /// <summary>false = pass-through (still delayed). Safe to flip from any thread.</summary>
    public volatile bool Enabled = true;

    /// <summary>In place on <paramref name="frames"/> interleaved frames.</summary>
    public void Process(Span<float> buf, int frames)
    {
        bool on = Enabled;
        for (int f = 0; f < frames; f++)
        {
            int b = f * _ch;
            float g = 1f;
            if (on)
            {
                float peak = 0f;
                for (int c = 0; c < _ch; c++) { float a = Math.Abs(buf[b + c]); if (a > peak) peak = a; }
                _req[_pos] = peak > _ceiling ? _ceiling / peak : 1f;
                float hold = 1f;
                for (int i = 0; i < _win; i++) if (_req[i] < hold) hold = _req[i];
                _rel = hold < _rel ? hold : _rel + (hold - _rel) * _release;
                _sum += _rel - _env[_pos];
                _env[_pos] = _rel;
                g = (float)(_sum / _win);
            }
            else if (_rel != 1f) Reset();
            if (++_pos == _win) _pos = 0;

            // Delay the audio by _win - 1 frames so each peak meets the fully settled average.
            if (_delay.Length > 0)
            {
                int d = _dpos * _ch;
                for (int c = 0; c < _ch; c++)
                {
                    float x = buf[b + c];
                    buf[b + c] = _delay[d + c];
                    _delay[d + c] = x;
                }
                if (++_dpos == _win - 1) _dpos = 0;
            }
            if (on)
                for (int c = 0; c < _ch; c++)
                    buf[b + c] = Math.Clamp(buf[b + c] * g, -_ceiling, _ceiling);
        }
    }

    private void Reset()
    {
        Array.Fill(_req, 1f); Array.Fill(_env, 1f);
        _sum = _win; _rel = 1f;
    }
}
