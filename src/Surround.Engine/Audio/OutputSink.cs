using NAudio.CoreAudioApi;
using NAudio.Wave;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Audio;

public sealed record SinkStatus(string Name, double FillMs, double CorrectionPpm, long Underruns, long Overruns, int DeviceRate, int DeviceChannels);

/// <summary>One physical output device: mixer (producer side) + WasapiOut with drift-compensated reader (consumer side).</summary>
public sealed class OutputSink : IDisposable
{
    private readonly MMDevice _device;
    private readonly WasapiOut _out;
    private readonly RingBuffer _ring;
    private readonly SinkMixer _mixer;
    private readonly DriftResamplingReader _reader;
    private readonly Action<string>? _log;

    public string Name { get; }
    public int DeviceRate { get; }
    public int DeviceChannels { get; }
    /// <summary>Configured jitter-buffer target (the fill the drift controller steers to in steady state).</summary>
    public double BufferMs { get; }
    /// <summary>Calibration: see <see cref="DriftResamplingReader.RenderObserver"/>. Set before <see cref="Start"/>.</summary>
    public Action<long>? RenderObserver { set => _reader.RenderObserver = value; }
    /// <summary>Underruns + overruns so far (any of them shifts the timing of what follows).</summary>
    public long Glitches => _reader.Underruns + _reader.Overruns;

    /// <param name="steadyClock">
    /// Calibration: a very slow drift controller, so the resampling ratio stays nearly constant while test sweeps play
    /// (the ring latency is then tracked via <see cref="RenderObserver"/> and compensated by the analysis instead).
    /// </param>
    public OutputSink(MMDevice device, double bufferMs, int sourceRate, IReadOnlyList<SpeakerRoute> routes, bool limiter, Action<string>? log = null, Action<string>? error = null,
        bool steadyClock = false, LatencyGroup? latencyGroup = null)
    {
        _device = device;
        _log = log;
        Name = DeviceEnumeration.NameOf(device);
        var mix = device.AudioClient.MixFormat;
        DeviceRate = mix.SampleRate;
        DeviceChannels = mix.Channels;

        var fmt = SampleConverter.EffectiveEncoding(mix) == WaveFormatEncoding.IeeeFloat && mix.BitsPerSample == 32
            ? mix
            : WaveFormat.CreateIeeeFloatWaveFormat(mix.SampleRate, mix.Channels);

        int capFrames = (int)(sourceRate * Math.Max(0.5, 5 * bufferMs / 1000.0));
        _ring = new RingBuffer(capFrames * DeviceChannels, DeviceChannels);
        // The limiter always runs (bypassed when off) so its look-ahead delay is the same on every output.
        _mixer = new SinkMixer(DeviceChannels, routes, sourceRate, new PeakLimiter(DeviceChannels, sourceRate) { Enabled = limiter });
        _reader = new DriftResamplingReader(_ring, DeviceChannels, sourceRate, DeviceRate, bufferMs,
            steadyClock ? new DriftController(bufferMs, kp: 2e-5, ki: 1e-7) : null, latencyGroup);
        BufferMs = bufferMs;

        _out = new WasapiOut(device, AudioClientShareMode.Shared, true, 30);
        _out.PlaybackStopped += (_, e) =>
        {
            if (e.Exception == null) return;
            _log?.Invoke($"[{Name}] oynatma hatasi: {e.Exception.Message}");
            error?.Invoke($"[{Name}] oynatma hatası: {e.Exception.Message}");
        };
        _out.Init(new ReaderProvider(_reader, fmt));
    }

    public void Start() => _out.Play();

    /// <summary>Called from the capture thread with logical 7.1 frames and the bass bus (one sample per frame, may be empty).</summary>
    public void Push(ReadOnlySpan<float> logical, ReadOnlySpan<float> bass, int frames)
    {
        int dropped = _mixer.Process(logical, bass, frames, _ring);
        if (dropped > 0) _reader.AddOverruns(1);
    }

    /// <summary>Live changes: per-speaker EQ (aligned with the constructor's routes) and the limiter switch.</summary>
    public void UpdateLive(IReadOnlyList<SinkMixer.SpeakerEq> eqPerRoute, bool limiter)
    {
        _mixer.SetEq(eqPerRoute);
        _mixer.LimiterEnabled = limiter;
    }

    /// <summary>
    /// Live changes including mix rows, gains and delays (aligned with the constructor's routes). False when the routes
    /// no longer fit this sink (see <see cref="SinkMixer.SetRoutes"/>); the EQ and limiter are applied either way.
    /// </summary>
    public bool UpdateLive(IReadOnlyList<SpeakerRoute> routes, bool limiter)
    {
        bool ok = _mixer.SetRoutes(routes);
        UpdateLive(routes.Select(r => new SinkMixer.SpeakerEq(r.Eq, r.Peq, r.RoomEq)).ToList(), limiter);
        return ok;
    }

    public SinkStatus GetStatus() =>
        new(Name, _reader.FillMs, _reader.CorrectionPpm, _reader.Underruns, _reader.Overruns, DeviceRate, DeviceChannels);

    public void Dispose()
    {
        try { _out.Stop(); } catch { }
        _out.Dispose();
        _device.Dispose();
    }

    private sealed class ReaderProvider : IWaveProvider
    {
        private readonly DriftResamplingReader _r;
        public ReaderProvider(DriftResamplingReader r, WaveFormat f) { _r = r; WaveFormat = f; }
        public WaveFormat WaveFormat { get; }

        public int Read(byte[] buffer, int offset, int count)
        {
            var floats = System.Runtime.InteropServices.MemoryMarshal.Cast<byte, float>(buffer.AsSpan(offset, count));
            _r.Render(floats);
            return count;
        }
    }
}
