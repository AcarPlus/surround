using System.Text.Json;
using Surround.Engine.Audio;
using Surround.Engine.Config;

namespace Surround.Desktop.Bridge;

/// <summary>Volume of the loopback source as the page shows it; level 0..1 is the Windows slider position.</summary>
public sealed record VolumeDto(bool Available, double Level, bool Muted, double Db);

/// <summary>
/// Master volume (docs/api.md, "Ses düzeyi"): the Windows volume of the loopback source, which the engine follows. The
/// page's slider writes that same Windows volume, so the volume keys, the taskbar slider and the page stay in step.
/// </summary>
public sealed partial class SurroundBackend
{
    private SourceVolume? _volume;
    private readonly object _volumeLock = new();

    /// <summary>The source's Windows volume or mute changed (keys, taskbar, page), on a worker thread.</summary>
    public event Action<VolumeDto>? VolumeChanged;

    private async Task<object?> VolumeAsync(string method, JsonElement args)
    {
        switch (method)
        {
            case "getVolume":
                return await Task.Run(() => ToDto(Volume()?.State));
            case "setVolume":
            {
                double level = Arg(args, 0).GetDouble();
                if (!double.IsFinite(level)) throw new BridgeException("Geçersiz ses düzeyi.");
                return await Task.Run(() =>
                {
                    var v = Volume() ?? throw new BridgeException("Ses düzeyi yalnızca loopback kaynağında ayarlanabilir.");
                    v.SetLevel(level);
                    if (level > 0 && v.State.Muted) v.SetMuted(false);
                    return ToDto(v.State);
                });
            }
            case "setMute":
            {
                bool muted = Arg(args, 0).GetBoolean();
                return await Task.Run(() =>
                {
                    var v = Volume() ?? throw new BridgeException("Ses düzeyi yalnızca loopback kaynağında ayarlanabilir.");
                    v.SetMuted(muted);
                    return ToDto(v.State);
                });
            }
            default: throw new BridgeException($"Bilinmeyen yöntem: {method}");
        }
    }

    private static VolumeDto ToDto(VolumeState? s) =>
        s is { Available: true } v ? new VolumeDto(true, v.Level, v.Muted, v.Db) : new VolumeDto(false, 1, false, 0);

    /// <summary>The watcher for the configured loopback source (re-opened when the source changes); null without one. MTA only.</summary>
    private SourceVolume? Volume()
    {
        var cfg = _store.Load();
        string id = string.Equals(cfg.Source.Mode?.Trim(), "loopback", StringComparison.OrdinalIgnoreCase) ? cfg.Source.DeviceId?.Trim() ?? "" : "";
        lock (_volumeLock)
        {
            if (Volatile.Read(ref _disposed) != 0) return null;
            if (_volume != null && SurroundConfig.SameId(_volume.DeviceId, id)) return _volume;
            _volume?.Dispose();
            _volume = null;
            if (id.Length == 0) return null;
            _volume = SourceVolume.TryOpen(id, AppLog.Info);
            if (_volume != null) _volume.Changed += s => VolumeChanged?.Invoke(ToDto(s));
            return _volume;
        }
    }

    /// <summary>A saved config may name another source: follow it and tell the page.</summary>
    private void OnConfigSavedForVolume(SurroundConfig cfg)
    {
        string id = string.Equals(cfg.Source.Mode?.Trim(), "loopback", StringComparison.OrdinalIgnoreCase) ? cfg.Source.DeviceId?.Trim() ?? "" : "";
        lock (_volumeLock)
        {
            if (_volume is null || SurroundConfig.SameId(_volume.DeviceId, id)) return;
        }
        _ = Task.Run(() =>
        {
            try { VolumeChanged?.Invoke(ToDto(Volume()?.State)); }
            catch (Exception ex) { AppLog.Info($"Ses düzeyi: {ex.Message}"); }
        });
    }

    private void DisposeVolume()
    {
        lock (_volumeLock)
        {
            _volume?.Dispose();
            _volume = null;
        }
    }
}
