using NAudio.CoreAudioApi;
using NAudio.Wave;
using Surround.Engine.Audio;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine;

public sealed class ConfigException : Exception
{
    public IReadOnlyList<string> Errors { get; }
    public ConfigException(IReadOnlyList<string> errors) : base(string.Join(Environment.NewLine, errors)) => Errors = errors;
}

public sealed record EngineStatus(int SourceRate, int SourceChannels, bool Upmixing, long SourceFrames, IReadOnlyList<SinkStatus> Sinks);

public sealed class SurroundEngine : IDisposable
{
    private readonly SurroundConfig _cfg;
    private readonly Action<string>? _log;
    private readonly List<OutputSink> _sinks = new();
    private MMDevice? _srcDevice;
    private IWaveIn? _capture;
    private WasapiOut? _keepAlive;
    private WaveFormat? _srcFormat;
    private Upmixer? _upmixer;
    private int[] _map = Array.Empty<int>();
    private float[] _srcFloat = new float[16384];
    private float[] _logical = new float[8 * 4096];
    private bool _upmixActive;
    private long _frames;
    private bool _started;
    private readonly PeakMeter _meter = new();
    private const int CaptureBufferMs = 20;

    /// <summary>Raised (from audio/driver threads) when a capture or playback stream fails at runtime.</summary>
    public event Action<string>? Error;

    public SurroundEngine(SurroundConfig cfg, Action<string>? log = null)
    {
        _cfg = cfg;
        _log = log;
    }

    public void Start()
    {
        if (_started) throw new InvalidOperationException("Motor zaten çalışıyor.");
        var errors = ConfigValidator.Validate(_cfg);
        if (errors.Count == 0) errors = ConfigValidator.CheckDevices(_cfg, new WasapiDeviceCatalog());
        if (errors.Count > 0) throw new ConfigException(errors);

        try
        {
            using var en = new MMDeviceEnumerator();
            _srcDevice = en.GetDevice(_cfg.Source.DeviceId.Trim());
            bool loopback = _cfg.Source.Mode.Trim().Equals("loopback", StringComparison.OrdinalIgnoreCase);
            _capture = loopback ? new LoopbackCapture(_srcDevice, CaptureBufferMs) : new WasapiCapture(_srcDevice, false, CaptureBufferMs);
            _srcFormat = _capture.WaveFormat;
            if (!SampleConverter.IsSupported(_srcFormat))
                throw new NotSupportedException($"Kaynak formatı desteklenmiyor: {_srcFormat}");

            int fs = _srcFormat.SampleRate, n = _srcFormat.Channels;
            _map = Channels.MapForSourceChannels(n);
            if (_cfg.Upmix)
            {
                if (n == 2) { _upmixer = new Upmixer(fs); _upmixActive = true; }
                else _log?.Invoke($"Uyarı: upmix yalnızca 2 kanallı kaynakta çalışır (kaynak {n} kanal); atlandı.");
            }

            foreach (var o in _cfg.Outputs)
            {
                var dev = en.GetDevice(o.DeviceId.Trim());
                var routes = _cfg.Speakers
                    .Where(s => SurroundConfig.SameId(s.OutputDeviceId, o.DeviceId))
                    .Select(s => BuildRoute(s, fs))
                    .ToList();
                var sink = new OutputSink(dev, o.BufferMs, fs, routes, _log, msg => Error?.Invoke(msg));
                _sinks.Add(sink);
                _log?.Invoke($"Çıkış: {sink.Name} ({sink.DeviceRate} Hz, {sink.DeviceChannels} kanal), {routes.Count} hoparlör");
            }

            if (loopback)
            {
                // Loopback delivers no packets while nothing renders; a silent stream keeps the clock running.
                _keepAlive = new WasapiOut(_srcDevice, AudioClientShareMode.Shared, true, 50);
                _keepAlive.Init(new SilenceProvider(WaveFormat.CreateIeeeFloatWaveFormat(_srcFormat.SampleRate, _srcFormat.Channels)));
                _keepAlive.Play();
            }

            _capture.DataAvailable += OnData;
            _capture.RecordingStopped += (_, e) => { if (e.Exception != null) { _log?.Invoke($"Yakalama hatası: {e.Exception.Message}"); Error?.Invoke($"Yakalama hatası: {e.Exception.Message}"); } };
            foreach (var s in _sinks) s.Start();
            _capture.StartRecording();
            _started = true;
            _log?.Invoke($"Kaynak: {_srcDevice.FriendlyName} ({fs} Hz, {n} kanal, {(loopback ? "loopback" : "capture")})");
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    private SpeakerRoute BuildRoute(SpeakerConfig s, int fs)
    {
        var row = new float[Channels.Count];
        foreach (var (k, v) in s.Source) row[Channels.IndexOf(k)] = (float)v;
        int delay = (int)Math.Round(Math.Max(0, _cfg.EffectiveDelayMs(s)) * fs / 1000.0);
        return new SpeakerRoute(s.Name, s.DeviceChannel - 1, row, s.GainDb, s.Mute, delay);
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        var fmt = _srcFormat!;
        int n = fmt.Channels;
        int frames = e.BytesRecorded / fmt.BlockAlign;
        if (frames == 0) return;
        if (_srcFloat.Length < frames * n) _srcFloat = new float[frames * n * 2];
        if (_logical.Length < frames * Channels.Count) _logical = new float[frames * Channels.Count * 2];

        SampleConverter.ToFloat(e.Buffer, frames * fmt.BlockAlign, fmt, _srcFloat);

        if (_upmixActive)
        {
            _upmixer!.Process(_srcFloat, _logical, frames);
        }
        else
        {
            Array.Clear(_logical, 0, frames * Channels.Count);
            for (int f = 0; f < frames; f++)
                for (int c = 0; c < _map.Length; c++)
                    _logical[f * Channels.Count + _map[c]] = _srcFloat[f * n + c];
        }

        var span = new ReadOnlySpan<float>(_logical, 0, frames * Channels.Count);
        _meter.Update(span, frames);
        foreach (var s in _sinks) s.Push(span, frames);
        _frames += frames;
    }

    /// <summary>
    /// Peak level per logical channel (FL..SR, post-upmix) in dBFS since the previous call, floor -90.
    /// <paramref name="dest"/> needs <see cref="Channels.Count"/> elements. Safe to call from any one polling thread.
    /// </summary>
    public void DrainLevels(Span<float> dest)
    {
        _meter.Drain(dest);
        for (int c = 0; c < Channels.Count && c < dest.Length; c++) dest[c] = PeakMeter.ToDb(dest[c]);
    }

    public EngineStatus GetStatus() =>
        new(_srcFormat?.SampleRate ?? 0, _srcFormat?.Channels ?? 0, _upmixActive, Interlocked.Read(ref _frames),
            _sinks.Select(s => s.GetStatus()).ToList());

    public void Dispose()
    {
        if (_capture != null)
        {
            _capture.DataAvailable -= OnData;
            try { _capture.StopRecording(); } catch { }
        }
        foreach (var s in _sinks) s.Dispose();
        if (_keepAlive != null) { try { _keepAlive.Stop(); } catch { } _keepAlive.Dispose(); _keepAlive = null; }
        _sinks.Clear();
        _capture?.Dispose();
        _capture = null;
        _srcDevice?.Dispose();
        _srcDevice = null;
        _started = false;
    }
}
