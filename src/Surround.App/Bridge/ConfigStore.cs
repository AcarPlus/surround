using System.Text.Json;
using Surround.Engine.Audio;
using Surround.Engine.Config;

namespace Surround.Desktop.Bridge;

/// <summary>Persists the UI document (engine config + UI-only members) at %AppData%\Surround\config.json.</summary>
/// <summary>The saved config could not be read; it was kept as <see cref="BackupPath"/> and defaults were loaded.</summary>
public sealed record ConfigLoadNotice(string BackupPath, string Reason);

public sealed class ConfigStore
{
    private ConfigLoadNotice? _notice;

    private readonly string _path;
    private readonly object _gate = new();

    public ConfigStore(string? path = null) => _path = path ?? AppPaths.ConfigFile;

    /// <summary>Loads the saved config; first run (or an unreadable file) yields a fresh default which is saved.</summary>
    public SurroundConfig Load()
    {
        lock (_gate)
        {
            SurroundConfig? cfg = null;
            if (File.Exists(_path))
            {
                try { cfg = SurroundConfig.Load(_path); }
                catch (Exception ex) when (ex is JsonException or IOException or NotSupportedException)
                {
                    // Keep the broken file (never overwriting an earlier backup) and tell the UI once.
                    var backup = BackUpUnlocked();
                    if (backup is not null) _notice = new ConfigLoadNotice(backup, ex.Message);
                }
            }
            if (cfg is null)
            {
                cfg = CreateDefault();
                SaveUnlocked(cfg);
            }
            NormalizeForUi(cfg);
            return cfg;
        }
    }

    /// <summary>Returns (once) the notice about an unreadable config file that was replaced by defaults, if any.</summary>
    public ConfigLoadNotice? TakeNotice()
    {
        lock (_gate) { var n = _notice; _notice = null; return n; }
    }

    /// <summary>UI recovery: keeps the current file as a timestamped backup and writes fresh defaults.</summary>
    public void ResetToDefault()
    {
        lock (_gate)
        {
            BackUpUnlocked();
            _notice = null;
            SaveUnlocked(CreateDefault());
        }
    }

    /// <summary>Moves the config file to <c>config.bad-YYYYMMDD-HHmmss.json</c> next to it; null if that failed.</summary>
    private string? BackUpUnlocked()
    {
        try
        {
            if (!File.Exists(_path)) return null;
            string dir = Path.GetDirectoryName(_path)!;
            string stem = Path.GetFileNameWithoutExtension(_path), ext = Path.GetExtension(_path);
            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            string target = Path.Combine(dir, $"{stem}.bad-{stamp}{ext}");
            for (int i = 2; File.Exists(target); i++) target = Path.Combine(dir, $"{stem}.bad-{stamp}-{i}{ext}");
            File.Move(_path, target);
            return target;
        }
        catch { return null; }
    }

    public void Save(SurroundConfig cfg)
    {
        lock (_gate) SaveUnlocked(cfg);
    }

    private void SaveUnlocked(SurroundConfig cfg)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, cfg.ToJson());
        File.Move(tmp, _path, overwrite: true);
    }

    /// <summary>
    /// First run: source = default render device (loopback), no outputs, no speakers. A speaker pair on the
    /// default device would trip the feedback guard, so the user builds the layout in the UI.
    /// </summary>
    public static SurroundConfig CreateDefault()
    {
        string sourceId = "";
        try { sourceId = DeviceEnumeration.List().FirstOrDefault(d => d.Flow == DeviceFlow.Render && d.IsDefault)?.Id ?? ""; }
        catch { /* no audio service: leave empty, the UI shows the source screen */ }

        var cfg = new SurroundConfig
        {
            Source = new SourceConfig { DeviceId = sourceId, Mode = "loopback" },
            Upmix = true,
        };
        cfg.Extra = new Dictionary<string, JsonElement> { ["room"] = DefaultRoom() };
        return cfg;
    }

    private static JsonElement DefaultRoom() =>
        JsonSerializer.SerializeToElement(new { widthM = 5.0, depthM = 4.5, listener = new { x = 2.5, y = 2.3 } });

    /// <summary>Ensures members the UI requires exist (configs written by the CLI lack room, speaker id and position).</summary>
    public static void NormalizeForUi(SurroundConfig cfg)
    {
        cfg.Extra ??= new Dictionary<string, JsonElement>();
        if (!cfg.Extra.TryGetValue("room", out var room) || room.ValueKind != JsonValueKind.Object)
            cfg.Extra["room"] = room = DefaultRoom();

        double w = Num(room, "widthM", 5), d = Num(room, "depthM", 4.5);
        double lx = w / 2, ly = d / 2;
        if (room.TryGetProperty("listener", out var l) && l.ValueKind == JsonValueKind.Object)
        { lx = Num(l, "x", lx); ly = Num(l, "y", ly); }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < cfg.Speakers.Count; i++)
        {
            var s = cfg.Speakers[i];
            s.Extra ??= new Dictionary<string, JsonElement>();
            string? id = s.Extra.TryGetValue("id", out var idEl) && idEl.ValueKind == JsonValueKind.String ? idEl.GetString() : null;
            if (string.IsNullOrWhiteSpace(id) || !ids.Add(id))
            {
                int n = i + 1;
                while (!ids.Add($"spk-{n}")) n++;
                s.Extra["id"] = JsonSerializer.SerializeToElement($"spk-{n}");
            }
            if (!s.Extra.ContainsKey("x") || !s.Extra.ContainsKey("y"))
            {
                double a = 2 * Math.PI * i / Math.Max(1, cfg.Speakers.Count) - Math.PI / 2;
                double r = Math.Min(w, d) * 0.35;
                double x = Math.Clamp(lx + r * Math.Cos(a), 0, w), y = Math.Clamp(ly + r * Math.Sin(a), 0, d);
                s.Extra["x"] = JsonSerializer.SerializeToElement(Math.Round(x, 2));
                s.Extra["y"] = JsonSerializer.SerializeToElement(Math.Round(y, 2));
            }
        }
    }

    private static double Num(JsonElement obj, string name, double fallback) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? v.GetDouble() : fallback;
}
