using System.Text.Json;
using Surround.Engine;
using Surround.Engine.Audio;
using Surround.Engine.Calibration;
using Surround.Engine.Config;

namespace Surround.Desktop.Bridge;

public sealed record DeviceDto(string Id, string Name, string Kind, string Flow, int Channels, int SampleRate, bool IsDefault);

/// <summary>The SurroundApi (ui/src/api/client.ts) implemented against the real engine. Transport-agnostic.</summary>
public sealed class SurroundBackend : IDisposable
{
    private const double ToneSeconds = 2;

    private readonly ConfigStore _store;
    private readonly EngineHost _host = new();
    private readonly SemaphoreSlim _gate = new(1, 1);
    private CancellationTokenSource? _toneCts;
    private CancellationTokenSource? _calCts;
    private string? _runningFingerprint;
    private readonly AppSettingsStore _settings;
    private readonly DefaultDeviceGuard _guard;
    private int _disposed;

    public event Action<IReadOnlyList<SinkStatusDto>>? Status { add => _host.StatusChanged += value; remove => _host.StatusChanged -= value; }
    public event Action<float[]>? Levels { add => _host.LevelsChanged += value; remove => _host.LevelsChanged -= value; }
    public event Action<EngineInfoDto>? Info { add => _host.InfoChanged += value; remove => _host.InfoChanged -= value; }
    public event Action<string>? EngineError { add => _host.Error += value; remove => _host.Error -= value; }

    /// <summary>Raised after the engine started or stopped (or failed to restart), on a worker thread.</summary>
    public event Action<bool>? RunningChanged;
    /// <summary>Raised after <c>saveAppSettings</c>, on a worker thread.</summary>
    public event Action<AppSettings>? SettingsChanged;
    /// <summary>Calibration progress (<c>calibrate</c>), on a worker thread.</summary>
    public event Action<CalibrationProgress>? CalibrationProgress;

    public SurroundBackend(ConfigStore? store = null, AppSettingsStore? settings = null, DefaultDeviceGuard? guard = null)
    {
        _store = store ?? new ConfigStore();
        _settings = settings ?? new AppSettingsStore(AppPaths.AppSettingsFile);
        _guard = guard ?? new DefaultDeviceGuard(new WasapiDefaultDeviceSwitcher(), _settings,
            msg => { System.Diagnostics.Debug.WriteLine(msg); _host.ReportError(msg); });
    }

    public AppSettingsStore Settings => _settings;
    public bool IsRunning => _host.IsRunning;

    /// <summary>Dispatches a JSON-RPC method. <paramref name="args"/> is the positional params array.</summary>
    public async Task<object?> InvokeAsync(string method, JsonElement args)
    {
        switch (method)
        {
            case "listDevices": return await Task.Run(ListDevices);
            case "getConfig": return await Task.Run(GetConfig);
            case "saveConfig": return await SaveConfigAsync(Arg(args, 0));
            case "start": await StartAsync(); return null;
            case "stop": await StopAsync(); return null;
            case "getAppSettings": return await Task.Run(GetAppSettings);
            case "saveAppSettings": await SaveAppSettingsAsync(Arg(args, 0)); return null;
            case "getStatus": return _host.LastStatus;
            case "playTone": return await Task.Run(() => PlayTone(Arg(args, 0).GetString() ?? "", Arg(args, 1).GetInt32()));
            case "openSoundPanel": OpenSoundPanel(); return null;
            case "calibrate": return await CalibrateAsync(Arg(args, 0));
            case "cancelCalibration": Volatile.Read(ref _calCts)?.Cancel(); return null;
            default: throw new BridgeException($"Bilinmeyen yöntem: {method}");
        }
    }

    private static JsonElement Arg(JsonElement args, int i) =>
        args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > i
            ? args[i]
            : throw new BridgeException($"Eksik parametre ({i + 1}. argüman).");

    // ---- devices ----

    public static List<DeviceDto> ListDevices()
    {
        return DeviceEnumeration.List(includeInactive: false)
            .Select(d => new DeviceDto(
                d.Id, d.Name,
                d.Channels > 2 ? "multichannel" : "local", // network devices are not supported yet
                d.Flow == DeviceFlow.Render ? "render" : "capture",
                d.Channels, d.SampleRate, d.IsDefault))
            .ToList();
    }

