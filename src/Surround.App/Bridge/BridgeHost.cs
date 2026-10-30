using System.Text.Json;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace Surround.Desktop.Bridge;

/// <summary>
/// JSON-RPC over WebView2 messages.
///   page -> host: { id, method, params: [] }
///   host -> page: { id, result } | { id, error: { message, errors } }
///   host -> page (push): { event: "status" | "levels" | "engineError", data }
/// </summary>
public sealed class BridgeHost : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] ChannelNames = Surround.Engine.Channels.Names;

    private readonly CoreWebView2 _web;
    private readonly SurroundBackend _backend;
    private readonly Dispatcher _ui;
    private readonly Func<string, bool> _isTrustedSource;
    private volatile bool _closed;

    public BridgeHost(CoreWebView2 web, SurroundBackend backend, Dispatcher ui, Func<string, bool> isTrustedSource)
    {
        _web = web;
        _backend = backend;
        _ui = ui;
        _isTrustedSource = isTrustedSource;

        _web.WebMessageReceived += OnMessage;
        _backend.Status += OnStatus;
        _backend.Levels += OnLevels;
        _backend.EngineError += OnEngineError;
    }

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
            var result = await _backend.InvokeAsync(method, args);
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
        _backend.EngineError -= OnEngineError;
        try { _web.WebMessageReceived -= OnMessage; } catch { }
    }
}
