using System.Buffers.Binary;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Surround.Engine.Calibration;

namespace Surround.Engine.Phone;

/// <summary>What the PC tells the phone page; the page polls it (GET api/state).</summary>
public static class PhoneState
{
    /// <summary>Idle, waiting for the user (or a measurement result is shown).</summary>
    public const string Ready = "ready";
    /// <summary>The PC wants the phone to start recording (it answers with POST api/recording).</summary>
    public const string Record = "record";
    /// <summary>The phone records; the program plays.</summary>
    public const string Recording = "recording";
    /// <summary>The program ended: the phone stops and uploads.</summary>
    public const string Upload = "upload";
    /// <summary>The PC analyses the upload.</summary>
    public const string Analyzing = "analyzing";
}

/// <summary>Status of the link for the PC's own UI.</summary>
public sealed record PhoneLinkStatus(bool Running, string? Url, IReadOnlyList<string> Urls, bool Connected, string State,
    string? Device, string? Note, string? Error);

/// <summary>
/// The phone microphone (docs/kalibrasyon.md, "Telefonla"): a small HTTPS server on the LAN that serves the phone page and
/// takes its recording. HTTPS is required because phone browsers only give a web page the microphone in a secure
/// context; the certificate is self-signed (<see cref="PhoneCertificate"/>), so the phone shows a warning once. Every
/// path carries a random token from the QR code; anything else gets 404. HTTP/1.1, one request per connection.
/// Implements <see cref="IExternalMicrophone"/> for <see cref="CalibrationRunner"/>.
/// </summary>
public sealed class PhoneLink : IExternalMicrophone, IDisposable
{
    public const int DefaultPort = 47810;
    /// <summary>Largest upload: 3 minutes of 48 kHz float mono with room to spare.</summary>
    public const int MaxBody = 64 * 1024 * 1024;
    private static readonly TimeSpan SeenWindow = TimeSpan.FromSeconds(4);
    private static readonly TimeSpan BeginTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan UploadTimeout = TimeSpan.FromSeconds(60);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly object _lock = new();
    private readonly string _certPath;
    private readonly Action<string>? _log;
    private TcpListener? _listener;
    private X509Certificate2? _cert;
    private CancellationTokenSource? _cts;
    private string _token = "";
    private List<string> _urls = new();
    private int _port;

    // Shared state (under _lock).
    private string _state = PhoneState.Ready;
    private string? _message, _result, _prompt, _error, _device, _note;
    private int _percent;
    private int _seq;
    private DateTime _lastSeen = DateTime.MinValue;
    private TaskCompletionSource<bool>? _recordingAck;
    private TaskCompletionSource<ExternalRecording>? _upload;

    public PhoneLink(string certPath, Action<string>? log = null)
    {
        _certPath = certPath;
        _log = log;
    }

    /// <summary>Something changed that the PC UI shows (connection, state, a start request).</summary>
    public event Action<PhoneLinkStatus>? StatusChanged;
    /// <summary>The user pressed "start" on the phone; the PC side decides what to measure and calls the runner.</summary>
    public event Action? StartRequested;

    public bool Running => _listener != null;
    public string Token => _token;
    public int Port => _port;

    /// <summary>Starts listening (idempotent); returns the URL for the QR code.</summary>
    public PhoneLinkStatus Start(int port = DefaultPort, IReadOnlyList<IPAddress>? addresses = null)
    {
        lock (_lock)
        {
            if (_listener != null) return StatusLocked();
            var ips = (addresses ?? PhoneCertificate.LanAddresses()).ToList();
            if (ips.Count == 0) throw new InvalidOperationException("Bu bilgisayar bir yerel ağa (Wi-Fi/Ethernet) bağlı görünmüyor.");
            _cert ??= PhoneCertificate.LoadOrCreate(_certPath, ips);
            _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant();
            TcpListener? l = null;
            for (int p = port; p < port + 10 && l is null; p++)
            {
                try { l = new TcpListener(IPAddress.Any, p); l.Start(); _port = p; }
                catch (SocketException) { l = null; }
            }
            if (l is null) throw new InvalidOperationException($"{port}-{port + 9} portlarının hepsi kullanımda.");
            _listener = l;
            _urls = ips.Select(ip => $"https://{ip}:{_port}/c/{_token}").ToList();
            _cts = new CancellationTokenSource();
            _state = PhoneState.Ready; _error = null; _result = null; _message = null; _percent = 0;
            _ = AcceptLoop(l, _cts.Token);
            _log?.Invoke($"telefon bağlantısı: {_urls[0]}");
        }
        Notify();
        return Status();
    }

