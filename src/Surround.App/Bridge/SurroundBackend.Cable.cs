using System.Net.Http;
using NAudio.CoreAudioApi;
using Surround.Engine.Audio;

namespace Surround.Desktop.Bridge;

/// <summary>
/// One-click VB-Cable setup (README, "İndirme ve tek tıkla kurulum"): install the cable if missing (download from VB-Audio, check the signature,
/// one administrator prompt), set it to 7.1 and let Surround make it the default output while it runs. The page then
/// selects it as the loopback source.
/// </summary>
public sealed partial class SurroundBackend
{
    private static readonly TimeSpan CableSetupTimeout = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan CableAppearTimeout = TimeSpan.FromSeconds(30);
    private int _cableBusy;

    /// <summary>Result for the page: <c>state</c> = "done" (deviceId, channels) or "reboot" (installed, Windows must restart).</summary>
    private async Task<object?> CableSetupAsync()
    {
        if (Interlocked.Exchange(ref _cableBusy, 1) == 1) throw new BridgeException("VB-Cable kurulumu zaten sürüyor.");
        try { return await Task.Run(CableSetup); }
        finally { Volatile.Write(ref _cableBusy, 0); }
    }

    private object CableSetup()
    {
        var (id, channels) = FindCable();
        bool installed = false;
        if (id is null)
        {
            string work = Path.Combine(Path.GetTempPath(), "Surround");
            string exe;
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Surround-Setup");
                exe = CableInstaller.DownloadAsync(http, work, CancellationToken.None).GetAwaiter().GetResult();
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException or IOException)
            {
                throw new BridgeException($"VB-Cable indirilemedi ({ex.Message}). İnternet bağlantısını kontrol edin ya da vb-audio.com/Cable adresinden elle kurun.");
            }
            try
            {
                if (!CableInstaller.IsTrusted(exe, out var why))
                    throw new BridgeException($"İndirilen VB-Cable kurulumu doğrulanamadı: {why}. Güvenlik için çalıştırılmadı.");
                int code;
                try { code = CableInstaller.RunSetup(exe, CableSetupTimeout); }
                catch (OperationCanceledException) { throw new BridgeException("Windows onayı verilmedi; VB-Cable kurulmadı."); }
                catch (TimeoutException ex) { throw new BridgeException(ex.Message); }
                AppLog.Info($"vb-cable: kurulum bitti (çıkış kodu {code})");
                installed = true;
            }
            finally
            {
                try { Directory.Delete(Path.GetDirectoryName(exe)!, true); } catch { /* in use a little longer: temp anyway */ }
            }

            var wait = System.Diagnostics.Stopwatch.StartNew();
            while ((id = FindCable().Id) is null && wait.Elapsed < CableAppearTimeout) Thread.Sleep(1000);
            if (id is null) return new { state = "reboot", installed };
            channels = FindCable().Channels;
        }

        if (channels < 8)
        {
            try { SpeakerLayout.SetSevenOne(id); }
            catch (Exception ex) { throw new BridgeException($"VB-Cable 7.1'e ayarlanamadı ({ex.Message}). Ses panelinden elle ayarlayın."); }
            for (int i = 0; i < 10 && (channels = ChannelsOf(id)) < 8; i++) Thread.Sleep(300);
            AppLog.Info($"vb-cable: 7.1 ayarlandı ({channels} kanal)");
        }

        // Default output only while Surround runs (restored on stop): a permanent default would leave the PC silent
        // whenever Surround is closed.
        var after = _settings.Update(s => s with { SwitchDefaultDevice = true });
        SettingsChanged?.Invoke(after);
        return new { state = "done", deviceId = id, channels, installed };
    }

    /// <summary>The VB-Cable render endpoint with the most channels (renamed installs keep "VB-Audio" in the name).</summary>
    private static (string? Id, int Channels) FindCable()
    {
        try
        {
            using var en = new MMDeviceEnumerator();
            string? best = null; int ch = 0;
            foreach (var d in en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
            {
                using (d)
                {
                    string name = d.FriendlyName;
                    if (name.Contains("Voicemeeter", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!name.Contains("VB-Audio", StringComparison.OrdinalIgnoreCase) && !name.Contains("CABLE", StringComparison.OrdinalIgnoreCase)) continue;
                    int c = 0;
                    try { c = d.AudioClient.MixFormat.Channels; } catch { }
                    if (best is null || c > ch) { best = d.ID; ch = c; }
                }
            }
            return (best, ch);
        }
        catch { return (null, 0); }
    }

    private static int ChannelsOf(string id)
    {
        try
        {
            using var en = new MMDeviceEnumerator();
            using var d = en.GetDevice(id);
            return d.AudioClient.MixFormat.Channels;
        }
        catch { return 0; }
    }
}
