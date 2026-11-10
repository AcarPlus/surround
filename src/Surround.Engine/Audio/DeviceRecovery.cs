using Surround.Engine.Config;

namespace Surround.Engine.Audio;

/// <summary>
/// A device as it is right now (<see cref="DeviceEnumeration.Probe"/>, or faked in tests). <paramref name="Name"/> is null
/// when Windows no longer knows the device; <paramref name="Channels"/>/<paramref name="SampleRate"/> are 0 when the mix
/// format could not be read.
/// </summary>
public sealed record DeviceProbe(string Id, string? Name, bool Present, int Channels = 0, int SampleRate = 0);

public enum RecoveryState { Stopped, Running, Waiting }

public enum RecoveryAction { None, Stop, Restart }

/// <summary>
/// Decides what to do when audio devices change under a running engine (pure: no devices, no clock). The host feeds it
/// device probes on every notification, stream failure and timer tick and carries out the returned action:
/// <list type="bullet">
/// <item>Running: a required device missing, its format changed, or a stream failed → <see cref="RecoveryAction.Stop"/>
/// and wait.</item>
/// <item>Waiting: once every required device has been present for the debounce time with no further device event →
/// <see cref="RecoveryAction.Restart"/>. A failed restart (<see cref="RestartFailed"/>), or an auto-restarted engine that
/// fails again within <see cref="StableMs"/>, doubles the wait up to <see cref="MaxRetryMs"/>; a device coming back
/// resets it.</item>
/// </list>
/// Not thread-safe: the host calls it from one place (under its own lock).
/// </summary>
public sealed class DeviceRecovery
{
    public const int DefaultDebounceMs = 1000;
    public const int MaxRetryMs = 30_000;
    /// <summary>An auto-restarted engine that fails again sooner than this backs off instead of retrying at once.</summary>
    public const int StableMs = 10_000;
    /// <summary>While devices are missing they are re-probed this often anyway, in case a notification was missed.</summary>
    public const int PollMs = 3000;

    private readonly int _debounceMs;
    private readonly Dictionary<string, (int Channels, int Rate)> _formats = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _names = new(StringComparer.OrdinalIgnoreCase);
    private List<string> _watched = new();
    private long? _allPresentSince;
    private long _startedAt;
    private bool _autoRestarted;
    private int _retryMs;

    public DeviceRecovery(int debounceMs = DefaultDebounceMs)
    {
        _debounceMs = Math.Max(0, debounceMs);
        _retryMs = _debounceMs;
    }

    public RecoveryState State { get; private set; } = RecoveryState.Stopped;
    /// <summary>Names of the required devices that are missing (waiting only).</summary>
    public IReadOnlyList<string> Missing { get; private set; } = Array.Empty<string>();
    /// <summary>Why the engine is waiting besides missing devices (stream failure, format change, failed restart).</summary>
    public string? Message { get; private set; }
    /// <summary>Device ids the running engine uses (set by <see cref="Started"/>).</summary>
    public IReadOnlyList<string> Watched => _watched;
    /// <summary>Current wait before a restart (debounce, or the backed-off retry delay).</summary>
    public int RetryMs => _retryMs;
    /// <summary>When the host should call <see cref="Evaluate"/> again without an event (null: only on events).</summary>
    public long? NextCheckAt { get; private set; }

    /// <summary>Devices a start of <paramref name="cfg"/> opens: the source and every output that routes a speaker.</summary>
    public static IReadOnlyList<string> RequiredIds(SurroundConfig cfg)
    {
        var routed = cfg.ForRouting();
        var ids = new List<string>();
        void Add(string? id)
        {
            if (string.IsNullOrWhiteSpace(id)) return;
            if (!ids.Any(x => SurroundConfig.SameId(x, id))) ids.Add(id.Trim());
        }
        Add(routed.Source.DeviceId);
        foreach (var o in routed.Outputs) Add(o.DeviceId);
        return ids;
    }

