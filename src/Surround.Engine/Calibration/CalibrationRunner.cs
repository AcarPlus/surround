using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using Surround.Engine.Audio;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Calibration;

/// <summary>
/// Plays a <see cref="CalibrationPlan"/> through the real output path (one <see cref="OutputSink"/> per device with the
/// configured bufferMs, ring, drift-compensated resampler and limiter) and records it with a microphone, then runs
/// <see cref="CalibrationAnalyzer"/>. The microphone clocks the program the way the source capture clocks normal
/// playback. Each speaker is a plain route (0 dB, no delay, EQ, high-pass, bass bus, global processing or upmix), so
/// results exclude the configured delayMs/latencyMs/gainDb. The main engine must not be running.
/// </summary>
public static class CalibrationRunner
{
    private const int CaptureBufferMs = 20;
    private const int MaxRepeats = 5;

    private sealed record Target(string Id, SpeakerConfig Speaker, bool LowBand);

    /// <summary>Blocks until done. Throws <see cref="OperationCanceledException"/> when <paramref name="ct"/> fires.</summary>
    public static CalibrationResult Run(SurroundConfig cfg, CalibrationRequest req, Action<CalibrationProgress>? progress = null,
        CancellationToken ct = default, Action<string>? log = null)
    {
        progress?.Invoke(new CalibrationProgress(CalibrationPhase.Preparing, null, 0, 0, "Hazırlanıyor"));
        var (targets, refIdx) = Resolve(cfg, req);
        int repeats = Math.Clamp(req.Repeats, 1, MaxRepeats);
        double levelDb = Math.Clamp(req.LevelDb, -40, -6);
        if (string.IsNullOrWhiteSpace(req.MicDeviceId)) throw new ArgumentException("Mikrofon seçilmedi.");

        using var en = new MMDeviceEnumerator();
        // Program rate = the source's rate, so the resampling path matches normal playback.
        int rate = 48000;
        try { using var src = en.GetDevice(cfg.Source.DeviceId.Trim()); rate = src.AudioClient.MixFormat.SampleRate; } catch { }

        // Sinks in first-appearance order of the speakers' devices.
        var deviceIds = new List<string>();
        foreach (var t in targets)
            if (!deviceIds.Any(d => SurroundConfig.SameId(d, t.Speaker.OutputDeviceId))) deviceIds.Add(t.Speaker.OutputDeviceId.Trim());
        var speakers = targets.Select(t => new CalibrationSpeaker(t.Id, t.LowBand,
            deviceIds.FindIndex(d => SurroundConfig.SameId(d, t.Speaker.OutputDeviceId)))).ToList();
        var plan = new CalibrationPlan(rate, speakers, refIdx, repeats, levelDb);

        var session = new Session(plan, targets, deviceIds, cfg, req, en, log);
        try
        {
            session.Open();
            session.Start();
            session.Wait(progress, ct);
        }
        finally { session.Dispose(); }

        return CalibrationAnalyzer.Analyze(plan, session.Recording, (int)Math.Min(session.Recorded, session.Recording.Length),
            session.MicRate, req.MicDeviceId, session.Extras(log), progress);
    }