    public void Stop()
    {
        lock (_lock)
        {
            _cts?.Cancel();
            try { _listener?.Stop(); } catch { }
            _listener = null;
            _cts = null;
            _recordingAck?.TrySetException(new InvalidOperationException("Telefon bağlantısı kapatıldı."));
            _upload?.TrySetException(new InvalidOperationException("Telefon bağlantısı kapatıldı."));
            _lastSeen = DateTime.MinValue;
        }
        Notify();
    }

    public PhoneLinkStatus Status() { lock (_lock) return StatusLocked(); }

    private PhoneLinkStatus StatusLocked() => new(_listener != null, _urls.FirstOrDefault(), _urls.ToList(),
        _listener != null && DateTime.UtcNow - _lastSeen < SeenWindow, _state, _device, _note, _error);

    public bool Connected { get { lock (_lock) return _listener != null && DateTime.UtcNow - _lastSeen < SeenWindow; } }

    // ---- what the PC shows on the phone ----

    /// <summary>A line of instruction on the phone (e.g. where to put it for the next position); null clears it.</summary>
    public void SetPrompt(string? text) { lock (_lock) { _prompt = text; _seq++; } }

    public void SetProgress(string message, int percent) { lock (_lock) { _message = message; _percent = Math.Clamp(percent, 0, 100); _seq++; } }

    /// <summary>Measurement finished: back to ready with a short summary (or an error).</summary>
    public void SetResult(string? summary, string? error = null)
    {
        lock (_lock)
        {
            _state = PhoneState.Ready; _result = summary; _error = error; _percent = error is null ? 100 : 0;
            _message = error ?? "Ölçüm tamamlandı.";
            _seq++;
        }
        Notify();
    }

    // ---- IExternalMicrophone ----

    public void Begin(CancellationToken ct)
    {
        TaskCompletionSource<bool> ack;
        lock (_lock)
        {
            if (_listener is null) throw new InvalidOperationException("Telefon bağlantısı açık değil.");
            if (DateTime.UtcNow - _lastSeen >= SeenWindow) throw new InvalidOperationException("Telefon bağlı değil. QR kodu telefonla okutup sayfayı açık tutun.");
            ack = _recordingAck = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            _upload = null;
            _state = PhoneState.Record; _error = null; _result = null; _message = "Kayıt başlıyor"; _percent = 0; _seq++;
        }
        Notify();
        if (!ack.Task.Wait(BeginTimeout, ct))
        {
            Abort();
            throw new InvalidOperationException("Telefon kayda başlamadı. Sayfa açık mı, mikrofon izni verildi mi?");
        }
        ack.Task.GetAwaiter().GetResult();
    }

    public ExternalRecording Finish(CancellationToken ct)
    {
        TaskCompletionSource<ExternalRecording> up;
        lock (_lock)
        {
            up = _upload ??= new TaskCompletionSource<ExternalRecording>(TaskCreationOptions.RunContinuationsAsynchronously);
            _state = PhoneState.Upload; _message = "Kayıt telefondan alınıyor"; _seq++;
        }
        Notify();
        if (!up.Task.Wait(UploadTimeout, ct))
        {
            Abort();
            throw new InvalidOperationException("Telefondan kayıt gelmedi.");
        }
        var rec = up.Task.GetAwaiter().GetResult();
        lock (_lock) { _state = PhoneState.Analyzing; _message = "Analiz ediliyor"; _seq++; }
        Notify();
        return rec;
    }

    public void Abort()
    {
        lock (_lock)
        {
            _recordingAck?.TrySetCanceled();
            _upload?.TrySetCanceled();
            _recordingAck = null; _upload = null;
            _state = PhoneState.Ready; _message = "Ölçüm durduruldu."; _seq++;
        }
        Notify();
    }

    // ---- HTTP ----

    public sealed record Request(string Method, string Path, string Query, byte[] Body);
    public sealed record Response(int Status, string ContentType, byte[] Body);

    /// <summary>Routes one request (pure apart from the shared state; used directly by tests).</summary>
    public Response Handle(Request req)
    {
        string prefix = "/c/" + _token;
        if (_token.Length == 0 || !(req.Path == prefix || req.Path.StartsWith(prefix + "/", StringComparison.Ordinal)))
            return Text(404, "Bulunamadı");
        string rest = req.Path[prefix.Length..];
        if (req.Method == "GET" && (rest == "" || rest == "/"))
        {
            Touch();
            return new Response(200, "text/html; charset=utf-8", PhonePage.Html());
        }
        switch (req.Method, rest)
        {
            case ("GET", "/api/state"):
                Touch();
                lock (_lock)
                    return JsonOk(new { state = _state, message = _message, percent = _percent, result = _result, prompt = _prompt, error = _error, seq = _seq });
            case ("POST", "/api/hello"):
                Hello(req.Body);
                return JsonOk(new { ok = true });
            case ("POST", "/api/start"):
                Touch();
                lock (_lock)
                    if (_state != PhoneState.Ready) return Text(409, "Ölçüm zaten sürüyor.");
                StartRequested?.Invoke();
                return JsonOk(new { ok = true });
            case ("POST", "/api/recording"):
                Touch();
                lock (_lock)
                {
                    if (_state != PhoneState.Record || _recordingAck is null) return Text(409, "Kayıt istenmedi.");
                    _state = PhoneState.Recording; _message = "Kaydediliyor"; _seq++;
                    _recordingAck.TrySetResult(true);
                }
                Notify();
                return JsonOk(new { ok = true });
            case ("POST", "/api/upload"):
                Touch();
                return Upload(req);
            case ("POST", "/api/abort"):
                Touch();
                lock (_lock)
                {
                    _recordingAck?.TrySetException(new InvalidOperationException("Telefonda ölçüm durduruldu."));
                    _upload?.TrySetException(new InvalidOperationException("Telefonda ölçüm durduruldu."));
                }
                return JsonOk(new { ok = true });
        }
        return Text(404, "Bulunamadı");
    }

