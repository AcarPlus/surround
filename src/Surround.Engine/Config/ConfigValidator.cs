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
            if (!(o.LatencyMs >= 0 && o.LatencyMs <= MaxMs)) e.Add($"outputs[{i}].latencyMs 0-{MaxMs} ms aralığında olmalı (bulunan: {o.LatencyMs}).");
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
            if (s.Source.Count == 0 && !s.Mute) e.Add($"{n}: source (karışım satırı) boş.");
            foreach (var (key, gain) in s.Source)
            {
                if (Channels.IndexOf(key) < 0) e.Add($"{n}: bilinmeyen kanal adı '{key}' (geçerli: {string.Join(", ", Channels.Names)}).");
                if (!double.IsFinite(gain)) e.Add($"{n}: '{key}' kazancı geçersiz.");
            }
            if (!(s.DelayMs >= 0 && s.DelayMs <= MaxMs)) e.Add($"{n}: delayMs 0-{MaxMs} ms aralığında olmalı (bulunan: {s.DelayMs}).");
            if (!(s.GainDb >= MinGainDb && s.GainDb <= MaxGainDb)) e.Add($"{n}: gainDb {MinGainDb}..{MaxGainDb} dB aralığında olmalı (bulunan: {s.GainDb}).");
            if (s.Eq != null) CheckEq(e, $"{n}: eq", s.Eq);
            if (!(s.HighPassHz == 0 || (s.HighPassHz >= MinHighPassHz && s.HighPassHz <= MaxHighPassHz)))
                e.Add($"{n}: highPassHz 0 (kapalı) veya {MinHighPassHz}-{MaxHighPassHz} aralığında olmalı.");
            if (s.HighPassHz > 0 && s.BassReceiver)
                e.Add($"{n}: hem bası kesilen (highPassHz) hem bas alıcısı (bassReceiver) olamaz.");
        }

        var p = cfg.Processing;
        CheckRange(e, "processing.preampDb", p.PreampDb, -24, 12);
        CheckEq(e, "processing.eq", p.Eq);
        CheckRange(e, "processing.bassBoostDb", p.BassBoostDb, 0, 12);
        CheckRange(e, "processing.clarityDb", p.ClarityDb, 0, 12);
        CheckRange(e, "processing.dynamicBoost", p.DynamicBoost, 0, 1);
        CheckRange(e, "processing.ambience", p.Ambience, 0, 1);

        var u = cfg.UpmixOptions;
        var um = u.Mode?.Trim().ToLowerInvariant();
        if (um != UpmixOptions.Game && um != UpmixOptions.Film)
            e.Add($"upmixOptions.mode 'game' veya 'film' olmalı (bulunan: '{u.Mode}').");
        CheckRange(e, "upmixOptions.centerDb", u.CenterDb, UpmixOptions.MinDb, UpmixOptions.MaxDb);
        CheckRange(e, "upmixOptions.surroundDb", u.SurroundDb, UpmixOptions.MinDb, UpmixOptions.MaxDb);
        CheckRange(e, "upmixOptions.heightDb", u.HeightDb, UpmixOptions.MinHeightDb, UpmixOptions.MaxHeightDb);
        return e;
    }

    public const double MinHighPassHz = 40, MaxHighPassHz = 250, MaxEqDb = 12;

    /// <summary>Upper bound for delays / latencies (ms) and the speaker gain range (dB).</summary>
    public const double MaxMs = 1000, MinGainDb = -60, MaxGainDb = 24;

    private static void CheckRange(List<string> e, string field, double v, double min, double max)
    {
        if (!(v >= min && v <= max)) e.Add($"{field} {min}..{max} aralığında olmalı (bulunan: {v}).");
    }

    private static void CheckEq(List<string> e, string field, double[] eq)
    {
        if (eq.Length != ProcessingConfig.Bands) { e.Add($"{field}: {ProcessingConfig.Bands} bant olmalı (bulunan: {eq.Length})."); return; }
        for (int b = 0; b < eq.Length; b++)
            if (!(Math.Abs(eq[b]) <= MaxEqDb)) e.Add($"{field}[{b}] -{MaxEqDb}..+{MaxEqDb} dB aralığında olmalı (bulunan: {eq[b]}).");
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