    // ---- config ----

    public JsonElement GetConfig()
    {
        var cfg = _store.Load();
        using var doc = JsonDocument.Parse(cfg.ToJson());
        return doc.RootElement.Clone();
    }

    private async Task<object?> SaveConfigAsync(JsonElement doc)
    {
        SurroundConfig cfg;
        try { cfg = SurroundConfig.Parse(doc.GetRawText()); }
        catch (JsonException ex) { throw new BridgeException($"Yapılandırma okunamadı: {ex.Message}"); }

        await _gate.WaitAsync();
        try
        {
            // Always persist: the UI edits continuously and the document is a draft until started.
            _store.Save(cfg);

            // A brand-new empty room (no outputs, no speakers) is legitimate, not an error.
            if (cfg.Outputs.Count == 0 && cfg.Speakers.Count == 0) return null;

            var errors = await Task.Run(() => Validate(cfg));
            if (errors.Count > 0) throw new BridgeException(errors);

            if (_host.IsRunning)
            {
                var fp = cfg.EngineFingerprint();
                if (fp != _runningFingerprint)
                {
                    try { await RestartAsync(cfg); }
                    catch when (!_host.IsRunning)
                    {
                        // Neither the new nor the previous config runs: stopped, so the user gets their default output back.
                        _runningFingerprint = null;
                        await Task.Run(_guard.Restore);
                        throw;
                    }
                    finally { RunningChanged?.Invoke(_host.IsRunning); }
                    _runningFingerprint = fp;
                    await SyncDefaultDeviceAsync(cfg);
                }
                else
                {
                    // Same audio graph: processing and speaker EQ are swapped in place, no dropout.
                    try { await _host.UpdateLiveAsync(cfg); }
                    catch (Exception ex) { throw new BridgeException($"Ses ayarları uygulanamadı: {ex.Message}"); }
                }
            }
            return null;
        }
        finally { _gate.Release(); }
    }

    private static List<string> Validate(SurroundConfig cfg)
    {
        var errors = ConfigValidator.Validate(cfg);
        if (errors.Count == 0) errors = ConfigValidator.CheckDevices(cfg, new WasapiDeviceCatalog());
        return errors;
    }

    // ---- engine ----

    private async Task RestartAsync(SurroundConfig cfg)
    {
        try { await _host.StartAsync(cfg); }
        catch (ConfigException ex) { throw new BridgeException(ex.Errors); }
        catch (Exception ex) { throw new BridgeException($"Motor yeniden başlatılamadı: {ex.Message}"); }
    }

    public async Task StartAsync()
    {
        await _gate.WaitAsync();
        try
        {
            if (_host.IsRunning) return;
            var cfg = _store.Load();
            var errors = await Task.Run(() => Validate(cfg));
            if (errors.Count > 0) throw new BridgeException(errors);
            try { await _host.StartAsync(cfg); }
            catch (ConfigException ex) { throw new BridgeException(ex.Errors); }
            catch (Exception ex) { throw new BridgeException($"Motor başlatılamadı: {ex.Message}"); }
            _runningFingerprint = cfg.EngineFingerprint();
            RunningChanged?.Invoke(true);
            await SyncDefaultDeviceAsync(cfg);
        }
        finally { _gate.Release(); }
    }

    public async Task StopAsync()
    {
        await _gate.WaitAsync();
        try
        {
            await _host.StopAsync();
            _runningFingerprint = null;
            RunningChanged?.Invoke(false);
            await Task.Run(_guard.Restore); // back to the user's own default output
        }
        finally { _gate.Release(); }
    }

    // ---- calibration ----