    private Response Upload(Request req)
    {
        int rate = 0;
        foreach (var kv in req.Query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var p = kv.Split('=', 2);
            if (p.Length == 2 && p[0] == "rate") int.TryParse(p[1], out rate);
        }
        if (rate < 8000 || rate > 192000) return Text(400, "Geçersiz örnekleme hızı.");
        if (req.Body.Length % 4 != 0) return Text(400, "Kayıt verisi bozuk.");
        var samples = new float[req.Body.Length / 4];
        for (int i = 0; i < samples.Length; i++)
        {
            float v = BinaryPrimitives.ReadSingleLittleEndian(req.Body.AsSpan(i * 4, 4));
            samples[i] = float.IsFinite(v) ? v : 0;
        }
        string? note;
        lock (_lock)
        {
            if (_state != PhoneState.Upload && _state != PhoneState.Recording) return Text(409, "Kayıt beklenmiyordu.");
            note = _note;
            _upload ??= new TaskCompletionSource<ExternalRecording>(TaskCreationOptions.RunContinuationsAsynchronously);
            _upload.TrySetResult(new ExternalRecording(samples, rate, note));
            _state = PhoneState.Analyzing; _message = "Analiz ediliyor"; _seq++;
        }
        _log?.Invoke(FormattableString.Invariant($"telefon kaydı: {samples.Length / (double)rate:0.0} sn, {rate} Hz"));
        Notify();
        return JsonOk(new { ok = true });
    }

