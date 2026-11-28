using System.Collections.Concurrent;
using System.Text.Json.Serialization;
using Surround.Engine;
using Surround.Engine.Audio;
using Surround.Engine.Config;

namespace Surround.Desktop.Bridge;

/// <summary>
/// The <c>engineState</c> event. <paramref name="State"/>: "running" | "waiting" | "stopped"; <paramref name="Missing"/>:
/// names of the required devices that are gone (waiting only).
/// </summary>
public sealed record EngineStateDto(string State, IReadOnlyList<string> Missing,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Message = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<LiveSpeakerDto>? Live = null)
{
    public const string RunningName = "running", WaitingName = "waiting", StoppedName = "stopped";
    public static readonly EngineStateDto Stopped = new(StoppedName, Array.Empty<string>());

    public bool SameAs(EngineStateDto o) => State == o.State && Message == o.Message && Missing.SequenceEqual(o.Missing)
        && (Live ?? Array.Empty<LiveSpeakerDto>()).SequenceEqual(o.Live ?? Array.Empty<LiveSpeakerDto>());
}

/// <summary>
/// Running without absent devices: what a remaining speaker really plays now (<see cref="DeviceRecovery.WithoutMissing"/>
/// re-aligned it), as opposed to its saved values. <paramref name="Id"/> is the page's speaker id.
/// </summary>
public sealed record LiveSpeakerDto(string Id, double DelayMs, double GainDb);

/// <summary>
/// Automatic recovery when devices change while the engine runs (see docs/api.md, "Cihaz değişince"). Windows endpoint
/// notifications and stream failures only record what happened and wake <see cref="RecoveryLoopAsync"/>; the loop takes
/// <c>_gate</c> (so it never races start/stop/saveConfig/calibration), probes the devices and lets
/// <see cref="DeviceRecovery"/> decide. The engine itself is only ever touched through <see cref="EngineHost"/>, i.e. on
/// its worker thread. While waiting, the user's previous default output is restored (so sound is not lost into an unread cable) and engaged again when the engine restarts.
/// </summary>
public sealed partial class SurroundBackend
{
    private const int CoalesceMs = 150;

    private readonly DeviceRecovery _recovery = new();
    private readonly SemaphoreSlim _recoverySignal = new(0, int.MaxValue);
    private readonly CancellationTokenSource _recoveryCts = new();
    private readonly ConcurrentDictionary<string, byte> _changedDevices = new(StringComparer.OrdinalIgnoreCase);
    private DeviceWatcher? _watcher;
    private int _streamFailed;
    private long _nextCheckAt; // Environment.TickCount64 ms; 0 = only on events
    private volatile bool _watching;
    private EngineStateDto _state = EngineStateDto.Stopped;
    /// <summary>The engine runs "without the missing devices" (a reduced copy of the saved config).</summary>
    private volatile bool _degraded;

    /// <summary>Raised on every running / waiting / stopped transition (and when the missing list changes), on a worker thread.</summary>
    public event Action<EngineStateDto>? StateChanged;

    /// <summary>Devices the engine was started without came back and were taken in (names; the page shows a toast).</summary>
    public event Action<IReadOnlyList<string>>? DeviceRejoined;

    public EngineStateDto EngineState => Volatile.Read(ref _state);

    private static long Now => Environment.TickCount64;

    private void StartRecovery()
    {
        _host.StreamFailed += OnStreamFailed;
        _ = Task.Run(() => RecoveryLoopAsync(_recoveryCts.Token));
    }

    private void StopRecovery()
    {
        _recoveryCts.Cancel();
        _host.StreamFailed -= OnStreamFailed;
        var w = Interlocked.Exchange(ref _watcher, null);
        if (w is null) return;
        w.Changed -= OnDeviceChanged;
        w.Dispose();
    }

    // Notification / audio threads: record and wake the loop, nothing else.
    private void OnDeviceChanged(string deviceId)
    {
        if (!_watching) return;
        _changedDevices[deviceId] = 0;
        _recoverySignal.Release();
    }

    private void OnStreamFailed()
    {
        if (!_watching) return;
        Interlocked.Exchange(ref _streamFailed, 1);
        _recoverySignal.Release();
    }

    private void SignalRecovery() => _recoverySignal.Release();