    /// <summary>
    /// Measures the speakers with a microphone (see docs/kalibrasyon.md). A running engine is stopped for the
    /// measurement and restarted afterwards; the default-device guard stays engaged meanwhile, so other applications'
    /// sound keeps going to the (unread) source instead of disturbing the measurement.
    /// </summary>
    private async Task<CalibrationResult> CalibrateAsync(JsonElement doc)
    {
        var req = ParseCalibration(doc);
        var cts = new CancellationTokenSource();
        if (Interlocked.CompareExchange(ref _calCts, cts, null) != null) throw new BridgeException("Kalibrasyon zaten sürüyor.");
        try
        {
            await _gate.WaitAsync(cts.Token);
            try
            {
                var cfg = _store.Load();
                bool wasRunning = _host.IsRunning;
                if (wasRunning)
                {
                    await _host.StopAsync();
                    _runningFingerprint = null;
                    RunningChanged?.Invoke(false);
                }
                try
                {
                    return await Task.Run(() => CalibrationRunner.Run(cfg, req, p => CalibrationProgress?.Invoke(p), cts.Token));
                }
                catch (OperationCanceledException) { throw new BridgeException("Kalibrasyon iptal edildi."); }
                catch (ArgumentException ex) { throw new BridgeException(ex.Message); }
                catch (BridgeException) { throw; }
                catch (Exception ex) { throw new BridgeException($"Kalibrasyon başarısız: {ex.Message}"); }
                finally
                {
                    if (wasRunning) await ResumeAfterCalibrationAsync(cfg);
                }
            }
            finally { _gate.Release(); }
        }
        catch (OperationCanceledException) { throw new BridgeException("Kalibrasyon iptal edildi."); }
        finally
        {
            Interlocked.CompareExchange(ref _calCts, null, cts);
        }
    }

    /// <summary>
    /// Restarts the engine stopped for calibration; on failure the page learns it stays stopped (RunningChanged(false):
    /// "off" engine event, plus an engineError) and the user gets their default output back.
    /// </summary>
    private async Task ResumeAfterCalibrationAsync(SurroundConfig cfg)
    {
        try { await _host.StartAsync(cfg); }
        catch (Exception ex)
        {
            _runningFingerprint = null;
            RunningChanged?.Invoke(false);
            _host.ReportError($"Kalibrasyondan sonra motor yeniden başlatılamadı: {ex.Message}");
            await Task.Run(_guard.Restore);
            return;
        }
        _runningFingerprint = cfg.EngineFingerprint();
        RunningChanged?.Invoke(true);
        // saveAppSettings does not wait for a calibration and sees a stopped engine meanwhile, so a switchDefaultDevice
        // toggle during the measurement is applied here, from the settings as they are now.
        if (_settings.Load().SwitchDefaultDevice) await SyncDefaultDeviceAsync(cfg);
        else await Task.Run(_guard.Restore);
    }

    private static CalibrationRequest ParseCalibration(JsonElement doc)
    {
        if (doc.ValueKind != JsonValueKind.Object) throw new BridgeException("Kalibrasyon isteği bir nesne olmalı.");
        static JsonElement? Get(JsonElement o, string name) =>
            o.TryGetProperty(name, out var v) && v.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined) ? v : null;
        static List<string>? Strings(JsonElement o, string name)
        {
            if (Get(o, name) is not { } v) return null;
            if (v.ValueKind != JsonValueKind.Array || v.EnumerateArray().Any(x => x.ValueKind != JsonValueKind.String))
                throw new BridgeException($"'{name}' metin dizisi olmalı.");
            return v.EnumerateArray().Select(x => x.GetString()!).ToList();
        }
        static double? Number(JsonElement o, string name) => Get(o, name) is { } v
            ? v.ValueKind == JsonValueKind.Number ? v.GetDouble() : throw new BridgeException($"'{name}' sayı olmalı.")
            : null;

