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

    public OutputSink(MMDevice device, double bufferMs, int sourceRate, IReadOnlyList<SpeakerRoute> routes, Action<string>? log = null, Action<string>? error = null)
    {
        _device = device;
        _log = log;
        Name = device.FriendlyName;
        var mix = device.AudioClient.MixFormat;
        DeviceRate = mix.SampleRate;
        DeviceChannels = mix.Channels;

        var fmt = SampleConverter.EffectiveEncoding(mix) == WaveFormatEncoding.IeeeFloat && mix.BitsPerSample == 32
            ? mix
            : WaveFormat.CreateIeeeFloatWaveFormat(mix.SampleRate, mix.Channels);

        int capFrames = (int)(sourceRate * Math.Max(0.5, 5 * bufferMs / 1000.0));
        _ring = new RingBuffer(capFrames * DeviceChannels, DeviceChannels);
        _mixer = new SinkMixer(DeviceChannels, routes);
        _reader = new DriftResamplingReader(_ring, DeviceChannels, sourceRate, DeviceRate, bufferMs);

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

    /// <summary>Called from the capture thread with logical 7.1 frames.</summary>
    public void Push(ReadOnlySpan<float> logical, int frames)
    {
        int dropped = _mixer.Process(logical, frames, _ring);
        if (dropped > 0) _reader.AddOverruns(1);
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
