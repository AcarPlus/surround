using System.Text;
using Surround.Engine;
using Surround.Engine.Audio;
using Surround.Engine.Calibration;
using Surround.Engine.Config;

Console.OutputEncoding = Encoding.UTF8;

if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
{
    PrintUsage();
    return args.Length == 0 ? 1 : 0;
}

try
{
    bool all = args.Contains("--all");
    bool micLoopback = args.Contains("--mic-loopback");
    var opts = ParseOptions(args.Skip(1).Where(a => a is not "--all" and not "--mic-loopback").ToArray());
    switch (args[0].ToLowerInvariant())
    {
        case "devices": return CmdDevices(all);
        case "validate": return CmdValidate(Require(opts, "config"));
        case "run": return CmdRun(Require(opts, "config"));
        case "probe":
            return CmdProbe(Require(opts, "device"),
                opts.TryGetValue("seconds", out var ps) ? double.Parse(ps, System.Globalization.CultureInfo.InvariantCulture) : 5,
                opts.TryGetValue("buffer", out var pb) ? int.Parse(pb) : 20);
        case "cable-verify": return CmdCableVerify(Require(opts, "exe"));
        case "cable-71": return CmdCable71(Require(opts, "device"));
        case "calibrate": return CmdCalibrate(Require(opts, "config"), Require(opts, "mic"), micLoopback, opts);
        case "tone":
            return CmdTone(Require(opts, "device"), int.Parse(Require(opts, "channel")),
                opts.TryGetValue("seconds", out var sec) ? double.Parse(sec, System.Globalization.CultureInfo.InvariantCulture) : 2);
        default:
            Console.Error.WriteLine($"Bilinmeyen komut: {args[0]}");
            PrintUsage();
            return 1;
    }
}
catch (ArgumentException ex) when (ex is not ArgumentOutOfRangeException)
{
    Console.Error.WriteLine(Environment.GetEnvironmentVariable("SURROUND_TRACE") is null ? ex.Message : ex.ToString());
    return 1;
}
catch (FormatException)
{
    Console.Error.WriteLine("Sayısal parametre geçersiz.");
    return 1;
}
catch (Exception ex)
{
    Console.Error.WriteLine(Environment.GetEnvironmentVariable("SURROUND_TRACE") is null ? $"Hata: {ex.Message}" : ex.ToString());
    return 2;
}

static void PrintUsage()
{
    Console.WriteLine("""
        Kullanım:
          surround devices [--all]                   Ses cihazlarını listele (--all: pasif olanlar dahil)
          surround validate --config <yol>          Yapılandırmayı doğrula
          surround run --config <yol>               Motoru çalıştır (Ctrl+C ile durdur)
          surround tone --device <id> --channel <n> [--seconds 2]
                                                    Cihazın tek kanalında 440 Hz test sesi
          surround probe --device <id> [--seconds 5] [--buffer 20]
                                                    Bir çıkış cihazını loopback ile dinleyip paket boyutu/aralığı istatistiği (tanı)
          surround calibrate --config <yol> --mic <id> [--mic-loopback] [--speakers id1,id2] [--ref id]
                             [--repeats 2] [--level -20] [--low-band id,...]
                                                    Mikrofonla hoparlör gecikme/seviye ölçümü
                                                    (--mic-loopback: mikrofon yerine bir çıkış cihazının loopback'i)
        """);
}

static Dictionary<string, string> ParseOptions(string[] a)
{
    var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    for (int i = 0; i < a.Length; i++)
    {
        if (!a[i].StartsWith("--")) throw new ArgumentException($"Beklenmeyen parametre: {a[i]}");
        if (i + 1 >= a.Length) throw new ArgumentException($"{a[i]} için değer eksik.");
        d[a[i][2..]] = a[++i];
    }
    return d;
}

static string Require(Dictionary<string, string> o, string key) =>
    o.TryGetValue(key, out var v) ? v : throw new ArgumentException($"--{key} parametresi gerekli.");

static int CmdDevices(bool all)
{
    var list = DeviceEnumeration.List(includeInactive: all);
    foreach (var flow in new[] { DeviceFlow.Render, DeviceFlow.Capture })
    {
        Console.WriteLine(flow == DeviceFlow.Render ? "== Oynatma (render) cihazları ==" : "== Kayıt (capture) cihazları ==");
        foreach (var d in list.Where(x => x.Flow == flow))
        {
            string fmt = d.SampleRate > 0 ? $"{d.SampleRate} Hz, {d.Channels} kanal" : "format yok";
            Console.WriteLine($"{(d.IsDefault ? "*" : " ")} {d.Name}");
            Console.WriteLine($"    ID: {d.Id}");
            Console.WriteLine($"    Durum: {d.State}  Format: {fmt}{(d.IsDefault ? "  [VARSAYILAN]" : "")}");
        }
        Console.WriteLine();
    }
    return 0;
}

