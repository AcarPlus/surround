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

    internal sealed record Target(string Id, SpeakerConfig Speaker, bool LowBand);

    /// <summary>
    /// Resolved request: <paramref name="Targets"/> are measured (<paramref name="Reference"/> indexes them),
    /// <paramref name="Skipped"/> are reported without a measurement, <paramref name="Order"/> is the result order.
    /// </summary>
    internal sealed record Selection(List<Target> Targets, int Reference, List<string> Order, Dictionary<string, SpeakerCalibration> Skipped);

    /// <summary>Message of a speaker on the loopback source device (Windows renders it directly; it cannot be measured).</summary>
    public const string SourceDeviceMessage = "Kaynak cihazdaki hoparlör ölçülemez.";

    /// <summary>
    /// Blocks until done. Throws <see cref="OperationCanceledException"/> when <paramref name="ct"/> fires. A phone
    /// request (<see cref="CalibrationRequest.IsPhone"/>) needs <paramref name="external"/>: the program is then clocked by
    /// the first output device's loopback and the phone's own recording is aligned afterwards (<see cref="ExternalAlignment"/>).
    /// </summary>
    public static CalibrationResult Run(SurroundConfig cfg, CalibrationRequest req, Action<CalibrationProgress>? progress = null,
        CancellationToken ct = default, Action<string>? log = null, IExternalMicrophone? external = null)
    {
        progress?.Invoke(new CalibrationProgress(CalibrationPhase.Preparing, null, 0, 0, "Hazırlanıyor"));
        var sel = Resolve(cfg, req);
        var targets = sel.Targets;
        int refIdx = sel.Reference;
        int repeats = Math.Clamp(req.Repeats, 1, MaxRepeats);
        double levelDb = Math.Clamp(req.LevelDb, -40, -6);
        if (string.IsNullOrWhiteSpace(req.MicDeviceId)) throw new ArgumentException("Mikrofon seçilmedi.");
        if (req.IsPhone && external is null) throw new ArgumentException("Telefon bağlı değil.");

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
        var plan = new CalibrationPlan(rate, speakers, refIdx, repeats, levelDb, closingReference: req.IsPhone);

        var session = new Session(plan, targets, deviceIds, cfg, req, en, log, phone: external != null && req.IsPhone);
        ExternalRecording? rec = null;
        bool begun = false;
        try
        {
            session.Open();
            if (session.Phone)
            {
                progress?.Invoke(new CalibrationProgress(CalibrationPhase.Preparing, null, 0, 0, "Telefon kayda başlıyor"));
                external!.Begin(ct);
                begun = true;
            }
            session.Start();
            session.Wait(progress, ct);
        }
        catch
        {
            if (begun) { try { external!.Abort(); } catch { } }
            throw;
        }
        finally { session.Dispose(); }

        ct.ThrowIfCancellationRequested();
        var extras = session.Extras(log);
        CalibrationResult result;
        if (session.Phone)
        {
            progress?.Invoke(new CalibrationProgress(CalibrationPhase.Analyzing, null, 0, plan.Steps.Count, "Telefondan kayıt alınıyor"));
            rec = external!.Finish(ct);
            if (rec.Samples.Length == 0 || rec.SampleRate < 8000) throw new InvalidOperationException("Telefondan boş kayıt geldi.");
            var al = ExternalAlignment.Find(plan, rec.Samples, rec.Samples.Length, rec.SampleRate, ct);
            log?.Invoke(FormattableString.Invariant(
                $"telefon: {rec.SampleRate} Hz, saat farkı {al.ClockPpm} ppm, referans {al.ReferenceHits}/{al.Steps}, kesintili adım {al.Gaps} ({al.GapMs} ms)"));
            result = CalibrationAnalyzer.Analyze(plan, rec.Samples, rec.Samples.Length, rec.SampleRate, req.MicDeviceId,
                extras, progress, ct, new AnalysisOptions
                {
                    Map = al.Map, StepMaps = al.StepMaps, StepGap = al.StepGap,
                    MaxLatencySec = ExternalAlignment.WindowSec, Responses = true,
                });
            var notes = new List<string> { FormattableString.Invariant($"Telefon {rec.SampleRate} Hz, saat farkı {al.ClockPpm:0} ppm.") };
            if (!string.IsNullOrWhiteSpace(rec.Note)) notes.Add(rec.Note!);
            if (al.ReferenceHits < al.Steps) notes.Add($"Referans {al.Steps} adımın {al.ReferenceHits} tanesinde bulundu.");
            if (al.Gaps > 0)
                notes.Add(FormattableString.Invariant(
                    $"Telefon kaydında {al.Gaps} ölçümde kesinti bulundu (toplam {al.GapMs:0} ms); bu ölçümler zamanlamaya katılmadı."));
            result = result with { Note = string.Join(" ", notes) };
        }
        else
        {
            result = CalibrationAnalyzer.Analyze(plan, session.Recording, (int)Math.Min(session.Recorded, session.Recording.Length),
                session.MicRate, req.MicDeviceId, extras, progress, ct, new AnalysisOptions { Responses = req.Responses });
        }
        if (req.ApplyCorrections) result = WithoutCorrections(result, cfg, targets, refIdx, plan.Rate);
        return WithSkipped(result, sel);
    }

    /// <summary>
    /// Verification run: the speakers played with their delay, gain and roomEq. Reports what is heard now as the residual
    /// and converts the measurement back to the raw values (as if played without corrections), so the same suggestion
    /// logic applies to both kinds of run.
    /// </summary>
    internal static CalibrationResult WithoutCorrections(CalibrationResult r, SurroundConfig cfg, List<Target> targets, int refIdx, int rate)
    {
        var refS = targets[refIdx].Speaker;
        double D(SpeakerConfig s) => CorrectionDelaySamples(cfg, s, rate) * 1000.0 / rate;
        var byId = targets.ToDictionary(t => t.Id, t => t.Speaker);
        var speakers = r.Speakers.Select(m =>
        {
            if (!byId.TryGetValue(m.SpeakerId, out var s)) return m;
            double[]? resp = m.ResponseDb;
            if (resp != null && r.ResponseHz != null)
            {
                var st = EqDesign.Peq(rate, s.RoomEq, PeqBand.MaxRoomBands);
                resp = resp.Select((v, i) => Math.Round(v - FrequencyResponse.MagnitudeDb(st, rate, r.ResponseHz[i]) - s.GainDb, 2)).ToArray();
            }
            if (!m.Ok || m.SpeakerId == targets[refIdx].Id) return m with { ResponseDb = resp };
            return m with
            {
                ArrivalMs = Math.Round(m.ArrivalMs - (D(s) - D(refS)), 3),
                LevelDb = Math.Round(m.LevelDb - (s.GainDb - refS.GainDb), 2),
                ResidualArrivalMs = m.ArrivalMs,
                ResidualLevelDb = m.LevelDb,
                ResponseDb = resp,
            };
        }).ToList();
        return r with { Speakers = speakers, Verified = true };
    }

    /// <summary>The delay a verification run plays a speaker with: the engine's effective delay, in program frames.</summary>
    internal static int CorrectionDelaySamples(SurroundConfig cfg, SpeakerConfig s, int rate) =>
        (int)Math.Round(Math.Max(0, cfg.EffectiveDelayMs(s)) * rate / 1000.0);

    /// <summary>Speaker id: the UI's <c>id</c> member; the CLI may also pass the speaker's name.</summary>
    public static string? IdOf(SpeakerConfig s) =>
        s.Extra != null && s.Extra.TryGetValue("id", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>
    /// Looks the requested speakers up. With a loopback source, speakers on the source device are skipped (reported
    /// with <see cref="SourceDeviceMessage"/>) unless one is the explicit reference, which is an error; without an explicit
    /// reference the first measurable speaker is the reference.
    /// </summary>
    internal static Selection Resolve(SurroundConfig cfg, CalibrationRequest req)
    {
        var ids = req.SpeakerIds.Where(i => !string.IsNullOrWhiteSpace(i)).Select(i => i.Trim()).Distinct().ToList();
        if (ids.Count == 0) throw new ArgumentException("Kalibre edilecek hoparlör seçilmedi.");
        string? refId = string.IsNullOrWhiteSpace(req.ReferenceSpeakerId) ? null : req.ReferenceSpeakerId.Trim();
        if (refId != null && !ids.Contains(refId)) ids.Insert(0, refId);
        if (ids.Count > CalibrationPlan.MaxSpeakers)
            throw new ArgumentException($"Aynı anda en fazla {CalibrationPlan.MaxSpeakers} hoparlör kalibre edilebilir.");

        bool loopback = string.Equals(cfg.Source.Mode?.Trim(), "loopback", StringComparison.OrdinalIgnoreCase);
        var lowIds = req.LowBandSpeakerIds?.Select(i => i.Trim()).ToHashSet();
        var list = new List<Target>();
        var skipped = new Dictionary<string, SpeakerCalibration>();
        foreach (var id in ids)
        {
            var s = cfg.Speakers.FirstOrDefault(x => IdOf(x) == id)
                ?? cfg.Speakers.FirstOrDefault(x => string.Equals(x.Name.Trim(), id, StringComparison.OrdinalIgnoreCase))
                ?? throw new ArgumentException($"Hoparlör bulunamadı: {id}");
            bool low = lowIds != null ? lowIds.Contains(id) : IsLfeOnly(s);
            if (loopback && SurroundConfig.SameId(s.OutputDeviceId, cfg.Source.DeviceId))
            {
                if (id == refId)
                    throw new ArgumentException($"Referans hoparlör '{s.Name}' kaynak cihazda; Windows doğrudan çalıyor, ölçülemez. Başka bir referans seçin.");
                skipped[id] = new SpeakerCalibration(id, false, 0, 0, 0, 0, low, SourceDeviceMessage);
                continue;
            }
            list.Add(new Target(id, s, low));
        }
        if (list.Count == 0)
            throw new ArgumentException("Seçilen hoparlörlerin hepsi kaynak cihazda; Windows doğrudan çalıyor, ölçülemez.");
        int refIdx = refId != null ? list.FindIndex(t => t.Id == refId) : 0;
        return new Selection(list, refIdx, ids, skipped);
    }

    /// <summary>Puts the skipped speakers back into the result, in request order.</summary>
    internal static CalibrationResult WithSkipped(CalibrationResult result, Selection sel)
    {
        if (sel.Skipped.Count == 0) return result;
        var measured = result.Speakers.GroupBy(s => s.SpeakerId).ToDictionary(g => g.Key, g => g.First());
        var speakers = new List<SpeakerCalibration>(sel.Order.Count);
        foreach (var id in sel.Order)
        {
            if (sel.Skipped.TryGetValue(id, out var skip)) speakers.Add(skip);
            else if (measured.TryGetValue(id, out var m)) speakers.Add(m);
        }
        return result with { Speakers = speakers };
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
            MMDeviceEnumerator en, Action<string>? log, bool phone = false)
        {
            _plan = plan; _targets = targets; _deviceIds = deviceIds; _cfg = cfg; _req = req; _en = en; _log = log;
            Phone = phone;
        }

        /// <summary>
        /// The microphone is a phone: the local "microphone" is only the clock — the loopback of the first output device
        /// (it renders the program, so its packets come at that device's pace, like a source capture).
        /// </summary>
        public bool Phone { get; }
        private bool ClockIsLoopback => _req.MicLoopback || Phone;

        public float[] Recording { get; private set; } = Array.Empty<float>();
        public long Recorded => Interlocked.Read(ref _recorded);
        public int MicRate => _fmt?.SampleRate ?? 0;

        public void Open()
        {
            string micId = Phone ? _deviceIds[0] : _req.MicDeviceId.Trim();
            try { _micDevice = _en.GetDevice(micId); }
            catch { throw new ArgumentException($"Mikrofon bulunamadı: {micId}"); }
            if (_micDevice.State != DeviceState.Active) throw new ArgumentException($"'{_micDevice.FriendlyName}' etkin değil.");
            if (ClockIsLoopback && _micDevice.DataFlow != DataFlow.Render)
                throw new ArgumentException($"'{_micDevice.FriendlyName}' bir çıkış cihazı değil (loopback testi çıkış cihazı ister).");
            if (!ClockIsLoopback && _micDevice.DataFlow != DataFlow.Capture)
                throw new ArgumentException($"'{_micDevice.FriendlyName}' bir kayıt cihazı değil.");

            _capture = ClockIsLoopback ? new LoopbackCapture(_micDevice, CaptureBufferMs) : new WasapiCapture(_micDevice, true, CaptureBufferMs);
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
                    routes.Add(_req.ApplyCorrections
                        ? new SpeakerRoute(s.Name, s.DeviceChannel - 1, row, s.GainDb, false,
                            CorrectionDelaySamples(_cfg, s, _plan.Rate), RoomEq: s.RoomEq)
                        : new SpeakerRoute(s.Name, s.DeviceChannel - 1, row, 0, false, 0));
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

            if (ClockIsLoopback)
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
                ClipPositions = Phone ? null : _clips,
                Log = log,
                ClockRate = Phone ? MicRate : null,
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
