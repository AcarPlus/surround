using System.Text;
using Surround.Engine;
using Surround.Engine.Audio;
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
    var opts = ParseOptions(args.Skip(1).Where(a => a != "--all").ToArray());
    switch (args[0].ToLowerInvariant())
    {
        case "devices": return CmdDevices(all);
        case "validate": return CmdValidate(Require(opts, "config"));
        case "run": return CmdRun(Require(opts, "config"));
        case "probe":
            return CmdProbe(Require(opts, "device"),
                opts.TryGetValue("seconds", out var ps) ? double.Parse(ps, System.Globalization.CultureInfo.InvariantCulture) : 5,
                opts.TryGetValue("buffer", out var pb) ? int.Parse(pb) : 20);
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
    Console.Error.WriteLine(ex.Message);
    return 1;
}
catch (FormatException)
{
    Console.Error.WriteLine("Sayısal parametre geçersiz.");
    return 1;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"Hata: {ex.Message}");
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
            Console.WriteLine($"-- kaynak {st.SourceRate} Hz/{st.SourceChannels} kanal{up}, {st.SourceFrames} kare");
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
    keep.Init(new NAudio.Wave.SilenceProvider(NAudio.Wave.WaveFormat.CreateIeeeFloatWaveFormat(cap.WaveFormat.SampleRate, cap.WaveFormat.Channels)));
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

sealed class ProbeLoopback(NAudio.CoreAudioApi.MMDevice d, int ms) : NAudio.CoreAudioApi.WasapiCapture(d, false, ms)
{
    protected override NAudio.CoreAudioApi.AudioClientStreamFlags GetAudioClientStreamFlags() =>
        NAudio.CoreAudioApi.AudioClientStreamFlags.Loopback | base.GetAudioClientStreamFlags();
}