static int CmdValidate(string path)
{
    var cfg = SurroundConfig.Load(path);
    var errors = ConfigValidator.Validate(cfg);
    if (errors.Count == 0) errors = ConfigValidator.CheckDevices(cfg, new WasapiDeviceCatalog());
    if (errors.Count == 0)
    {
        Console.WriteLine("Yapılandırma geçerli.");
        return 0;
    }
    foreach (var e in errors) Console.Error.WriteLine("- " + e);
    return 1;
}

static int CmdRun(string path)
{
    var cfg = SurroundConfig.Load(path);
    using var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

    SurroundEngine? engine = null;
    try
    {
        engine = new SurroundEngine(cfg, msg => Console.WriteLine(msg));
        engine.Start();
        Console.WriteLine("Çalışıyor. Durdurmak için Ctrl+C.");
        while (!cts.Token.WaitHandle.WaitOne(1000))
        {
            var st = engine.GetStatus();
            string up = st.UpmixState switch
            {
                Surround.Engine.Dsp.UpmixState.Stereo => " (upmix etkin: stereo içerik)",
                Surround.Engine.Dsp.UpmixState.Native => " (yerel çok kanal)",
                _ => "",
            };
            var (dspMs, dspMax) = engine.DrainDspTime();
            Console.WriteLine($"-- kaynak {st.SourceRate} Hz/{st.SourceChannels} kanal{up}, {st.SourceFrames} kare, DSP {dspMs / 10:0.0}% (en uzun {dspMax:0.0} ms)");
            foreach (var s in st.Sinks)
                Console.WriteLine($"   {s.Name}: doluluk {s.FillMs:F1} ms, düzeltme {s.CorrectionPpm:+0.0;-0.0;0.0} ppm, underrun {s.Underruns}, overrun {s.Overruns}, {s.DeviceRate} Hz/{s.DeviceChannels} kanal");
        }
        return 0;
    }
    catch (ConfigException ex)
    {
        Console.Error.WriteLine("Yapılandırma hatası:");
        foreach (var e in ex.Errors) Console.Error.WriteLine("- " + e);
        return 1;
    }
    finally
    {
        engine?.Dispose();
        Console.WriteLine("Durduruldu.");
    }
}

static int CmdCalibrate(string path, string mic, bool micLoopback, Dictionary<string, string> o)
{
    var cfg = SurroundConfig.Load(path);
    static List<string> Ids(string v) => v.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
    var ids = o.TryGetValue("speakers", out var sp) ? Ids(sp)
        : cfg.Speakers.Select(s => CalibrationRunner.IdOf(s) ?? s.Name).ToList();
    var inv = System.Globalization.CultureInfo.InvariantCulture;
    var req = new CalibrationRequest(mic, ids,
        o.TryGetValue("ref", out var r) ? r : null, micLoopback,
        o.TryGetValue("repeats", out var rep) ? int.Parse(rep, inv) : 2,
        o.TryGetValue("level", out var lv) ? double.Parse(lv, inv) : -20,
        o.TryGetValue("low-band", out var lb) ? Ids(lb) : null);

    using var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
    string? lastPhase = null;
    CalibrationResult res;
    try
    {
        res = CalibrationRunner.Run(cfg, req, p =>
        {
            if (p.Phase == CalibrationPhase.Analyzing && lastPhase == CalibrationPhase.Analyzing) return;
            lastPhase = p.Phase;
            Console.WriteLine($"[{p.Phase}] {p.Message}");
        }, cts.Token, msg => Console.WriteLine(msg));
    }
    catch (OperationCanceledException)
    {
        Console.Error.WriteLine("Kalibrasyon iptal edildi.");
        return 1;
    }

    var names = new Dictionary<string, string>();
    foreach (var s in cfg.Speakers) names.TryAdd(CalibrationRunner.IdOf(s) ?? s.Name, s.Name);
    Console.WriteLine();
    Console.WriteLine($"Referans: {res.ReferenceSpeakerId}   gürültü tabanı {res.NoiseFloorDb:0.0} dBFS{(res.MicClipped ? "   MİKROFON KIRPILDI" : "")}");
    Console.WriteLine($"{"Hoparlör",-24} {"tamam",5} {"varış ms",9} {"seviye dB",9} {"SNR dB",7} {"fark ms",8} {"bas",4}  not");
    foreach (var s in res.Speakers)
    {
        string name = names.TryGetValue(s.SpeakerId, out var nm) ? nm : s.SpeakerId;
        Console.WriteLine(string.Create(inv,
            $"{name,-24} {(s.Ok ? "evet" : "HAYIR"),5} {s.ArrivalMs,9:0.000} {s.LevelDb,9:0.00} {s.SnrDb,7:0.0} {s.SpreadMs,8:0.000} {(s.LowBand ? "evet" : ""),4}  {s.Message}"));
    }
    return res.Speakers.All(s => s.Ok) ? 0 : 3;
}

