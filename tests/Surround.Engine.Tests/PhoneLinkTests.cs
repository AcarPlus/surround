using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Surround.Engine.Phone;

namespace Surround.Engine.Tests;

public class PhoneLinkTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "surround-phone-" + Guid.NewGuid().ToString("N"));

    public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    private static HttpClient Client() => new(new HttpClientHandler
    {
        ServerCertificateCustomValidationCallback = (_, _, _, _) => true, // self-signed, as on the phone
    }) { Timeout = TimeSpan.FromSeconds(20) };

    [Fact]
    public async Task Link_ServesThePage_AndRunsTheRecordUploadHandshakeOverTls()
    {
        using var link = new PhoneLink(Path.Combine(_dir, "cert.pfx"));
        var st = link.Start(47890, new[] { IPAddress.Loopback });
        Assert.True(st.Running);
        string url = $"https://127.0.0.1:{link.Port}/c/{link.Token}";
        Assert.Equal(url, st.Url);
        using var http = Client();

        var page = await http.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Contains("Mikrofonu aç", await page.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync($"https://127.0.0.1:{link.Port}/c/wrongtoken")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync($"https://127.0.0.1:{link.Port}/")).StatusCode);

        var hello = await http.PostAsJsonAsync(url + "/api/hello", new { device = "test", settings = new { autoGainControl = true } });
        Assert.Equal(HttpStatusCode.OK, hello.StatusCode);
        Assert.True(link.Connected);
        Assert.Contains("otomatik kazanç", link.Status().Note);

        bool started = false;
        link.StartRequested += () => started = true;
        Assert.Equal(HttpStatusCode.OK, (await http.PostAsync(url + "/api/start", null)).StatusCode);
        Assert.True(started);

        // The runner asks the phone to record; the page sees "record" and acknowledges.
        var begin = Task.Run(() => link.Begin(CancellationToken.None));
        await WaitState(http, url, PhoneState.Record);
        Assert.Equal(HttpStatusCode.OK, (await http.PostAsync(url + "/api/recording", null)).StatusCode);
        await begin.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(HttpStatusCode.Conflict, (await http.PostAsync(url + "/api/start", null)).StatusCode);

        var finish = Task.Run(() => link.Finish(CancellationToken.None));
        await WaitState(http, url, PhoneState.Upload);
        var samples = new float[] { 0.5f, -0.25f, 0.125f };
        var bytes = new byte[samples.Length * 4];
        Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
        var up = await http.PostAsync(url + "/api/upload?rate=44100", new ByteArrayContent(bytes));
        Assert.Equal(HttpStatusCode.OK, up.StatusCode);
        var rec = await finish.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(44100, rec.SampleRate);
        Assert.Equal(samples, rec.Samples);
        Assert.Contains("otomatik kazanç", rec.Note);

        link.SetResult("ok özet");
        var s = await http.GetFromJsonAsync<JsonElement>(url + "/api/state");
        Assert.Equal("ready", s.GetProperty("state").GetString());
        Assert.Equal("ok özet", s.GetProperty("result").GetString());
    }

    [Fact]
    public void Begin_WithoutAPhone_FailsFast()
    {
        using var link = new PhoneLink(Path.Combine(_dir, "cert.pfx"));
        link.Start(47900, new[] { IPAddress.Loopback });
        var ex = Assert.Throws<InvalidOperationException>(() => link.Begin(CancellationToken.None));
        Assert.Contains("bağlı değil", ex.Message);
    }

    [Fact]
    public void Handle_RejectsBadUploads()
    {
        using var link = new PhoneLink(Path.Combine(_dir, "cert.pfx"));
        link.Start(47910, new[] { IPAddress.Loopback });
        string p = "/c/" + link.Token;
        Assert.Equal(400, link.Handle(new PhoneLink.Request("POST", p + "/api/upload", "rate=10", new byte[8])).Status);
        Assert.Equal(400, link.Handle(new PhoneLink.Request("POST", p + "/api/upload", "rate=48000", new byte[7])).Status);
        Assert.Equal(409, link.Handle(new PhoneLink.Request("POST", p + "/api/upload", "rate=48000", new byte[8])).Status); // not asked for
        Assert.Equal(409, link.Handle(new PhoneLink.Request("POST", p + "/api/recording", "", Array.Empty<byte>())).Status);
    }

    [Fact]
    public void Certificate_IsReused_AndRemadeWhenTheAddressChanges()
    {
        string path = Path.Combine(_dir, "cert.pfx");
        var a = new[] { IPAddress.Parse("192.168.1.20") };
        using var c1 = PhoneCertificate.LoadOrCreate(path, a);
        using var c2 = PhoneCertificate.LoadOrCreate(path, a);
        Assert.Equal(c1.Thumbprint, c2.Thumbprint);
        Assert.True(c2.HasPrivateKey);
        using var c3 = PhoneCertificate.LoadOrCreate(path, new[] { IPAddress.Parse("192.168.1.21") });
        Assert.NotEqual(c1.Thumbprint, c3.Thumbprint);
        Assert.True(PhoneCertificate.IsPrivate(IPAddress.Parse("172.20.0.5")));
        Assert.False(PhoneCertificate.IsPrivate(IPAddress.Parse("8.8.8.8")));
    }

    [Fact]
    public void Link_KeepsItsAddress_AcrossRuns()
    {
        string cert = Path.Combine(_dir, "cert.pfx");
        string token; int port;
        using (var a = new PhoneLink(cert))
        {
            a.Start(47920, new[] { IPAddress.Loopback });
            token = a.Token; port = a.Port;
        }
        using var b = new PhoneLink(cert);
        b.Start(47920, new[] { IPAddress.Loopback });
        Assert.Equal(token, b.Token);
        Assert.Equal(port, b.Port);
    }

    [Fact]
    public void Certificate_IsKept_WhenOnlyASecondaryAddressChanges()
    {
        string path = Path.Combine(_dir, "cert.pfx");
        var lan = IPAddress.Parse("192.168.1.50");
        using var c1 = PhoneCertificate.LoadOrCreate(path, new[] { lan, IPAddress.Parse("172.20.1.5") });
        using var c2 = PhoneCertificate.LoadOrCreate(path, new[] { lan, IPAddress.Parse("172.27.9.1") }); // WSL after a reboot
        Assert.Equal(c1.Thumbprint, c2.Thumbprint);
    }

    // ---- WebM (MediaRecorder audio/webm;codecs=pcm) ----

    private static byte[] Vint(long v, int len)
    {
        var b = new byte[len];
        for (int i = len - 1; i >= 0; i--) { b[i] = (byte)(v & 0xFF); v >>= 8; }
        b[0] |= (byte)(0x80 >> (len - 1));
        return b;
    }

    private static byte[] Id(uint id) => id > 0xFFFFFF ? BitConverter.GetBytes(id).Reverse().ToArray()
        : id > 0xFFFF ? BitConverter.GetBytes(id).Reverse().Skip(1).ToArray()
        : id > 0xFF ? BitConverter.GetBytes(id).Reverse().Skip(2).ToArray() : new[] { (byte)id };

    private static byte[] El(uint id, byte[] data) => Id(id).Concat(Vint(data.Length, 4)).Concat(data).ToArray();
    private static byte[] Unknown(uint id) => Id(id).Concat(new byte[] { 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF }).ToArray();
    private static byte[] U(long v, int n) { var b = new byte[n]; for (int i = n - 1; i >= 0; i--) { b[i] = (byte)v; v >>= 8; } return b; }

    /// <summary>A browser-style recording: unknown-size Segment/Cluster, float stereo, blocks of 10 ms at the given times.</summary>
    private static byte[] Webm(int rate, IEnumerable<(int Ms, float[] Frames)> blocks)
    {
        var f = new List<byte>();
        f.AddRange(El(0x1A45DFA3, El(0x4282, "webm"u8.ToArray())));
        f.AddRange(Unknown(0x18538067));
        f.AddRange(El(0x1549A966, El(0x2AD7B1, U(1_000_000, 3))));
        var audio = El(0xB5, BitConverter.GetBytes((float)rate).Reverse().ToArray()).Concat(El(0x9F, U(2, 1))).Concat(El(0x6264, U(32, 1))).ToArray();
        var entry = El(0xD7, U(1, 1)).Concat(El(0x86, "A_PCM/FLOAT/IEEE"u8.ToArray())).Concat(El(0xE1, audio)).ToArray();
        f.AddRange(El(0x1654AE6B, El(0xAE, entry)));
        f.AddRange(Unknown(0x1F43B675));
        f.AddRange(El(0xE7, U(0, 2)));
        foreach (var (ms, frames) in blocks)
        {
            var payload = new List<byte> { 0x81 }; // track 1
            payload.AddRange(U(ms, 2));
            payload.Add(0x80); // keyframe, no lacing
            foreach (var x in frames) { payload.AddRange(BitConverter.GetBytes(x)); payload.AddRange(BitConverter.GetBytes(0f)); }
            f.AddRange(El(0xA3, payload.ToArray()));
        }
        return f.ToArray();
    }

    [Fact]
    public void Webm_DecodesPcm_AndFillsLostAudioByTimestamp()
    {
        const int rate = 48000, n = 480; // 10 ms blocks
        float[] Block(int k) => Enumerable.Range(0, n).Select(i => (k + 1) * 0.01f).ToArray();
        // Blocks at 0..40 ms, then 40 ms of audio lost (the next block is stamped 90 ms), then on.
        var times = new[] { 0, 10, 20, 30, 40, 90, 100, 110 };
        var data = Webm(rate, times.Select((t, k) => (t, Block(k))));
        Assert.True(WebmPcm.LooksLikeWebm(data));
        var a = WebmPcm.Decode(data);
        Assert.Equal(rate, a.SampleRate);
        Assert.Equal(2, a.Channels);
        Assert.Equal(1, a.Gaps);
        Assert.Equal(40, a.GapMs, 1);
        Assert.Equal(times.Length * n + 40 * rate / 1000, a.Samples.Length);
        // Stereo (x, 0) → mono x/2; the 6th block starts at 90 ms.
        Assert.Equal(0.01f / 2, a.Samples[0], 5);
        Assert.Equal(0f, a.Samples[50 * rate / 1000 + 10]);
        Assert.Equal(0.06f / 2, a.Samples[90 * rate / 1000], 5);
    }

    [Fact]
    public void Webm_TimestampJitter_IsNotAGap()
    {
        const int rate = 48000, n = 480;
        var times = new[] { 0, 10, 22, 30, 40, 50 }; // one block stamped 2 ms late, the next on time
        var a = WebmPcm.Decode(Webm(rate, times.Select(t => (t, new float[n]))));
        Assert.Equal(0, a.Gaps);
        Assert.Equal(times.Length * n, a.Samples.Length);
    }

    [Fact]
    public void Upload_AcceptsWebm()
    {
        using var link = new PhoneLink(Path.Combine(_dir, "cert.pfx"));
        link.Start(47930, new[] { IPAddress.Loopback });
        string p = "/c/" + link.Token;
        Assert.Equal(400, link.Handle(new PhoneLink.Request("POST", p + "/api/upload", "format=webm", new byte[] { 1, 2, 3 })).Status);
        var data = Webm(44100, new[] { (0, new float[441]) });
        Assert.Equal(409, link.Handle(new PhoneLink.Request("POST", p + "/api/upload", "format=webm&via=pcm", data)).Status); // not asked for
    }

    private static async Task WaitState(HttpClient http, string url, string state)
    {
        for (int i = 0; i < 100; i++)
        {
            var s = await http.GetFromJsonAsync<JsonElement>(url + "/api/state");
            if (s.GetProperty("state").GetString() == state) return;
            await Task.Delay(50);
        }
        throw new TimeoutException($"state {state} never came");
    }
}

public class PhoneFirewallTests
{
    [Fact]
    public void Arguments_ReplaceThisProgramsRules_WithOneLocalSubnetAllowRule()
    {
        var a = PhoneFirewall.Arguments(@"C:\Users\x\AppData\Local\Surround\current\Surround.exe");
        Assert.Contains(@"delete rule name=all program=""C:\Users\x\AppData\Local\Surround\current\Surround.exe""", a);
        Assert.Contains("dir=in action=allow", a);
        Assert.Contains("localport=47810-47819", a);
        Assert.Contains("remoteip=localsubnet profile=any", a);
        Assert.Throws<ArgumentException>(() => PhoneFirewall.Arguments("C:\a\" & del x"));
    }

    [Fact]
    public void IsAllowed_UnknownProgram_IsNotAllowed()
    {
        // Reads the real firewall (no changes): a program with no rules is not let in (or the API is unavailable).
        Assert.NotEqual(true, PhoneFirewall.IsAllowed(@"C:\nowhere\surround-test-" + Guid.NewGuid().ToString("N") + ".exe"));
    }
}
