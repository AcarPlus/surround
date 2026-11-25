using System.Text.Json;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace Surround.Desktop.Bridge;

/// <summary>
/// JSON-RPC over WebView2 messages.
///   page -> host: { id, method, params: [] }
///   host -> page: { id, result } | { id, error: { message, errors } }
///   host -> page (push): { event: "status" | "levels" | "engine" | "engineError" | "engineState" | "deviceRejoined" | "calibration" | "profileApplied" | "phoneLink" | "phoneStart" | "volume" | "update" | "window", data }
/// </summary>
public sealed class BridgeHost : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] ChannelNames = Surround.Engine.Channels.Names;

    private readonly CoreWebView2 _web;
    private readonly SurroundBackend _backend;
    private readonly Dispatcher _ui;
    private readonly Func<string, bool> _isTrustedSource;
    private readonly WindowFrame? _frame;
    private volatile bool _closed;

    public BridgeHost(CoreWebView2 web, SurroundBackend backend, Dispatcher ui, Func<string, bool> isTrustedSource, WindowFrame? frame = null)
    {
        _web = web;
        _backend = backend;
        _ui = ui;
        _isTrustedSource = isTrustedSource;
        _frame = frame;
        if (_frame is not null) _frame.Changed += OnWindowState;

        _web.WebMessageReceived += OnMessage;
        _backend.Status += OnStatus;
        _backend.Levels += OnLevels;
        _backend.Info += OnInfo;
        _backend.EngineError += OnEngineError;
        _backend.CalibrationProgress += OnCalibration;
        _backend.RunningChanged += OnRunningChanged;
        _backend.StateChanged += OnEngineState;
        _backend.DeviceRejoined += OnDeviceRejoined;
        _backend.ProfileApplied += OnProfileApplied;
        _backend.PhoneStatus += OnPhoneStatus;
        _backend.PhoneStartRequested += OnPhoneStart;
        _backend.VolumeChanged += OnVolume;
        _backend.Updater.Changed += OnUpdate;
    }

    private void OnVolume(VolumeDto v) => PushEvent("volume", v);

    /// <summary>The page's own title bar follows the window: restore glyph when maximised, faded when inactive.</summary>
    private void OnWindowState(object state) => PushEvent("window", state);

    private void OnUpdate(UpdateDto u) => PushEvent("update", u);

    private void OnPhoneStatus(Surround.Engine.Phone.PhoneLinkStatus s) => PushEvent("phoneLink", s);

    private void OnPhoneStart() => PushEvent("phoneStart", new { });

    /// <summary>Tray menu applied a profile to the stored config: the page adopts it (undo, toast, profile menu).</summary>
    private void OnProfileApplied(string id) => PushEvent("profileApplied", new { id });

    private void OnEngineState(EngineStateDto state) => PushEvent("engineState", state);

    private void OnDeviceRejoined(IReadOnlyList<string> names) => PushEvent("deviceRejoined", new { names });

    private static readonly EngineInfoDto Off = new("off", 0, 0, 0);

    /// <summary>
    /// Every stop (also one the page did not ask for: calibration, a failed restart) reaches the page as an "off"
    /// engine event (sourceRate 0) and an empty status, even when the engine thread had nothing left to report.
    /// </summary>
    private void OnRunningChanged(bool running)
    {
        if (running) return;
        PushEvent("status", Array.Empty<SinkStatusDto>());
        PushEvent("engine", Off);
    }

    private void OnCalibration(Surround.Engine.Calibration.CalibrationProgress p) => PushEvent("calibration", p);

    private void OnInfo(EngineInfoDto info) => PushEvent("engine", info);

    private void OnStatus(IReadOnlyList<SinkStatusDto> status) => PushEvent("status", status);

    private void OnLevels(float[] db)
    {
        var frame = new Dictionary<string, double>(ChannelNames.Length);
        for (int i = 0; i < ChannelNames.Length && i < db.Length; i++) frame[ChannelNames[i]] = Math.Round(db[i], 1);
        PushEvent("levels", frame);
    }

    private void OnEngineError(string message) => PushEvent("engineError", message);

    private void PushEvent(string name, object data) => Post(JsonSerializer.Serialize(new { @event = name, data }, Json));

    /// <summary>Marshals to the UI thread (CoreWebView2 is single-threaded) and posts raw JSON to the page.</summary>
    private void Post(string json)
    {
        if (_closed) return;
        if (_ui.CheckAccess()) { PostCore(json); return; }
        _ = _ui.InvokeAsync(() => PostCore(json));
    }

    private void PostCore(string json)
    {
        if (_closed) return;
        try { _web.PostWebMessageAsJson(json); }
        catch (Exception) { /* page navigating or closing */ }
    }

    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!_isTrustedSource(e.Source)) return;

        long id;
        string method;
        JsonElement args;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("id", out var idEl) || !idEl.TryGetInt64(out id)) return;
            method = root.TryGetProperty("method", out var m) ? m.GetString() ?? "" : "";
            args = root.TryGetProperty("params", out var p) ? p.Clone() : default;
        }
        catch (JsonException) { return; }

        _ = HandleAsync(id, method, args);
    }

    private async Task HandleAsync(long id, string method, JsonElement args)
    {
        string response;
        try
        {
            // window.* drive the frameless window (title bar buttons, resize grip, system menu); UI thread, no await.
            var result = method.StartsWith("window.", StringComparison.Ordinal) && _frame is not null
                ? _frame.Invoke(method, args)
                : await _backend.InvokeAsync(method, args);
            response = JsonSerializer.Serialize(new { id, result }, Json);
        }
        catch (BridgeException ex)
        {
            response = JsonSerializer.Serialize(new { id, error = new { message = ex.Message, errors = ex.Errors } }, Json);
        }
        catch (Exception ex)
        {
            response = JsonSerializer.Serialize(new { id, error = new { message = $"Beklenmeyen hata: {ex.Message}" } }, Json);
        }
        Post(response);
    }

    public void Dispose()
    {
        _closed = true;
        _backend.Status -= OnStatus;
        _backend.Levels -= OnLevels;
        _backend.Info -= OnInfo;
        _backend.EngineError -= OnEngineError;
        _backend.CalibrationProgress -= OnCalibration;
        _backend.RunningChanged -= OnRunningChanged;
        _backend.StateChanged -= OnEngineState;
        _backend.DeviceRejoined -= OnDeviceRejoined;
        _backend.ProfileApplied -= OnProfileApplied;
        _backend.PhoneStatus -= OnPhoneStatus;
        _backend.PhoneStartRequested -= OnPhoneStart;
        _backend.VolumeChanged -= OnVolume;
        _backend.Updater.Changed -= OnUpdate;
        if (_frame is not null) _frame.Changed -= OnWindowState;
        try { _web.WebMessageReceived -= OnMessage; } catch { }
    }
}