static int CmdCableVerify(string exe)
{
    bool ok = CableInstaller.IsTrusted(exe, out var why);
    Console.WriteLine(ok ? "güvenilir (VB-Audio imzalı)" : $"güvenilir DEĞİL: {why}");
    return ok ? 0 : 2;
}

static int CmdCable71(string deviceId)
{
    SpeakerLayout.SetSevenOne(deviceId);
    using var en = new NAudio.CoreAudioApi.MMDeviceEnumerator();
    using var d = en.GetDevice(deviceId);
    var f = d.AudioClient.MixFormat;
    Console.WriteLine($"{d.FriendlyName}: {f.Channels} kanal, {f.SampleRate} Hz");
    return f.Channels == 8 ? 0 : 2;
}

static int CmdTone(string deviceId, int channel, double seconds)
{
    using var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
    Console.WriteLine($"Kanal {channel} üzerinde 440 Hz, {seconds:0.#} sn...");
    ToneRunner.Play(deviceId, channel, seconds, cts.Token);
    Console.WriteLine("Bitti.");
    return 0;
}

/// <summary>Loopback-captures a render device and prints packet size/interval statistics (diagnoses bursty sources).</summary>
static int CmdProbe(string deviceId, double seconds, int bufferMs)
{
    using var en = new NAudio.CoreAudioApi.MMDeviceEnumerator();
    var dev = en.GetDevice(deviceId.Trim());
    using var cap = new ProbeLoopback(dev, bufferMs);
    using var keep = new NAudio.Wave.WasapiOut(dev, NAudio.CoreAudioApi.AudioClientShareMode.Shared, true, 50);
    keep.Init(new NAudio.Wave.SilenceProvider(dev.AudioClient.MixFormat));
    var sizes = new List<int>(); var gaps = new List<double>();
    var sw = System.Diagnostics.Stopwatch.StartNew(); double last = 0;
    cap.DataAvailable += (_, e) =>
    {
        double now = sw.Elapsed.TotalMilliseconds;
        lock (sizes) { sizes.Add(e.BytesRecorded / cap.WaveFormat.BlockAlign); if (last > 0) gaps.Add(now - last); last = now; }
    };
    keep.Play(); cap.StartRecording();
    Thread.Sleep(TimeSpan.FromSeconds(seconds));
    cap.StopRecording(); keep.Stop();
    lock (sizes)
    {
        if (sizes.Count == 0) { Console.WriteLine("Paket gelmedi."); return 1; }
        gaps.Sort();
        double p99 = gaps.Count > 0 ? gaps[(int)(gaps.Count * 0.99)] : 0;
        Console.WriteLine($"{dev.FriendlyName}: {cap.WaveFormat.SampleRate} Hz/{cap.WaveFormat.Channels} kanal, tampon {bufferMs} ms");
        Console.WriteLine($"paket {sizes.Count}, kare min/ort/maks {sizes.Min()}/{sizes.Average():F0}/{sizes.Max()}, {sizes.Sum() / seconds:F0} kare/sn");
        if (gaps.Count > 0) Console.WriteLine($"aralık ms ort/p99/maks {gaps.Average():F1}/{p99:F1}/{gaps.Max():F1}");
    }
    return 0;
}

sealed class ProbeLoopback(NAudio.CoreAudioApi.MMDevice d, int ms) : NAudio.CoreAudioApi.WasapiCapture(d, true, ms)
{
    protected override NAudio.CoreAudioApi.AudioClientStreamFlags GetAudioClientStreamFlags() =>
        NAudio.CoreAudioApi.AudioClientStreamFlags.Loopback | base.GetAudioClientStreamFlags();
}
