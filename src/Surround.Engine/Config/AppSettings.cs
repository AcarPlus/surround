using System.Text.Json;
using System.Text.Json.Serialization;

namespace Surround.Engine.Config;

/// <summary>
/// App-level (not audio) settings, %AppData%\Surround\app.json. The Restore* members are internal bookkeeping for
/// <see cref="Audio.DefaultDeviceGuard"/> and are never exposed to the UI.
/// </summary>
public sealed record AppSettings
{
    /// <summary>Make the loopback source the Windows default output while the engine runs, restore it afterwards.</summary>
    public bool SwitchDefaultDevice { get; init; } = true;
    public bool StartWithWindows { get; init; }
    public bool StartEngineOnLaunch { get; init; }
    /// <summary>Closing the window hides it to the tray instead of exiting.</summary>
    public bool MinimizeToTray { get; init; } = true;

    /// <summary>Previous default (console/multimedia) while the source is the default; null when nothing to restore.</summary>
    public string? RestoreDeviceId { get; init; }
    public string? RestoreCommunicationsId { get; init; }
    /// <summary>The source we made the default; roles that no longer point at it are left alone on restore.</summary>
    public string? RestoreSourceId { get; init; }
    /// <summary>The "running in the background" balloon was shown once.</summary>
    public bool TrayHintShown { get; init; }

    /// <summary>Copies the four user-editable members of <paramref name="user"/> onto this instance, keeping the bookkeeping.</summary>
    public AppSettings WithUserSettings(AppSettings user) => this with
    {
        SwitchDefaultDevice = user.SwitchDefaultDevice,
        StartWithWindows = user.StartWithWindows,
        StartEngineOnLaunch = user.StartEngineOnLaunch,
        MinimizeToTray = user.MinimizeToTray,
    };
}

/// <summary>Reads and writes <see cref="AppSettings"/>. Tolerant: a missing or broken file yields defaults.</summary>
public sealed class AppSettingsStore
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    private readonly string _path;
    private readonly object _gate = new();

    public AppSettingsStore(string path) => _path = path;

    public AppSettings Load()
    {
        lock (_gate) return LoadUnlocked();
    }

    public void Save(AppSettings settings)
    {
        lock (_gate) SaveUnlocked(settings);
    }

    /// <summary>Atomic read-modify-write; returns the stored result.</summary>
    public AppSettings Update(Func<AppSettings, AppSettings> change)
    {
        lock (_gate)
        {
            var next = change(LoadUnlocked());
            SaveUnlocked(next);
            return next;
        }
    }

    private AppSettings LoadUnlocked()
    {
        if (!File.Exists(_path)) return new AppSettings();
        try { return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(_path), Options) ?? new AppSettings(); }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            try { File.Move(_path, _path + ".bad", overwrite: true); } catch { }
            return new AppSettings();
        }
    }

    private void SaveUnlocked(AppSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(settings, Options));
        File.Move(tmp, _path, overwrite: true);
    }
}
