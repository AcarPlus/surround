using Surround.Engine.Config;

namespace Surround.Engine.Audio;

/// <summary>
/// Makes the loopback source the Windows default output while the engine runs and puts the user's previous default
/// back afterwards. The previous device is persisted (in <see cref="AppSettings"/>) the moment it is replaced, so a crash
/// or kill can be repaired by <see cref="RestoreIfPending"/> on the next launch. Never throws: failures are logged.
/// </summary>
public sealed class DefaultDeviceGuard
{
    private static readonly DeviceRole[] Roles = { DeviceRole.Console, DeviceRole.Multimedia, DeviceRole.Communications };

    private readonly IDefaultDeviceSwitcher _switcher;
    private readonly AppSettingsStore _store;
    private readonly Action<string>? _log;
    private readonly object _gate = new();

    public DefaultDeviceGuard(IDefaultDeviceSwitcher switcher, AppSettingsStore store, Action<string>? log = null)
    {
        _switcher = switcher;
        _store = store;
        _log = log;
    }

    /// <summary>True while a previous default is remembered, i.e. the source is (or was left as) the default.</summary>
    public bool HasPending => _store.Load().RestoreDeviceId is not null;

    /// <summary>
    /// Makes <paramref name="sourceId"/> the default for all roles. Idempotent: a repeated call (engine restart) keeps the
    /// first remembered device. Returns true if the source is the default afterwards.
    /// </summary>
    public bool Engage(string sourceId)
    {
        try
        {
            lock (_gate)
            {
                if (string.IsNullOrWhiteSpace(sourceId)) return false;
                var cur = _store.Load();
                string? multimedia = _switcher.GetDefaultRender(DeviceRole.Multimedia);

                if (cur.RestoreDeviceId is null)
                {
                    // Remember the user's real default once. If the source already is the default there is nothing to remember.
                    if (multimedia is not null && !SameId(multimedia, sourceId))
                    {
                        string? comm = _switcher.GetDefaultRender(DeviceRole.Communications);
                        _store.Update(s => s with { RestoreDeviceId = multimedia, RestoreCommunicationsId = comm, RestoreSourceId = sourceId });
                    }
                }
                else if (!SameId(cur.RestoreSourceId, sourceId))
                {
                    _store.Update(s => s with { RestoreSourceId = sourceId }); // the source changed on an engine restart
                }

                bool ok = true;
                foreach (var role in Roles)
                {
                    if (SameId(_switcher.GetDefaultRender(role), sourceId)) continue;
                    try { _switcher.SetDefaultRender(sourceId, role); }
                    catch (Exception ex) { ok = false; _log?.Invoke($"Varsayılan çıkış ayarlanamadı ({role}): {ex.Message}"); }
                }
                return ok;
            }
        }
        catch (Exception ex)
        {
            _log?.Invoke($"Varsayılan çıkış ayarlanamadı: {ex.Message}");
            return false;
        }
    }

    /// <summary>Puts the remembered default back (per role, only where the source is still the default) and forgets it.</summary>
    public void Restore()
    {
        try
        {
            lock (_gate)
            {
                var s = _store.Load();
                if (s.RestoreDeviceId is null) return;

                RestoreRole(DeviceRole.Console, s.RestoreDeviceId, s.RestoreSourceId);
                RestoreRole(DeviceRole.Multimedia, s.RestoreDeviceId, s.RestoreSourceId);
                RestoreRole(DeviceRole.Communications, s.RestoreCommunicationsId ?? s.RestoreDeviceId, s.RestoreSourceId);
                _store.Update(x => x with { RestoreDeviceId = null, RestoreCommunicationsId = null, RestoreSourceId = null });
            }
        }
        catch (Exception ex)
        {
            _log?.Invoke($"Varsayılan çıkış geri yüklenemedi: {ex.Message}");
        }
    }

    /// <summary>Launch-time repair after a crash: same as <see cref="Restore"/>, a no-op when nothing is remembered.</summary>
    public void RestoreIfPending() => Restore();

    private void RestoreRole(DeviceRole role, string target, string? engagedSource)
    {
        try
        {
            // Leave the role alone if the user changed it meanwhile (it no longer points at the source we set) or the device is gone.
            string? current = _switcher.GetDefaultRender(role);
            if (engagedSource is not null && !SameId(current, engagedSource)) return;
            if (!_switcher.RenderDeviceExists(target)) { _log?.Invoke("Önceki varsayılan çıkış artık yok; geri yüklenmedi."); return; }
            _switcher.SetDefaultRender(target, role);
        }
        catch (Exception ex) { _log?.Invoke($"Varsayılan çıkış geri yüklenemedi ({role}): {ex.Message}"); }
    }

    private static bool SameId(string? a, string? b) =>
        a is not null && b is not null && string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
}