    /// <summary>The page reports its browser and the microphone track settings; processing left on is noted.</summary>
    private void Hello(byte[] body)
    {
        string? device = null, note = null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            var r = doc.RootElement;
            if (r.TryGetProperty("device", out var d) && d.ValueKind == JsonValueKind.String) device = Trim(d.GetString(), 80);
            if (r.TryGetProperty("settings", out var s) && s.ValueKind == JsonValueKind.Object)
            {
                var on = new List<string>();
                if (Flag(s, "autoGainControl")) on.Add("otomatik kazanç");
                if (Flag(s, "noiseSuppression")) on.Add("gürültü bastırma");
                if (Flag(s, "echoCancellation")) on.Add("yankı giderme");
                if (on.Count > 0) note = $"Telefon tarayıcısı şunları kapatmadı: {string.Join(", ", on)}; seviye ve tını ölçümü sapabilir.";
            }
        }
        catch (JsonException) { }
        lock (_lock) { _device = device; _note = note; _lastSeen = DateTime.UtcNow; }
        Notify();
    }

    private static bool Flag(JsonElement o, string name) => o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
    private static string? Trim(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];

    private void Touch()
    {
        bool was;
        lock (_lock) { was = DateTime.UtcNow - _lastSeen < SeenWindow; _lastSeen = DateTime.UtcNow; }
        if (!was) Notify();
    }

    private void Notify()
    {
        try { StatusChanged?.Invoke(Status()); } catch (Exception ex) { _log?.Invoke($"telefon durumu: {ex.Message}"); }
    }

    private static Response JsonOk(object o) => new(200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(o, Json));
    private static Response Text(int status, string s) => new(status, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(s));

    private async Task AcceptLoop(TcpListener l, CancellationToken ct)
    {
        // A dropped phone shows up as "not connected" after a few seconds without polls.
        _ = Task.Run(async () =>
        {
            bool last = false;
            while (!ct.IsCancellationRequested)
            {
                try { await Task.Delay(1000, ct); } catch { break; }
                bool now = Connected;
                if (now != last) { last = now; Notify(); }
            }
        }, ct);
        while (!ct.IsCancellationRequested)
        {
            TcpClient c;
            try { c = await l.AcceptTcpClientAsync(ct); }
            catch { break; }
            _ = Task.Run(() => Serve(c, ct), ct);
        }
    }

    private async Task Serve(TcpClient client, CancellationToken ct)
    {
        using var _ = client;
        client.NoDelay = true;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(90));
            await using var ssl = new SslStream(client.GetStream(), false);
            await ssl.AuthenticateAsServerAsync(new SslServerAuthenticationOptions
            {
                ServerCertificate = _cert,
                EnabledSslProtocols = System.Security.Authentication.SslProtocols.Tls12 | System.Security.Authentication.SslProtocols.Tls13,
            }, timeout.Token);
            var req = await ReadRequest(ssl, timeout.Token);
            var resp = req is null ? Text(400, "Hatalı istek") : Handle(req);
            await WriteResponse(ssl, resp, timeout.Token);
        }
        catch (Exception ex) when (ex is IOException or System.Security.Authentication.AuthenticationException or OperationCanceledException or SocketException)
        {
            // The first visit fails the handshake until the user accepts the certificate; closed tabs drop mid-request.
        }
        catch (Exception ex) { _log?.Invoke($"telefon isteği: {ex.Message}"); }
    }

    internal static async Task<Request?> ReadRequest(Stream s, CancellationToken ct)
    {
        var head = new MemoryStream();
        var one = new byte[1];
        // Header up to 16 KB, byte by byte until CRLFCRLF (small; the body is read in bulk).
        while (head.Length < 16384)
        {
            int n = await s.ReadAsync(one, ct);
            if (n == 0) return null;
            head.WriteByte(one[0]);
            var b = head.GetBuffer();
            long L = head.Length;
            if (L >= 4 && b[L - 4] == '\r' && b[L - 3] == '\n' && b[L - 2] == '\r' && b[L - 1] == '\n') break;
        }
        var text = Encoding.ASCII.GetString(head.GetBuffer(), 0, (int)head.Length);
        var lines = text.Split("\r\n");
        var first = lines[0].Split(' ');
        if (first.Length < 3) return null;
        long length = 0;
        bool chunked = false;
        foreach (var line in lines.Skip(1))
        {
            int c = line.IndexOf(':');
            if (c <= 0) continue;
            string name = line[..c].Trim(), value = line[(c + 1)..].Trim();
            if (name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
            {
                if (!long.TryParse(value, out length) || length < 0) return null;
            }
            else if (name.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase))
                chunked = value.Contains("chunked", StringComparison.OrdinalIgnoreCase);
        }
        byte[] body;
        if (chunked)
        {
            var acc = new MemoryStream();
            while (true)
            {
                var size = await ReadLine(s, ct);
                if (size is null) return null;
                int semi = size.IndexOf(';');
                if (!int.TryParse(semi < 0 ? size : size[..semi], System.Globalization.NumberStyles.HexNumber, null, out int n) || n < 0) return null;
                if (n == 0) { await ReadLine(s, ct); break; } // no trailers expected: the final CRLF
                if (acc.Length + n > MaxBody) return null;
                var chunk = new byte[n];
                if (!await ReadExactly(s, chunk, ct)) return null;
                acc.Write(chunk);
                if (await ReadLine(s, ct) is null) return null;
            }
            body = acc.ToArray();
        }
        else
        {
            if (length > MaxBody) return null;
            body = new byte[length];
            if (!await ReadExactly(s, body, ct)) return null;
        }
        string target = first[1];
        int q = target.IndexOf('?');
        return new Request(first[0].ToUpperInvariant(), q < 0 ? target : target[..q], q < 0 ? "" : target[(q + 1)..], body);
    }

    private static async Task<bool> ReadExactly(Stream s, byte[] buf, CancellationToken ct)
    {
        int read = 0;
        while (read < buf.Length)
        {
            int n = await s.ReadAsync(buf.AsMemory(read), ct);
            if (n == 0) return false;
            read += n;
        }
        return true;
    }

    private static async Task<string?> ReadLine(Stream s, CancellationToken ct)
    {
        var sb = new StringBuilder();
        var one = new byte[1];
        while (sb.Length < 1024)
        {
            if (await s.ReadAsync(one, ct) == 0) return null;
            if (one[0] == '\n') return sb.ToString().TrimEnd('\r');
            sb.Append((char)one[0]);
        }
        return null;
    }

    private static async Task WriteResponse(Stream s, Response r, CancellationToken ct)
    {
        string reason = r.Status switch { 200 => "OK", 400 => "Bad Request", 404 => "Not Found", 409 => "Conflict", _ => "Error" };
        var head = $"HTTP/1.1 {r.Status} {reason}\r\nContent-Type: {r.ContentType}\r\nContent-Length: {r.Body.Length}\r\n" +
                   "Cache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n";
        await s.WriteAsync(Encoding.ASCII.GetBytes(head), ct);
        await s.WriteAsync(r.Body, ct);
        await s.FlushAsync(ct);
    }

    public void Dispose()
    {
        Stop();
        _cert?.Dispose();
    }
}
