using Surround.Engine.Config;

namespace Surround.Engine.Audio;

/// <summary>
/// A device as it is right now (<see cref="DeviceEnumeration.Probe"/>, or faked in tests). <paramref name="Name"/> is null
/// when Windows no longer knows the device; <paramref name="Channels"/>/<paramref name="SampleRate"/> are 0 when the mix
/// format could not be read.
/// </summary>
public sealed record DeviceProbe(string Id, string? Name, bool Present, int Channels = 0, int SampleRate = 0);

public enum RecoveryState { Stopped, Running, Waiting }

public enum RecoveryAction { None, Stop, Restart, Rejoin }

/// <summary>What a user start should do (<see cref="DeviceRecovery.PlanStart"/>).</summary>
public enum StartDecision { Start, Wait, Fail }

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
    private List<string> _rejoin = new();
    private long? _rejoinSince;
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
    /// <summary>
    /// Devices a "start without the missing devices" left out: they are watched so the engine can take them in when they
    /// come back (<see cref="RecoveryAction.Rejoin"/>). Empty for a normal start.
    /// </summary>
    public IReadOnlyList<string> RejoinIds => _rejoin;
    /// <summary>Names of the devices that triggered the last <see cref="RecoveryAction.Rejoin"/>.</summary>
    public IReadOnlyList<string> Rejoined { get; private set; } = Array.Empty<string>();
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

    /// <summary>
    /// Decides a user start: a config error is a genuine failure; otherwise a required device that is not there yet means
    /// wait for it (as if it had disappeared while running); otherwise start. Device-level problems of present devices
    /// (wrong kind, too few channels) are not this method's business: the caller validates those when it gets <see cref="StartDecision.Start"/>.
    /// </summary>
    public static StartDecision PlanStart(IReadOnlyList<string> configErrors, IReadOnlyList<DeviceProbe> required) =>
        configErrors.Count > 0 ? StartDecision.Fail
        : required.Any(p => !p.Present) ? StartDecision.Wait
        : StartDecision.Start;

    /// <summary>
    /// "Start without the missing devices": a copy of <paramref name="cfg"/> where speakers (and outputs) on absent devices are
    /// left out (i.e. muted), so the rest can play. Null when that is impossible: the source itself is absent, or nothing
    /// would play. <paramref name="dropped"/> receives the names of the left-out speakers. The saved config is untouched.
    /// </summary>
    public static SurroundConfig? WithoutMissing(SurroundConfig cfg, IReadOnlyList<DeviceProbe> probes, out List<string> dropped)
    {
        dropped = new();
        bool Gone(string? id) => probes.Any(p => !p.Present && SurroundConfig.SameId(p.Id, id));
        if (Gone(cfg.Source.DeviceId)) return null;
        var copy = SurroundConfig.Parse(cfg.ToJson());
        dropped = copy.Speakers.Where(s => Gone(s.OutputDeviceId)).Select(s => s.Name).ToList();
        var before = ChannelPower(copy.Speakers);
        copy.Speakers.RemoveAll(s => Gone(s.OutputDeviceId));
        copy.Outputs.RemoveAll(o => Gone(o.DeviceId));
        RestoreChannelPower(copy.Speakers, before);
        return copy.ForRouting().Speakers.Any(s => !s.Mute) ? copy : null;
    }

    /// <summary>Largest boost a channel gets back when a speaker that shared it is missing (+6 dB).</summary>
    internal const double MaxRestoreGain = 2.0;

    /// <summary>Per logical channel (LFE excluded), the summed power of its weights over the unmuted speakers.</summary>
    private static double[] ChannelPower(IEnumerable<SpeakerConfig> speakers)
    {
        var p = new double[Channels.Count];
        foreach (var s in speakers.Where(s => !s.Mute))
            foreach (var (k, v) in s.Source)
            {
                int c = Channels.IndexOf(k);
                if (c >= 0 && c != Channels.LFE) p[c] += v * v;
            }
        return p;
    }

    /// <summary>
    /// A missing speaker's share of each channel goes to the speakers that still play that channel: their weights are
    /// scaled so the channel's power is what it was with every speaker. Without this "distribute by position" lost the
    /// absent speaker's part of the fronts (e.g. center 0.61 of FL: the remaining left speaker played FL at 0.79, -2 dB)
    /// and the whole system played quieter than the source. Channels no remaining speaker plays are left to the fold.
    /// </summary>
    private static void RestoreChannelPower(List<SpeakerConfig> remaining, double[] before)
    {
        var after = ChannelPower(remaining);
        for (int c = 0; c < Channels.Count; c++)
        {
            if (after[c] <= 1e-12 || after[c] >= before[c] - 1e-9) continue;
            double g = Math.Min(MaxRestoreGain, Math.Sqrt(before[c] / after[c]));
            foreach (var s in remaining.Where(s => !s.Mute))
                foreach (var key in s.Source.Keys.Where(k => Channels.IndexOf(k) == c).ToList())
                    s.Source[key] = Math.Round(s.Source[key] * g, 4);
        }
    }

    /// <summary>
    /// A user start found required devices missing: wait for them instead of failing. From now on <see cref="Evaluate"/>
    /// restarts once they have all been present for the debounce time; <see cref="Stopped"/> cancels.
    /// </summary>
    public void WaitForDevices(IReadOnlyList<DeviceProbe> required, long nowMs)
    {
        foreach (var p in required) Remember(p);
        State = RecoveryState.Waiting;
        Missing = required.Where(p => !p.Present).Select(NameOf).ToList();
        Message = null;
        _formats.Clear();
        _watched = new();
        _autoRestarted = false;
        _retryMs = _debounceMs;
        _allPresentSince = null;
        NextCheckAt = nowMs + PollMs;
    }

    /// <summary>The engine started (by the user, a config restart or <see cref="RecoveryAction.Restart"/>) with these devices.</summary>
    /// <param name="absent">
    /// Devices the engine was deliberately started without (<see cref="WithoutMissing"/>): watched for their return.
    /// </param>
    public void Started(IReadOnlyList<DeviceProbe> devices, long nowMs, IReadOnlyList<DeviceProbe>? absent = null)
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
        _rejoin = (absent ?? Array.Empty<DeviceProbe>()).Where(a => !a.Present).Select(a => a.Id).ToList();
        foreach (var a in absent ?? Array.Empty<DeviceProbe>()) Remember(a);
        _rejoinSince = null;
        NextCheckAt = _rejoin.Count > 0 ? nowMs + PollMs : null;
    }

    /// <summary>The user stopped the engine (or it could not be kept running): stop watching.</summary>
    public void Stopped()
    {
        State = RecoveryState.Stopped;
        Missing = Array.Empty<string>();
        Message = null;
        _formats.Clear();
        _watched = new();
        _rejoin = new();
        _rejoinSince = null;
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
        // A device the engine was started without is expected to be absent; it only matters once it is back.
        bool Expected(DeviceProbe p) => _rejoin.Any(r => SurroundConfig.SameId(r, p.Id));
        var missing = required.Where(p => !p.Present && !Expected(p)).Select(NameOf).ToList();

        switch (State)
        {
            case RecoveryState.Running:
            {
                bool formatChanged = required.Any(p => p.Present && p.Channels > 0
                    && _formats.TryGetValue(p.Id, out var f) && (f.Channels != p.Channels || f.Rate != p.SampleRate));
                if (!streamFailed && missing.Count == 0 && !formatChanged)
                {
                    var back = required.Where(p => p.Present && Expected(p)).ToList();
                    if (back.Count == 0) { _rejoinSince = null; if (_rejoin.Count > 0) NextCheckAt = nowMs + PollMs; return RecoveryAction.None; }
                    // Back: take it in after the debounce (a device event restarts the debounce), as a restart.
                    if (_rejoinSince is null || deviceEvent) _rejoinSince = nowMs;
                    if (nowMs - _rejoinSince.Value < _debounceMs) { NextCheckAt = _rejoinSince.Value + _debounceMs; return RecoveryAction.None; }
                    Rejoined = back.Select(NameOf).ToList();
                    State = RecoveryState.Waiting;
                    Missing = Array.Empty<string>();
                    Message = null;
                    _retryMs = _debounceMs;
                    _allPresentSince = nowMs;
                    _rejoin = new();
                    _rejoinSince = null;
                    NextCheckAt = null; // the host reports back with Started or RestartFailed
                    return RecoveryAction.Rejoin;
                }
                _rejoin = new();
                _rejoinSince = null;

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

    /// <summary>Shown when neither Windows nor the saved config knows a missing device's name (never the raw endpoint id).</summary>
    public const string UnknownDeviceName = "bilinmeyen cihaz";

    /// <summary>Names saved in the config (<c>deviceName</c>) for devices Windows no longer reports.</summary>
    public void SeedNames(SurroundConfig cfg)
    {
        void Seed(string? id, string? name)
        {
            if (!string.IsNullOrWhiteSpace(id) && !string.IsNullOrWhiteSpace(name) && !_names.ContainsKey(id.Trim()))
                _names[id.Trim()] = name!;
        }
        Seed(cfg.Source.DeviceId, cfg.Source.DeviceName);
        foreach (var o in cfg.Outputs) Seed(o.DeviceId, o.DeviceName);
    }

    private string NameOf(DeviceProbe p) =>
        !string.IsNullOrWhiteSpace(p.Name) ? p.Name! : _names.TryGetValue(p.Id, out var n) ? n : UnknownDeviceName;
}