        string mic = Get(doc, "micDeviceId") is { ValueKind: JsonValueKind.String } m ? m.GetString()! : "";
        if (string.IsNullOrWhiteSpace(mic)) throw new BridgeException("Mikrofon seçilmedi.");
        var speakers = Strings(doc, "speakerIds");
        if (speakers is null || speakers.Count == 0) throw new BridgeException("Kalibre edilecek hoparlör seçilmedi.");
        string? reference = Get(doc, "referenceSpeakerId") is { ValueKind: JsonValueKind.String } r ? r.GetString() : null;
        bool loopback = Flag(doc, "micLoopback", false);
        return new CalibrationRequest(mic, speakers, reference, loopback,
            (int)Math.Round(Number(doc, "repeats") ?? 2), Number(doc, "levelDb") ?? -20, Strings(doc, "lowBandSpeakerIds"));
    }

    // ---- default output device ----

    /// <summary>Makes the loopback source the Windows default (if enabled); COM failures are logged, never thrown.</summary>
    private async Task SyncDefaultDeviceAsync(SurroundConfig cfg)
    {
        if (!_settings.Load().SwitchDefaultDevice) return;
        if (!cfg.Source.Mode.Trim().Equals("loopback", StringComparison.OrdinalIgnoreCase)) return;
        string id = cfg.Source.DeviceId;
        await Task.Run(() => _guard.Engage(id));
    }

    /// <summary>Launch-time repair after a crash left the source as the default. No-op when nothing is remembered.</summary>
    public void RestoreDefaultDevice() => _guard.RestoreIfPending();

    // ---- app settings ----

    private object GetAppSettings() => ToDto(_settings.Load());

    private static object ToDto(AppSettings s) => new
    {
        switchDefaultDevice = s.SwitchDefaultDevice,
        startWithWindows = s.StartWithWindows,
        startEngineOnLaunch = s.StartEngineOnLaunch,
        minimizeToTray = s.MinimizeToTray,
    };

    private async Task SaveAppSettingsAsync(JsonElement doc)
    {
        if (doc.ValueKind != JsonValueKind.Object) throw new BridgeException("Uygulama ayarları bir nesne olmalı.");
        var before = _settings.Load();
        // Missing members keep their value; restore* members from the page are ignored.
        var user = new AppSettings
        {
            SwitchDefaultDevice = Flag(doc, "switchDefaultDevice", before.SwitchDefaultDevice),
            StartWithWindows = Flag(doc, "startWithWindows", before.StartWithWindows),
            StartEngineOnLaunch = Flag(doc, "startEngineOnLaunch", before.StartEngineOnLaunch),
            MinimizeToTray = Flag(doc, "minimizeToTray", before.MinimizeToTray),
        };
        var after = _settings.Update(s => s.WithUserSettings(user));

        string? registryError = null;
        try { StartupRegistration.Apply(after.StartWithWindows); }
        catch (Exception ex) { registryError = ex.Message; }

        // Toggled while running: act now instead of at the next start/stop. (During a calibration the engine is stopped;
        // the restart after it re-reads the setting.)
        if (before.SwitchDefaultDevice != after.SwitchDefaultDevice && _host.IsRunning)
        {
            if (after.SwitchDefaultDevice) await SyncDefaultDeviceAsync(_store.Load());
            else await Task.Run(_guard.Restore);
        }

        SettingsChanged?.Invoke(after);
        if (registryError is not null) throw new BridgeException($"Windows ile başlatma ayarlanamadı: {registryError}");
    }

    private static bool Flag(JsonElement obj, string name, bool fallback)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind == JsonValueKind.Null) return fallback;
        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw new BridgeException($"'{name}' true/false olmalı."),
        };
    }

    // ---- system ----

    /// <summary>Opens the Windows Sound control panel (e.g. to set VB-Cable to 7.1).</summary>
    private static void OpenSoundPanel()
    {
        try
        {
            using var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("control", "mmsys.cpl") { UseShellExecute = true });
        }
        catch (Exception ex) { throw new BridgeException($"Ses denetim masası açılamadı: {ex.Message}"); }
    }

    // ---- tone ----

    private object? PlayTone(string deviceId, int channel)
    {
        var dev = new WasapiDeviceCatalog().Find(deviceId)
            ?? throw new BridgeException($"Cihaz bulunamadı: {deviceId}");
        if (dev.Flow != DeviceFlow.Render) throw new BridgeException($"'{dev.Name}' bir çıkış cihazı değil.");
        if (channel < 1 || channel > dev.Channels)
            throw new BridgeException($"'{dev.Name}' {dev.Channels} kanallı; istenen kanal {channel}.");

        // Non-blocking: replaces a tone that is still playing; failures arrive as engineError events.
        var cts = new CancellationTokenSource();
        Interlocked.Exchange(ref _toneCts, cts)?.Cancel();
        _ = Task.Run(() =>
        {
            try { ToneRunner.Play(deviceId, channel, ToneSeconds, cts.Token); }
            catch (Exception ex) { _host.ReportError($"Test sesi çalınamadı: {ex.Message}"); }
        });
        return null;
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        Interlocked.Exchange(ref _toneCts, null)?.Cancel();
        Volatile.Read(ref _calCts)?.Cancel();
        _host.Dispose(); // stops the engine
        _guard.Restore(); // app exit / session end: give the user their default output back
    }
}