    private async Task RecoveryLoopAsync(CancellationToken ct)
    {
        // Registered from a thread-pool (MTA) thread; callbacks arrive on Windows' own notification thread.
        try
        {
            var w = new DeviceWatcher();
            w.Changed += OnDeviceChanged;
            if (ct.IsCancellationRequested || Interlocked.CompareExchange(ref _watcher, w, null) != null) { w.Dispose(); return; }
        }
        catch (Exception ex)
        {
            // Without notifications, stream failures still trigger recovery and waiting still polls.
            System.Diagnostics.Debug.WriteLine($"Cihaz değişiklikleri izlenemiyor: {ex.Message}");
        }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                long at = Interlocked.Read(ref _nextCheckAt);
                int delay = at == 0 ? Timeout.Infinite : (int)Math.Clamp(at - Now, 0, int.MaxValue);
                // A device change arrives as a burst (state, format, stream errors): gather it before looking.
                if (await _recoverySignal.WaitAsync(delay, ct)) await Task.Delay(CoalesceMs, ct);
                while (_recoverySignal.Wait(0)) { }
                await _gate.WaitAsync(ct);
            }
            catch (OperationCanceledException) { break; }

            try
            {
                var changed = new List<string>();
                foreach (var id in _changedDevices.Keys)
                    if (_changedDevices.TryRemove(id, out _)) changed.Add(id);
                bool failed = Interlocked.Exchange(ref _streamFailed, 0) != 0;
                await RecoverAsync(changed, failed);
            }
            catch (Exception ex) { _host.ReportError($"Cihaz değişikliği işlenemedi: {ex.Message}"); }
            finally { _gate.Release(); }
        }
    }

    /// <summary>Under <c>_gate</c>.</summary>
    private async Task RecoverAsync(IReadOnlyCollection<string> changed, bool streamFailed)
    {
        var state = _recovery.State;
        if (state == RecoveryState.Stopped) return;

        // A missing device may be back under a new endpoint id (same name): take it in under that id.
        if ((state == RecoveryState.Waiting || _recovery.RejoinIds.Count > 0) && await TryRebindAsync() is { Count: > 0 } rebound
            && state == RecoveryState.Running)
        {
            var now = _store.Load();
            _recovery.WaitForDevices(await ProbeAsync(DeviceRecovery.RequiredIds(now)), Now);
            await RejoinAsync(rebound);
            PublishState();
            return;
        }

        // Running: watch what the engine opened. Waiting: what a start would open now (the user may edit meanwhile).
        SurroundConfig? cfg = null;
        IReadOnlyList<string> ids;
        if (state == RecoveryState.Running) ids = _recovery.Watched.Concat(_recovery.RejoinIds).ToList();
        else
        {
            cfg = _store.Load();
            _recovery.SeedNames(cfg);
            ids = DeviceRecovery.RequiredIds(cfg);
        }
        bool deviceEvent = changed.Any(c => ids.Any(i => SurroundConfig.SameId(i, c)));
        if (deviceEvent || streamFailed)
            AppLog.Info("Cihaz değişikliği: " + string.Join(", ", changed.Where(c => ids.Any(i => SurroundConfig.SameId(i, c)))
                .Select(c => DeviceEnumeration.Probe(c) is { } p ? $"{p.Name ?? DeviceRecovery.UnknownDeviceName} ({(p.Present ? "var" : "yok")})" : c)) + (streamFailed ? " [akış hatası]" : ""));
        // Someone else's device; but with devices left out at start, the poll timer comes here to look for their return.
        if (state == RecoveryState.Running && !deviceEvent && !streamFailed && _recovery.RejoinIds.Count == 0) return;

        var probes = await ProbeAsync(ids);
        switch (_recovery.Evaluate(probes, streamFailed, deviceEvent, Now))
        {
            case RecoveryAction.Stop:
                // A speaker's device went away (e.g. the Bluetooth speaker was switched off): keep playing on the others
                // right away, no waiting and no question; it joins again when it comes back.
                if (await TryStartWithoutMissingAsync()) break;
                await _host.StopAsync();
                _runningFingerprint = null;
                RunningChanged?.Invoke(false); // the page's status/meters go "off"
                // Waiting must not mean silence: nothing reads the virtual cable now, so the user's own default output
                // comes back (Restore leaves roles alone that the user or Windows already moved). A successful
                // restart re-engages the cable via SyncDefaultDeviceAsync in TryRestartAsync.
                await Task.Run(_guard.Restore);
                break;
            case RecoveryAction.Restart:
                await TryRestartAsync(cfg ?? _store.Load());
                break;
            case RecoveryAction.Rejoin:
                await RejoinAsync();
                break;
            case RecoveryAction.None when _recovery.State == RecoveryState.Waiting && _recovery.Missing.Count > 0:
                // Waiting for a device while the others could play (it vanished in a way the running engine did not
                // notice at once, or the source was back first): play on what is there instead of waiting.
                if (!_host.IsRunning) await TryStartWithoutMissingAsync();
                break;
        }
        PublishState();
    }

    /// <summary>
    /// Under <c>_gate</c>: some output devices of the saved config are absent but the rest can play: (re)start without
    /// them now. They are watched and taken in again when they come back (<see cref="RecoveryAction.Rejoin"/>). False
    /// (nothing changed, except a failed attempt's message) when nothing is absent, the source itself is absent, nothing
    /// would play or the start fails.
    /// </summary>
    private async Task<bool> TryStartWithoutMissingAsync()
    {
        var cfg = _store.Load();
        _recovery.SeedNames(cfg);
        var probes = await ProbeAsync(DeviceRecovery.RequiredIds(cfg));
        var absent = probes.Where(p => !p.Present).ToList();
        if (absent.Count == 0) return false;
        var reduced = DeviceRecovery.WithoutMissing(cfg, probes, out var dropped);
        if (reduced is null) return false;
        if (!await TryRestartAsync(reduced, absent)) return false;
        AppLog.Info($"Eksik cihaz olmadan devam ediliyor; sessiz hoparlörler: {string.Join(", ", dropped)}; kalanlar: {DeviceRecovery.Describe(reduced)}");
        return true;
    }

    /// <summary>
    /// Devices the engine was started without are back: restart with the saved config (minus whatever is still absent) and
    /// tell the page. The engine is stopped first; if the restart fails the normal waiting recovery takes over.
    /// </summary>
    private async Task RejoinAsync(IReadOnlyList<string>? rejoined = null)
    {
        var names = rejoined ?? _recovery.Rejoined;
        var cfg = _store.Load();
        var probes = await ProbeAsync(DeviceRecovery.RequiredIds(cfg));
        var target = probes.All(p => p.Present) ? cfg : DeviceRecovery.WithoutMissing(cfg, probes, out _);
        await _host.StopAsync();
        RunningChanged?.Invoke(false);
        if (target is null) { _recovery.RestartFailed("Cihaz döndü ama motor yeniden başlatılamadı.", Now); return; }
        bool ok = await TryRestartAsync(target, probes.Where(p => !p.Present).ToList());
        if (ok) { AppLog.Info($"Cihaz geri geldi, eklendi: {string.Join(", ", names)}"); DeviceRejoined?.Invoke(names); }
        else await Task.Run(_guard.Restore);
    }

    /// <summary>Old endpoint id → the id the same device came back under (this run); page saves are mapped too.</summary>
    private readonly ConcurrentDictionary<string, string> _rebound = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Saved devices were found again under new endpoint ids (old → new); the page swaps the ids it holds.</summary>
    public event Action<IReadOnlyDictionary<string, string>>? DevicesRebound;

    /// <summary>
    /// Under <c>_gate</c>: absent output devices of the saved config that are present under a new endpoint id with the same
    /// name (<see cref="DeviceRecovery.Rebind"/>) are switched to that id and the config is saved. Returns the names of the
    /// devices taken in (empty: nothing changed).
    /// </summary>
    private async Task<IReadOnlyList<string>> TryRebindAsync()
    {
        var cfg = _store.Load();
        var probes = await ProbeAsync(DeviceRecovery.RequiredIds(cfg));
        if (probes.All(p => p.Present)) return Array.Empty<string>();
        var active = await Task.Run(DeviceEnumeration.ActiveRenderEndpoints);
        var map = DeviceRecovery.Rebind(cfg, probes, active);
        if (!DeviceRecovery.ApplyRebind(cfg, map)) return Array.Empty<string>();
        foreach (var (oldId, newId) in map)
        {
            _rebound.TryRemove(newId.Trim(), out _); // a swap back must not loop
            foreach (var k in _rebound.Where(e => SurroundConfig.SameId(e.Value, oldId)).Select(e => e.Key).ToList()) _rebound[k] = newId;
            _rebound[oldId.Trim()] = newId;
        }
        await Task.Run(() => FillDeviceNames(cfg));
        _store.Save(cfg);
        ConfigSaved?.Invoke(cfg);
        var names = map.Values.Select(id => active.FirstOrDefault(d => SurroundConfig.SameId(d.Id, id))?.Name ?? id).Distinct().ToList();
        AppLog.Info($"Cihaz yeni kimlikle bulundu, bağlandı: {string.Join(", ", names)}");
        DevicesRebound?.Invoke(new Dictionary<string, string>(map, StringComparer.OrdinalIgnoreCase));
        return names;
    }

    /// <summary>A page save may still carry an id that was rebound (the page's memory, undo): use the new one.</summary>
    private void ApplyRebound(SurroundConfig cfg)
    {
        if (!_rebound.IsEmpty) DeviceRecovery.ApplyRebind(cfg, _rebound);
    }

    private async Task<bool> TryRestartAsync(SurroundConfig cfg, IReadOnlyList<DeviceProbe>? absent = null)
    {
        var errors = await Task.Run(() => Validate(cfg));
        if (errors.Count > 0) { _recovery.RestartFailed(errors[0], Now); return false; }
        try { await _host.StartAsync(cfg); }
        catch (ConfigException ex) { _recovery.RestartFailed(ex.Errors.FirstOrDefault() ?? ex.Message, Now); return false; }
        catch (Exception ex) { _recovery.RestartFailed($"Motor başlatılamadı: {ex.Message}", Now); return false; }

        _degraded = absent is { Count: > 0 };
        _runningFingerprint = cfg.EngineFingerprint();
        await MarkStartedAsync(cfg, absent);
        RunningChanged?.Invoke(true);
        await SyncDefaultDeviceAsync(cfg); // the source may have come back after Windows moved the default away
        return true;
    }

    /// <summary>Under <c>_gate</c>, after the engine started with <paramref name="cfg"/>: watch its devices.</summary>
    private async Task MarkStartedAsync(SurroundConfig cfg, IReadOnlyList<DeviceProbe>? absent = null)
    {
        _recovery.SeedNames(cfg);
        var probes = await ProbeAsync(DeviceRecovery.RequiredIds(cfg));
        _recovery.Started(probes, Now, absent);
        NoteLive(cfg);
        PublishState();
    }

    /// <summary>Under <c>_gate</c>: the engine is (and stays) stopped.</summary>
    private void MarkStopped()
    {
        _degraded = false;
        _live = null;
        _recovery.Stopped();
        PublishState();
    }

    private static Task<List<DeviceProbe>> ProbeAsync(IReadOnlyList<string> ids) =>
        Task.Run(() => ids.Select(DeviceEnumeration.Probe).ToList());

    private IReadOnlyList<LiveSpeakerDto>? _live;

    /// <summary>
    /// Remembers what the engine now plays (<paramref name="running"/>: the config it was started or updated with) so the
    /// page can show the re-aligned delay/gain of each remaining speaker instead of the saved one. Only while degraded.
    /// </summary>
    private void NoteLive(SurroundConfig running)
    {
        _live = !_degraded ? null : running.Speakers
            .Where(s => s.Extra is { } x && x.TryGetValue("id", out var id) && id.ValueKind == System.Text.Json.JsonValueKind.String)
            .Select(s => new LiveSpeakerDto(s.Extra!["id"].GetString()!, s.DelayMs, s.GainDb))
            .ToList();
    }

    private void PublishState()
    {
        var next = _recovery.State switch
        {
            RecoveryState.Running => new EngineStateDto(EngineStateDto.RunningName, Array.Empty<string>(), Live: _degraded ? _live : null),
            RecoveryState.Waiting => new EngineStateDto(EngineStateDto.WaitingName, _recovery.Missing.ToArray(), _recovery.Message),
            _ => EngineStateDto.Stopped,
        };
        Interlocked.Exchange(ref _nextCheckAt, _recovery.NextCheckAt ?? 0);
        _watching = _recovery.State != RecoveryState.Stopped;
        if (next.SameAs(Volatile.Read(ref _state))) return;
        Volatile.Write(ref _state, next);
        AppLog.Info($"Durum: {next.State}" + (next.Missing.Count > 0 ? $" (eksik: {string.Join(", ", next.Missing)})" : "") + (next.Message is null ? "" : $" - {next.Message}"));
        StateChanged?.Invoke(next);
    }
}
