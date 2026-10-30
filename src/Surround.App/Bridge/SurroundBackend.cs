using System.Text.Json;
using Surround.Engine;
using Surround.Engine.Audio;
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
    private string? _runningFingerprint;

    public event Action<IReadOnlyList<SinkStatusDto>>? Status { add => _host.StatusChanged += value; remove => _host.StatusChanged -= value; }
    public event Action<float[]>? Levels { add => _host.LevelsChanged += value; remove => _host.LevelsChanged -= value; }
    public event Action<string>? EngineError { add => _host.Error += value; remove => _host.Error -= value; }

    public SurroundBackend(ConfigStore? store = null) => _store = store ?? new ConfigStore();

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
            case "getStatus": return _host.LastStatus;
            case "playTone": return await Task.Run(() => PlayTone(Arg(args, 0).GetString() ?? "", Arg(args, 1).GetInt32()));
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

            if (_host.IsRunning && cfg.EngineFingerprint() != _runningFingerprint)
            {
                await RestartAsync(cfg);
                _runningFingerprint = cfg.EngineFingerprint();
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

    private async Task StartAsync()
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
        }
        finally { _gate.Release(); }
    }

    private async Task StopAsync()
    {
        await _gate.WaitAsync();
        try
        {
            await _host.StopAsync();
            _runningFingerprint = null;
        }
        finally { _gate.Release(); }
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
        Interlocked.Exchange(ref _toneCts, null)?.Cancel();
        _host.Dispose();
    }
}
