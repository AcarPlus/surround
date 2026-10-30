namespace Surround.Engine.Config;

public enum DeviceFlow { Render, Capture }

public sealed record DeviceDescriptor(string Id, string Name, DeviceFlow Flow, int Channels, int SampleRate);

public interface IDeviceCatalog
{
    DeviceDescriptor? Find(string id);
}

public static class ConfigValidator
{
    /// <summary>Static checks that need no audio devices.</summary>
    public static List<string> Validate(SurroundConfig cfg)
    {
        var e = new List<string>();
        var mode = cfg.Source.Mode?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(cfg.Source.DeviceId)) e.Add("source.deviceId boş olamaz.");
        if (mode != "loopback" && mode != "capture") e.Add($"source.mode 'loopback' veya 'capture' olmalı (bulunan: '{cfg.Source.Mode}').");

        bool hadSpeakers = cfg.Speakers.Count > 0;
        cfg = cfg.ForRouting();
        if (cfg.Speakers.Count == 0)
            e.Add(hadSpeakers
                ? "Tüm hoparlörler kaynak cihazda; yönlendirilecek hoparlör yok. Başka bir cihaza en az bir hoparlör ekleyin."
                : "En az bir hoparlör (speakers) gerekli.");

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < cfg.Outputs.Count; i++)
        {
            var o = cfg.Outputs[i];
            if (string.IsNullOrWhiteSpace(o.DeviceId)) { e.Add($"outputs[{i}].deviceId boş olamaz."); continue; }
            if (!seen.Add(o.DeviceId.Trim())) e.Add($"outputs[{i}]: aynı cihaz birden fazla kez tanımlı.");
            if (o.LatencyMs < 0 || !double.IsFinite(o.LatencyMs)) e.Add($"outputs[{i}].latencyMs geçersiz.");
            if (!(o.BufferMs >= 10 && o.BufferMs <= 500)) e.Add($"outputs[{i}].bufferMs 10-500 aralığında olmalı.");
            if (mode == "loopback" && SurroundConfig.SameId(o.DeviceId, cfg.Source.DeviceId))
                e.Add($"outputs[{i}]: loopback kaynak cihazı aynı zamanda çıkış olamaz (geri besleme döngüsü).");
        }

        for (int i = 0; i < cfg.Speakers.Count; i++)
        {
            var s = cfg.Speakers[i];
            string n = string.IsNullOrWhiteSpace(s.Name) ? $"speakers[{i}]" : $"'{s.Name}'";
            if (!cfg.Outputs.Any(o => SurroundConfig.SameId(o.DeviceId, s.OutputDeviceId)))
                e.Add($"{n}: outputDeviceId outputs listesinde yok.");
            if (s.DeviceChannel < 1) e.Add($"{n}: deviceChannel 1 veya büyük olmalı.");
            if (s.Source.Count == 0 && !s.Mute) e.Add($"{n}: source (karışım satiri) bos.");
            foreach (var (key, gain) in s.Source)
            {
                if (Channels.IndexOf(key) < 0) e.Add($"{n}: bilinmeyen kanal adı '{key}' (geçerli: {string.Join(", ", Channels.Names)}).");
                if (!double.IsFinite(gain)) e.Add($"{n}: '{key}' kazancı geçersiz.");
            }
            if (s.DelayMs < 0 || !double.IsFinite(s.DelayMs)) e.Add($"{n}: delayMs geçersiz.");
            if (!double.IsFinite(s.GainDb)) e.Add($"{n}: gainDb geçersiz.");
        }
        return e;
    }

    /// <summary>Checks that need to look at real (or faked) devices.</summary>
    public static List<string> CheckDevices(SurroundConfig cfg, IDeviceCatalog catalog)
    {
        var e = new List<string>();
        var mode = cfg.Source.Mode?.Trim().ToLowerInvariant();
        cfg = cfg.ForRouting();
        var src = catalog.Find(cfg.Source.DeviceId);
        if (src is null) e.Add($"Kaynak cihaz bulunamadı: {cfg.Source.DeviceId}");
        else
        {
            if (mode == "loopback" && src.Flow != DeviceFlow.Render) e.Add($"Kaynak '{src.Name}' bir oynatma cihazı değil (loopback için gerekli).");
            if (mode == "capture" && src.Flow != DeviceFlow.Capture) e.Add($"Kaynak '{src.Name}' bir kayıt cihazı değil (capture için gerekli).");
        }

        var outs = new Dictionary<string, DeviceDescriptor>(StringComparer.OrdinalIgnoreCase);
        foreach (var o in cfg.Outputs)
        {
            var d = catalog.Find(o.DeviceId);
            if (d is null) { e.Add($"Çıkış cihazı bulunamadı: {o.DeviceId}"); continue; }
            if (d.Flow != DeviceFlow.Render) { e.Add($"Çıkış '{d.Name}' bir oynatma cihazı değil."); continue; }
            outs[o.DeviceId.Trim()] = d;
        }

        foreach (var s in cfg.Speakers)
        {
            if (!outs.TryGetValue(s.OutputDeviceId?.Trim() ?? "", out var d)) continue;
            if (s.DeviceChannel > d.Channels)
                e.Add($"'{s.Name}': deviceChannel {s.DeviceChannel}, ancak '{d.Name}' yalnızca {d.Channels} kanallı.");
        }
        return e;
    }
}