    /// <summary>Speaker id: the UI's <c>id</c> member; the CLI may also pass the speaker's name.</summary>
    public static string? IdOf(SpeakerConfig s) =>
        s.Extra != null && s.Extra.TryGetValue("id", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static (List<Target>, int) Resolve(SurroundConfig cfg, CalibrationRequest req)
    {
        var ids = req.SpeakerIds.Where(i => !string.IsNullOrWhiteSpace(i)).Select(i => i.Trim()).Distinct().ToList();
        if (ids.Count == 0) throw new ArgumentException("Kalibre edilecek hoparlör seçilmedi.");
        string refId = string.IsNullOrWhiteSpace(req.ReferenceSpeakerId) ? ids[0] : req.ReferenceSpeakerId.Trim();
        if (!ids.Contains(refId)) ids.Insert(0, refId);
        if (ids.Count > CalibrationPlan.MaxSpeakers)
            throw new ArgumentException($"Aynı anda en fazla {CalibrationPlan.MaxSpeakers} hoparlör kalibre edilebilir.");

        bool loopback = string.Equals(cfg.Source.Mode?.Trim(), "loopback", StringComparison.OrdinalIgnoreCase);
        var lowIds = req.LowBandSpeakerIds?.Select(i => i.Trim()).ToHashSet();
        var list = new List<Target>();
        foreach (var id in ids)
        {
            var s = cfg.Speakers.FirstOrDefault(x => IdOf(x) == id)
                ?? cfg.Speakers.FirstOrDefault(x => string.Equals(x.Name.Trim(), id, StringComparison.OrdinalIgnoreCase))
                ?? throw new ArgumentException($"Hoparlör bulunamadı: {id}");
            if (loopback && SurroundConfig.SameId(s.OutputDeviceId, cfg.Source.DeviceId))
                throw new ArgumentException($"'{s.Name}' kaynak cihazda; Windows doğrudan çalıyor, kalibre edilemez.");
            bool low = lowIds != null ? lowIds.Contains(id) : IsLfeOnly(s);
            list.Add(new Target(id, s, low));
        }
        return (list, ids.IndexOf(refId));
    }

    private static bool IsLfeOnly(SpeakerConfig s) =>
        s.Source.Any(kv => Channels.IndexOf(kv.Key) == Channels.LFE && kv.Value != 0)
        && s.Source.All(kv => kv.Value == 0 || Channels.IndexOf(kv.Key) == Channels.LFE);

    /// <summary>Devices, streams and the capture callback (which renders the program and records the mic).</summary>
    private sealed class Session : IDisposable
    {
        private readonly CalibrationPlan _plan;
        private readonly List<Target> _targets;
        private readonly List<string> _deviceIds;
        private readonly SurroundConfig _cfg;
        private readonly CalibrationRequest _req;
        private readonly MMDeviceEnumerator _en;
        private readonly Action<string>? _log;
        private readonly List<OutputSink> _sinks = new();
        private readonly ManualResetEventSlim _done = new(false);
        private MMDevice? _micDevice;
        private WasapiCapture? _capture;
        private WasapiOut? _keepAlive;
        private WaveFormat? _fmt;
        private volatile string? _error;
        private volatile bool _stopped;

        // Capture-thread state.
        private float[] _conv = new float[16384];
        private readonly float[] _logical = new float[Channels.Count * 1024];
        private double _acc;
        private long _program;
        private long _recorded;
        private long _total;
        private readonly List<long> _clips = new();
        // Clock samples (Stopwatch ticks): mic callbacks here, render callbacks per sink (one writer thread each).
        private long[] _micTicks = Array.Empty<long>(), _micFrames = Array.Empty<long>();
        private int _micCount;
        private long[][] _sinkTicks = Array.Empty<long[]>(), _sinkConsumed = Array.Empty<long[]>();
        private int[] _sinkCounts = Array.Empty<int>();
        private double[] _targetMs = Array.Empty<double>();
        private long[][] _glitchAt = Array.Empty<long[]>(); // [boundary][sink]
        private int _nextBoundary;

        public Session(CalibrationPlan plan, List<Target> targets, List<string> deviceIds, SurroundConfig cfg, CalibrationRequest req,
            MMDeviceEnumerator en, Action<string>? log)
        {
            _plan = plan; _targets = targets; _deviceIds = deviceIds; _cfg = cfg; _req = req; _en = en; _log = log;
        }

        public float[] Recording { get; private set; } = Array.Empty<float>();
        public long Recorded => Interlocked.Read(ref _recorded);
        public int MicRate => _fmt?.SampleRate ?? 0;

        public void Open()
        {
            try { _micDevice = _en.GetDevice(_req.MicDeviceId.Trim()); }
            catch { throw new ArgumentException($"Mikrofon bulunamadı: {_req.MicDeviceId}"); }
            if (_micDevice.State != DeviceState.Active) throw new ArgumentException($"'{_micDevice.FriendlyName}' etkin değil.");
            if (_req.MicLoopback && _micDevice.DataFlow != DataFlow.Render)
                throw new ArgumentException($"'{_micDevice.FriendlyName}' bir çıkış cihazı değil (loopback testi çıkış cihazı ister).");
            if (!_req.MicLoopback && _micDevice.DataFlow != DataFlow.Capture)
                throw new ArgumentException($"'{_micDevice.FriendlyName}' bir kayıt cihazı değil.");

            _capture = _req.MicLoopback ? new LoopbackCapture(_micDevice, CaptureBufferMs) : new WasapiCapture(_micDevice, true, CaptureBufferMs);
            _fmt = _capture.WaveFormat;
            if (!SampleConverter.IsSupported(_fmt)) throw new NotSupportedException($"Mikrofon formatı desteklenmiyor: {_fmt}");

            _total = (long)Math.Ceiling(_plan.TotalFrames * (double)_fmt.SampleRate / _plan.Rate);
            Recording = new float[_total];
            int cap = (int)(_plan.Seconds * 1000) + 256; // callbacks come every ≥ 1 ms
            _micTicks = new long[cap];
            _micFrames = new long[cap];

            for (int d = 0; d < _deviceIds.Count; d++)
            {
                MMDevice dev;
                try { dev = _en.GetDevice(_deviceIds[d]); }
                catch { throw new ArgumentException($"Çıkış cihazı bulunamadı: {_deviceIds[d]}"); }
                if (dev.State != DeviceState.Active) { var name = dev.FriendlyName; dev.Dispose(); throw new ArgumentException($"'{name}' etkin değil."); }
                int devCh = dev.AudioClient.MixFormat.Channels;
                var routes = new List<SpeakerRoute>();
                for (int i = 0; i < _targets.Count; i++)
                {
                    var s = _targets[i].Speaker;
                    if (!SurroundConfig.SameId(s.OutputDeviceId, _deviceIds[d])) continue;
                    if (s.DeviceChannel < 1 || s.DeviceChannel > devCh)
                    {
                        dev.Dispose();
                        throw new ArgumentException($"'{s.Name}': cihaz {devCh} kanallı; istenen kanal {s.DeviceChannel}.");
                    }
                    var row = new float[Channels.Count];
                    row[i] = 1f; // speaker i plays program lane i
                    routes.Add(new SpeakerRoute(s.Name, s.DeviceChannel - 1, row, 0, false, 0));
                }
                var o = _cfg.Outputs.FirstOrDefault(x => SurroundConfig.SameId(x.DeviceId, _deviceIds[d]));
                double bufferMs = o is { BufferMs: >= 10 and <= 500 } ? o.BufferMs : 40;
                _sinks.Add(new OutputSink(dev, bufferMs, _plan.Rate, routes, _cfg.Processing.Limiter, _log,
                    msg => _error ??= msg, steadyClock: true));
            }
            _targetMs = _sinks.Select(s => s.BufferMs).ToArray();
            _sinkTicks = _sinks.Select(_ => new long[cap]).ToArray();
            _sinkConsumed = _sinks.Select(_ => new long[cap]).ToArray();
            _sinkCounts = new int[_sinks.Count];
            for (int d = 0; d < _sinks.Count; d++)
            {
                int sink = d;
                _sinks[d].RenderObserver = consumed =>
                {
                    int i = _sinkCounts[sink];
                    if (i >= _sinkTicks[sink].Length) return;
                    _sinkTicks[sink][i] = System.Diagnostics.Stopwatch.GetTimestamp();
                    _sinkConsumed[sink][i] = consumed;
                    Volatile.Write(ref _sinkCounts[sink], i + 1);
                };
            }
            _glitchAt = new long[_plan.Steps.Count + 1][];

            if (_req.MicLoopback)
            {
                // Loopback delivers no packets while the device renders nothing (see SurroundEngine).
                _keepAlive = new WasapiOut(_micDevice, AudioClientShareMode.Shared, true, 50);
                _keepAlive.Init(new SilenceProvider(_micDevice.AudioClient.MixFormat));
            }
            _capture.DataAvailable += OnData;
            _capture.RecordingStopped += (_, e) => { if (e.Exception != null) _error ??= $"Mikrofon hatası: {e.Exception.Message}"; };
        }

        public void Start()
        {
            foreach (var s in _sinks) s.Start();
            _keepAlive?.Play();
            _capture!.StartRecording();
        }

        public void Wait(Action<CalibrationProgress>? progress, CancellationToken ct)
        {
            int steps = _plan.Steps.Count;
            int lastStep = -2;
            long lastRecorded = -1;
            var stall = System.Diagnostics.Stopwatch.StartNew();
            while (!_done.Wait(50))
            {
                ct.ThrowIfCancellationRequested();
                if (_error is { } err) throw new InvalidOperationException(err);
                long rec = Recorded;
                if (rec != lastRecorded) { lastRecorded = rec; stall.Restart(); }
                else if (stall.ElapsedMilliseconds > 3000)
                    throw new InvalidOperationException(rec == 0 ? "Mikrofondan ses gelmiyor." : "Mikrofon akışı durdu.");

                long prog = (long)(rec * (double)_plan.Rate / MicRate);
                int step = -1;
                for (int i = 0; i < steps; i++) if (_plan.Steps[i].StartFrame <= prog) step = i;
                if (step == lastStep) continue;
                lastStep = step;
                if (step < 0)
                    progress?.Invoke(new CalibrationProgress(CalibrationPhase.Noise, null, 0, steps, "Ortam gürültüsü ölçülüyor"));
                else
                {
                    var t = _targets[_plan.Steps[step].Test];
                    progress?.Invoke(new CalibrationProgress(CalibrationPhase.Measuring, t.Id, step + 1, steps,
                        $"Ölçülüyor: {t.Speaker.Name} ({step + 1}/{steps})"));
                }
            }
            if (_error is { } e2) throw new InvalidOperationException(e2);
        }

        private void OnData(object? sender, WaveInEventArgs e)
        {
            if (_stopped) return;
            try { Process(e); }
            catch (Exception ex) { _error ??= $"Kalibrasyon hatası: {ex.Message}"; _done.Set(); }
        }

        private void Process(WaveInEventArgs e)
        {
            var fmt = _fmt!;
            int ch = fmt.Channels;
            int frames = e.BytesRecorded / fmt.BlockAlign;
            if (frames == 0) return;
            if (_conv.Length < frames * ch) _conv = new float[frames * ch * 2];
            SampleConverter.ToFloat(e.Buffer, frames * fmt.BlockAlign, fmt, _conv);

            // Mono = channel average (a loopback "mic" carries each speaker on its own channel).
            long pos = _recorded;
            var rec = Recording;
            float inv = 1f / ch;
            for (int f = 0; f < frames; f++, pos++)
            {
                float sum = 0;
                bool clip = false;
                for (int c = 0; c < ch; c++)
                {
                    float v = _conv[f * ch + c];
                    sum += v;
                    if (MathF.Abs(v) >= 0.999f) clip = true;
                }
                if (pos < rec.Length)
                {
                    rec[pos] = sum * inv;
                    if (clip && _clips.Count < 10000) _clips.Add(pos);
                }
            }
            Interlocked.Exchange(ref _recorded, pos);

            // The program advances by exactly rate/micRate frames per mic frame: the mic is its clock.
            _acc += frames * (double)_plan.Rate / fmt.SampleRate;
            int k = (int)_acc;
            _acc -= k;
            const int lanes = Channels.Count;
            while (k > 0)
            {
                int nf = Math.Min(k, _logical.Length / lanes);
                var span = _logical.AsSpan(0, nf * lanes);
                span.Clear();
                _plan.Render(_program, nf, span, lanes);
                foreach (var s in _sinks) s.Push(span, default, nf);
                _program += nf;
                k -= nf;
                while (_nextBoundary < _glitchAt.Length && _program >= Boundary(_nextBoundary))
                    _glitchAt[_nextBoundary++] = _sinks.Select(s => s.Glitches).ToArray();
            }

            if (_micCount < _micTicks.Length)
            {
                _micTicks[_micCount] = System.Diagnostics.Stopwatch.GetTimestamp();
                _micFrames[_micCount] = pos;
                _micCount++;
            }
            if (pos >= _total) _done.Set();
        }

        private long Boundary(int i) => i < _plan.Steps.Count ? _plan.Steps[i].StartFrame : _plan.TotalFrames;

        public CalibrationExtras Extras(Action<string>? log)
        {
            var glitched = new bool[_plan.Steps.Count];
            for (int i = 0; i < glitched.Length; i++)
            {
                var a = _glitchAt[i]; var b = _glitchAt[i + 1];
                if (a is null || b is null) { glitched[i] = true; continue; }
                var st = _plan.Steps[i];
                int s1 = _plan.Speakers[_plan.Reference].Sink, s2 = _plan.Speakers[st.Test].Sink;
                glitched[i] = a[s1] != b[s1] || a[s2] != b[s2];
            }
            return new CalibrationExtras
            {
                Latency = new LatencyTrack(_plan.Rate, MicRate, _micTicks, _micFrames, _micCount, _sinkTicks, _sinkConsumed,
                    _sinkCounts.ToArray(), _targetMs),
                StepGlitched = glitched,
                ClipPositions = _clips,
                Log = log,
            };
        }

        public void Dispose()
        {
            _stopped = true;
            if (_capture != null)
            {
                _capture.DataAvailable -= OnData;
                try { _capture.StopRecording(); } catch { }
            }
            foreach (var s in _sinks) { try { s.Dispose(); } catch { } }
            _sinks.Clear();
            if (_keepAlive != null) { try { _keepAlive.Stop(); } catch { } _keepAlive.Dispose(); _keepAlive = null; }
            _capture?.Dispose();
            _capture = null;
            _micDevice?.Dispose();
            _micDevice = null;
        }
    }
}
