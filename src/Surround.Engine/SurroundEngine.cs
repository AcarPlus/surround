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

/// <param name="Upmixing">The upmixer currently feeds the speakers (<see cref="UpmixState.Stereo"/>).</param>
public sealed record EngineStatus(int SourceRate, int SourceChannels, bool Upmixing, long SourceFrames, IReadOnlyList<SinkStatus> Sinks,
    UpmixState UpmixState = UpmixState.Off, int UpmixLatencyFrames = 0);

public sealed class SurroundEngine : IDisposable
{
    private readonly SurroundConfig _cfg;
    private readonly Action<string>? _log;
    private readonly List<OutputSink> _sinks = new();
    private MMDevice? _srcDevice;
    private IWaveIn? _capture;
    private WasapiOut? _keepAlive;
    private WaveFormat? _srcFormat;
    private AdaptiveUpmix? _upmix;
    private NativeHeights? _heights;
    private ChannelFold? _fold;
    private int[] _map = Array.Empty<int>();
    private float[] _srcFloat = new float[16384];
    private float[] _logical = new float[Channels.Count * 4096];
    private float[] _bassBuf = new float[4096];
    private GlobalProcessor? _proc;
    private BassManager? _bass;
    private long _frames;
    private long _dspTicks, _dspMaxTicks;
    private bool _started;
    private readonly PeakMeter _meter = new();
    private readonly VolumeRamp _volume = new();
    private SourceVolume? _sourceVolume;
    private volatile DemoPlayer? _demo;
    private const int CaptureBufferMs = 20;

    /// <summary>Raised (from audio/driver threads) when a capture or playback stream fails at runtime.</summary>
    public event Action<string>? Error;