    /// <summary>The engine started (by the user, a config restart or <see cref="RecoveryAction.Restart"/>) with these devices.</summary>
    public void Started(IReadOnlyList<DeviceProbe> devices, long nowMs)
    {
        _autoRestarted = State == RecoveryState.Waiting;
        if (!_autoRestarted) _retryMs = _debounceMs;
        State = RecoveryState.Running;
        _startedAt = nowMs;
        _formats.Clear();
        _watched = devices.Select(d => d.Id).ToList();
        foreach (var d in devices)
        {
            Remember(d);
            if (d.Present && d.Channels > 0) _formats[d.Id] = (d.Channels, d.SampleRate);
        }
        Missing = Array.Empty<string>();
        Message = null;
        _allPresentSince = null;
        NextCheckAt = null;
    }

    /// <summary>The user stopped the engine (or it could not be kept running): stop watching.</summary>
    public void Stopped()
    {
        State = RecoveryState.Stopped;
        Missing = Array.Empty<string>();
        Message = null;
        _formats.Clear();
        _watched = new();
        _allPresentSince = null;
        _autoRestarted = false;
        _retryMs = _debounceMs;
        NextCheckAt = null;
    }

    /// <summary>A <see cref="RecoveryAction.Restart"/> did not work: keep waiting, retry later (backing off).</summary>
    public void RestartFailed(string message, long nowMs)
    {
        if (State != RecoveryState.Waiting) return;
        Message = message;
        _retryMs = Math.Min(Math.Max(_retryMs, 1) * 2, MaxRetryMs);
        _allPresentSince = nowMs;
        NextCheckAt = nowMs + _retryMs;
    }

    /// <param name="required">
    /// Probes of the required devices: while running, those of <see cref="Watched"/>; while waiting, those of the config a
    /// restart would use (<see cref="RequiredIds"/>).
    /// </param>
    /// <param name="streamFailed">A capture or playback stream of the running engine failed.</param>
    /// <param name="deviceEvent">Windows reported a change (state, add/remove, format) of a required device.</param>
    public RecoveryAction Evaluate(IReadOnlyList<DeviceProbe> required, bool streamFailed, bool deviceEvent, long nowMs)
    {
        foreach (var p in required) Remember(p);
        var missing = required.Where(p => !p.Present).Select(NameOf).ToList();

        switch (State)
        {
            case RecoveryState.Running:
            {
                bool formatChanged = required.Any(p => p.Present && p.Channels > 0
                    && _formats.TryGetValue(p.Id, out var f) && (f.Channels != p.Channels || f.Rate != p.SampleRate));
                if (!streamFailed && missing.Count == 0 && !formatChanged) return RecoveryAction.None;

                State = RecoveryState.Waiting;
                Missing = missing;
                Message = missing.Count > 0 ? null
                    : formatChanged ? "Cihaz biçimi değişti; motor yeniden başlatılacak."
                    : "Ses akışı kesildi; motor yeniden başlatılacak.";
                // A device that keeps failing right after an automatic restart must not be hammered once a second.
                _retryMs = _autoRestarted && nowMs - _startedAt < StableMs ? Math.Min(Math.Max(_retryMs, 1) * 2, MaxRetryMs) : _debounceMs;
                _allPresentSince = missing.Count == 0 ? nowMs : null;
                NextCheckAt = missing.Count == 0 ? nowMs + _retryMs : nowMs + PollMs;
                return RecoveryAction.Stop;
            }

            case RecoveryState.Waiting:
            {
                Missing = missing;
                if (missing.Count > 0)
                {
                    // Something is really gone: when it comes back, restart after the plain debounce.
                    _allPresentSince = null;
                    _retryMs = _debounceMs;
                    NextCheckAt = nowMs + PollMs;
                    return RecoveryAction.None;
                }
                if (_allPresentSince is null || deviceEvent) _allPresentSince = nowMs; // (re)start the debounce
                NextCheckAt = _allPresentSince.Value + _retryMs;
                if (nowMs - _allPresentSince.Value >= _retryMs)
                {
                    NextCheckAt = null; // the host reports back with Started or RestartFailed
                    return RecoveryAction.Restart;
                }
                return RecoveryAction.None;
            }

            default:
                return RecoveryAction.None;
        }
    }

    private void Remember(DeviceProbe p)
    {
        if (!string.IsNullOrWhiteSpace(p.Name)) _names[p.Id] = p.Name!;
    }

    private string NameOf(DeviceProbe p) =>
        !string.IsNullOrWhiteSpace(p.Name) ? p.Name! : _names.TryGetValue(p.Id, out var n) ? n : p.Id;
}
