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