    public SurroundEngine(SurroundConfig cfg, Action<string>? log = null)
    {
        _cfg = cfg.ForRouting(log);
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
            _capture = loopback ? new LoopbackCapture(_srcDevice, CaptureBufferMs) : new WasapiCapture(_srcDevice, true, CaptureBufferMs);
            _srcFormat = _capture.WaveFormat;
            if (!SampleConverter.IsSupported(_srcFormat))
                throw new NotSupportedException($"Kaynak formatı desteklenmiyor: {_srcFormat}");

            int fs = _srcFormat.SampleRate, n = _srcFormat.Channels;
            _map = Channels.MapForSourceChannels(n);
            var active = _cfg.Speakers.Where(s => !s.Mute).ToList();
            var used = ChannelFold.UsedChannels(active.Select(s => (MixRow(s), false)));
            _fold = ChannelFold.Plan(used);
            if (_fold != null)
                _log?.Invoke("Katlama: " + string.Join(", ", _fold.Ops.Select(o => $"{Channels.Names[o.Src]}→{Channels.Names[o.Dst]}{(o.Gain < 0.99f ? " (-3 dB)" : "")}")));
            // A derived LFE is only produced for speakers that map LFE themselves: the bass receivers already
            // play the fronts' bass, so folding a derived LFE into them would count it twice.
            var layout = new UpmixLayout(used, active.Any(HasLfe));
            var upSettings = UpmixSettings.Build(_cfg.UpmixOptions);
            // Height lanes are always derived (sources carry at most 7.1), and only those some speaker plays.
            var nativeHeights = NativeHeights.Create(fs, layout);
            nativeHeights?.Update(upSettings);
            if (_cfg.Upmix)
            {
                if (n >= 2)
                {
                    IStereoUpmixer up = _cfg.UpmixOptions.IsDirect ? new DirectUpmixer(layout)
                        : _cfg.UpmixOptions.IsGame ? new GameUpmixer(fs, layout) : new FilmUpmixer(fs, layout);
                    up.Update(upSettings);
                    _upmix = new AdaptiveUpmix(fs, up, adaptive: n > 2, n > 2 ? nativeHeights : null);
                    _log?.Invoke($"Upmix: {(_cfg.UpmixOptions.IsDirect ? "doğrudan (flat)" : _cfg.UpmixOptions.IsGame ? "oyun" : "film")} modu, {up.LatencyFrames * 1000.0 / fs:0.#} ms gecikme"
                        + (n > 2 ? ", stereo içerik otomatik algılanır" : ""));
                }
                else _log?.Invoke($"Uyarı: upmix en az 2 kanallı kaynak gerektirir (kaynak {n} kanal); atlandı.");
            }
            if (_upmix is null) _heights = nativeHeights;
            if (layout.AnyHeight)
                _log?.Invoke("Üst kanallar: " + string.Join(", ", Enumerable.Range(Channels.SourceCount, Channels.Count - Channels.SourceCount)
                    .Where(layout.Has).Select(c => Channels.Names[c])) + $" türetiliyor ({_cfg.UpmixOptions.HeightDb:+0.#;-0.#;0} dB)");

            _proc = new GlobalProcessor(fs, used);
            _proc.Update(ProcessingSettings.Build(_cfg.Processing, fs));
            // A multichannel source may carry a real LFE at any time (the upmix only takes over while it is silent).
            var bass = PlanBass(fs, nativeMultichannel: n > 2);

            var latencyGroup = new LatencyGroup();
            foreach (var o in _cfg.Outputs)
            {
                var dev = en.GetDevice(o.DeviceId.Trim());
                var routes = _cfg.Speakers
                    .Where(s => SurroundConfig.SameId(s.OutputDeviceId, o.DeviceId))
                    .Select(s => BuildRoute(s, fs, bass))
                    .ToList();
                var sink = new OutputSink(dev, o.BufferMs, fs, routes, _cfg.Processing.Limiter, _log, msg => Error?.Invoke(msg), latencyGroup: latencyGroup);
                _sinks.Add(sink);
                _log?.Invoke($"Çıkış: {sink.Name} ({sink.DeviceRate} Hz, {sink.DeviceChannels} kanal), {routes.Count} hoparlör");
            }

            if (loopback)
            {
                // Loopback delivers no packets while nothing renders; a silent stream keeps the clock running.
                // It plays the endpoint's own mix format: the capture's WaveFormat is flattened to a plain WAVEFORMATEX,
                // which Windows rejects (E_INVALIDARG) for more than 2 channels once the endpoint is set to 5.1/7.1.
                _keepAlive = new WasapiOut(_srcDevice, AudioClientShareMode.Shared, true, 50);
                _keepAlive.Init(new SilenceProvider(_srcDevice.AudioClient.MixFormat));
                _keepAlive.Play();

                // Windows applies the source's volume slider and mute to what it plays, not to the loopback tap:
                // the engine applies them itself, so the volume keys work.
                _sourceVolume = SourceVolume.TryAttach(_srcDevice, _log);
                if (_sourceVolume != null)
                {
                    var vs = _sourceVolume.State;
                    _volume.Reset(vs.Gain);
                    _sourceVolume.Changed += v => _volume.SetTarget(v.Gain);
                    _log?.Invoke($"Ses düzeyi Windows'tan izleniyor: %{vs.Level * 100:0}{(vs.Muted ? " (sessiz)" : "")}, {vs.Db:0.#} dB");
                }
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

    /// <summary>Per-receiver shares of the bass bus and of the folded LFE (0 = none).</summary>
    private readonly record struct BassPlanResult(float BusShare, float LfeFold);

    /// <summary>
    /// Bass management: the cut bass of high-passed speakers is split evenly over the (unmuted) receivers. With a
    /// multichannel source the LFE is folded into receivers whose row lacks it. The upmixers only derive an LFE when
    /// some speaker maps LFE itself, so receivers never get the fronts' bass twice.
    /// </summary>
    private BassPlanResult PlanBass(int fs, bool nativeMultichannel)
    {
        var active = _cfg.Speakers.Where(s => !s.Mute).ToList();
        var cut = active.Where(s => s.HighPassHz > 0).ToList();
        var recv = active.Where(s => s.BassReceiver).ToList();
        if (cut.Count > 0 && recv.Count == 0)
            _log?.Invoke($"Uyarı: {cut.Count} hoparlörün bası kesiliyor ama bas alıcısı (bassReceiver) yok; kesilen bas duyulmayacak.");

        float share = 0f;
        if (cut.Count > 0 && recv.Count > 0)
        {
            _bass = new BassManager(fs, cut.Select(s => new BassSource(MixRow(s), s.GainDb, s.HighPassHz)).ToList());
            share = 1f / recv.Count;
        }
        int lacking = nativeMultichannel ? recv.Count(s => !HasLfe(s)) : 0;
        return new BassPlanResult(share, lacking > 0 ? 1f / lacking : 0f);
    }

    private static bool HasLfe(SpeakerConfig s) =>
        s.Source.Any(kv => Channels.IndexOf(kv.Key) == Channels.LFE && kv.Value != 0);

    private static float[] MixRow(SpeakerConfig s)
    {
        var row = new float[Channels.Count];
        foreach (var (k, v) in s.Source) row[Channels.IndexOf(k)] = (float)v;
        return row;
    }

    private SpeakerRoute BuildRoute(SpeakerConfig s, int fs, BassPlanResult bass)
    {
        var row = MixRow(s);
        float share = 0f;
        if (s.BassReceiver)
        {
            share = bass.BusShare;
            if (!HasLfe(s)) row[Channels.LFE] = bass.LfeFold;
        }
        int delay = (int)Math.Round(Math.Max(0, _cfg.EffectiveDelayMs(s)) * fs / 1000.0);
        return new SpeakerRoute(s.Name, s.DeviceChannel - 1, row, s.GainDb, s.Mute, delay, s.HighPassHz, share, s.Eq, s.Peq, s.RoomEq);
    }

    /// <summary>Starts (replaces) the demo scene; returns its duration in seconds. Throws when the engine is not running.</summary>
    public double StartDemo(DemoScene scene)
    {
        if (!_started || _srcFormat is null) throw new InvalidOperationException("Motor çalışmıyor.");
        var d = new DemoPlayer(scene, _srcFormat.SampleRate);
        _demo = d;
        return d.DurationSeconds;
    }

    public void StopDemo() => _demo = null;

    public bool DemoActive => _demo is not null;

    /// <summary>
    /// Applies the live-updatable part of <paramref name="cfg"/> (processing, per-speaker EQ, limiter switch, upmix and
    /// height levels) without a
    /// restart. The caller ensures the config has the running engine's <see cref="SurroundConfig.EngineFingerprint"/>.
    /// Coefficients are built here, off the audio thread, and swapped in by reference.
    /// </summary>
    public void UpdateLive(SurroundConfig cfg)
    {
        if (!_started || _srcFormat is null) return;
        var routed = cfg.ForRouting();
        _proc?.Update(ProcessingSettings.Build(routed.Processing, _srcFormat.SampleRate));
        var up = UpmixSettings.Build(routed.UpmixOptions);
        _upmix?.Update(up);
        _heights?.Update(up);
        // Sinks were created in routed.Outputs order with speakers in config order; the fingerprint keeps both stable.
        for (int i = 0; i < _sinks.Count && i < routed.Outputs.Count; i++)
        {
            var eqs = routed.Speakers
                .Where(s => SurroundConfig.SameId(s.OutputDeviceId, routed.Outputs[i].DeviceId))
                .Select(s => new SinkMixer.SpeakerEq(s.Eq, s.Peq, s.RoomEq))
                .ToList();
            _sinks[i].UpdateLive(eqs, routed.Processing.Limiter);
        }
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        var fmt = _srcFormat!;
        int n = fmt.Channels;
        int frames = e.BytesRecorded / fmt.BlockAlign;
        if (frames == 0) return;
        long t0 = System.Diagnostics.Stopwatch.GetTimestamp();
        try { Process(e, fmt, n, frames); }
        finally
        {
            long dt = System.Diagnostics.Stopwatch.GetTimestamp() - t0;
            Interlocked.Add(ref _dspTicks, dt);
            if (dt > Interlocked.Read(ref _dspMaxTicks)) Interlocked.Exchange(ref _dspMaxTicks, dt);
        }
    }

    private void Process(WaveInEventArgs e, WaveFormat fmt, int n, int frames)
    {
        if (_srcFloat.Length < frames * n) _srcFloat = new float[frames * n * 2];
        if (_logical.Length < frames * Channels.Count) _logical = new float[frames * Channels.Count * 2];

        SampleConverter.ToFloat(e.Buffer, frames * fmt.BlockAlign, fmt, _srcFloat);

        Array.Clear(_logical, 0, frames * Channels.Count);
        for (int f = 0; f < frames; f++)
            for (int c = 0; c < _map.Length; c++)
                _logical[f * Channels.Count + _map[c]] = _srcFloat[f * n + c];

        var span = new Span<float>(_logical, 0, frames * Channels.Count);
        _upmix?.Process(span, frames);
        _heights?.Process(span, frames);
        // Ses turu demosu: kaynağın yerine hareketli sentez kaynak; sonrası gerçek içerik gibi işlenir.
        if (_demo is { } demo)
        {
            demo.Process(span, frames);
            if (demo.Finished) _demo = null;
        }
        _proc?.Process(span, frames);
        // After the dynamics (whose makeup gain would undo a lower volume), before the bass bus and the sinks.
        _volume.Process(span, frames, Channels.Count);
        _meter.Update(span, frames);
        _fold?.Process(span, frames);

        ReadOnlySpan<float> bass = default;
        if (_bass != null)
        {
            if (_bassBuf.Length < frames) _bassBuf = new float[frames * 2];
            _bass.Process(span, _bassBuf, frames);
            bass = new ReadOnlySpan<float>(_bassBuf, 0, frames);
        }
        foreach (var s in _sinks) s.Push(span, bass, frames);
        _frames += frames;
    }

    /// <summary>
    /// Peak level per logical channel (FL..TBR, post-upmix and global processing, before the channel fold) in dBFS since
    /// the previous call, floor -90.
    /// <paramref name="dest"/> needs <see cref="Channels.Count"/> elements. Safe to call from any one polling thread.
    /// </summary>
    public void DrainLevels(Span<float> dest)
    {
        _meter.Drain(dest);
        for (int c = 0; c < Channels.Count && c < dest.Length; c++) dest[c] = PeakMeter.ToDb(dest[c]);
    }

    public EngineStatus GetStatus()
    {
        var state = _upmix?.State ?? UpmixState.Off;
        return new(_srcFormat?.SampleRate ?? 0, _srcFormat?.Channels ?? 0, state == UpmixState.Stereo, Interlocked.Read(ref _frames),
            _sinks.Select(s => s.GetStatus()).ToList(), state, _upmix?.LatencyFrames ?? 0);
    }

    /// <summary>
    /// Processing time spent in the capture callback since the previous call, and its longest single callback, in ms
    /// (diagnostics: the capture buffer overflows when one callback outlasts it).
    /// </summary>
    public (double TotalMs, double MaxMs) DrainDspTime()
    {
        double k = 1000.0 / System.Diagnostics.Stopwatch.Frequency;
        return (Interlocked.Exchange(ref _dspTicks, 0) * k, Interlocked.Exchange(ref _dspMaxTicks, 0) * k);
    }

    /// <summary>The Windows volume the engine applies (loopback source); <see cref="VolumeState.Unavailable"/> otherwise.</summary>
    public VolumeState SourceVolumeState => _sourceVolume?.State ?? VolumeState.Unavailable;

    public void Dispose()
    {
        _sourceVolume?.Dispose();
        _sourceVolume = null;
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
