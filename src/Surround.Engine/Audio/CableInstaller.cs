using System.ComponentModel;
using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text.RegularExpressions;

namespace Surround.Engine.Audio;

/// <summary>
/// Installs VB-Cable (the virtual 7.1 cable Windows plays into) for the user: the driver is donationware by VB-Audio and
/// may not be bundled, so it is downloaded from VB-Audio's own server, its Authenticode signature checked (valid and
/// signed by VB-Audio's author), and its setup run once elevated and silently (<c>-i -h</c>). VB-Audio asks for a reboot to
/// finish; the device usually shows up right away, otherwise after the reboot.
/// </summary>
public static partial class CableInstaller
{
    public const string PackUrl = "https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack46.zip";
    public const string PageUrl = "https://vb-audio.com/Cable/";
    /// <summary>Signer of VB-Audio's executables (the code-signing certificate's subject).</summary>
    public const string Publisher = "BUREL VINCENT";
    private const int MaxZipBytes = 50 * 1024 * 1024;

    [GeneratedRegex(@"https://download\.vb-audio\.com/Download_CABLE/VBCABLE_Driver_Pack(\d+)\.zip", RegexOptions.IgnoreCase)]
    private static partial Regex PackLink();

    /// <summary>The newest driver pack linked from VB-Audio's page, or null.</summary>
    public static string? NewestPackUrl(string html)
    {
        string? best = null; int ver = -1;
        foreach (Match m in PackLink().Matches(html))
            if (int.TryParse(m.Groups[1].Value, out int v) && v > ver) { ver = v; best = m.Value; }
        return best;
    }

    /// <summary>Downloads and unpacks the driver pack into a new folder under <paramref name="workDir"/>; returns the setup to run.</summary>
    public static async Task<string> DownloadAsync(HttpClient http, string workDir, CancellationToken ct)
    {
        byte[] zip;
        try { zip = await http.GetByteArrayAsync(PackUrl, ct); }
        catch (HttpRequestException)
        {
            // A newer pack replaced this one: take the link from the download page.
            var html = await http.GetStringAsync(PageUrl, ct);
            var url = NewestPackUrl(html) ?? throw new InvalidOperationException("VB-Cable indirme bağlantısı bulunamadı.");
            zip = await http.GetByteArrayAsync(url, ct);
        }
        if (zip.Length > MaxZipBytes) throw new InvalidOperationException("VB-Cable paketi beklenenden büyük.");
        var dir = Path.Combine(workDir, "vbcable-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        using (var ms = new MemoryStream(zip))
            ZipFile.ExtractToDirectory(ms, dir); // rejects entries that would leave the folder
        string exe = Path.Combine(dir, Environment.Is64BitOperatingSystem ? "VBCABLE_Setup_x64.exe" : "VBCABLE_Setup.exe");
        if (!File.Exists(exe)) throw new InvalidOperationException("VB-Cable paketinde kurulum programı yok.");
        return exe;
    }

    /// <summary>True when <paramref name="file"/> has a valid Authenticode signature by <see cref="Publisher"/>.</summary>
    public static bool IsTrusted(string file, out string? why)
    {
        why = null;
        if (!VerifyTrust(file)) { why = "imza geçersiz"; return false; }
        try
        {
#pragma warning disable SYSLIB0057
            using var cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(file));
#pragma warning restore SYSLIB0057
            if (!cert.Subject.Contains(Publisher, StringComparison.OrdinalIgnoreCase)) { why = $"imzalayan VB-Audio değil ({cert.GetNameInfo(X509NameType.SimpleName, false)})"; return false; }
        }
        catch (Exception ex) { why = $"imza okunamadı ({ex.Message})"; return false; }
        return true;
    }

    /// <summary>
    /// Runs the setup elevated and silently; returns its exit code. Throws <see cref="OperationCanceledException"/> when the
    /// user declines the administrator prompt.
    /// </summary>
    public static int RunSetup(string exe, TimeSpan timeout)
    {
        var psi = new ProcessStartInfo(exe, "-i -h") { UseShellExecute = true, Verb = "runas", WorkingDirectory = Path.GetDirectoryName(exe)! };
        Process p;
        try { p = Process.Start(psi) ?? throw new InvalidOperationException("VB-Cable kurulumu başlamadı."); }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223) { throw new OperationCanceledException("Yönetici izni verilmedi."); }
        using (p)
        {
            if (!p.WaitForExit(timeout)) throw new TimeoutException("VB-Cable kurulumu zamanında bitmedi.");
            return p.ExitCode;
        }
    }

    // ---- WinVerifyTrust ----

    private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfo
    {
        public uint cbStruct;
        [MarshalAs(UnmanagedType.LPWStr)] public string pcwszFilePath;
        public IntPtr hFile, pgKnownSubject;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TrustData
    {
        public uint cbStruct;
        public IntPtr pPolicyCallbackData, pSIPClientData;
        public uint dwUIChoice, fdwRevocationChecks, dwUnionChoice;
        public IntPtr pFile;
        public uint dwStateAction;
        public IntPtr hWVTStateData;
        public IntPtr pwszURLReference;
        public uint dwProvFlags, dwUIContext;
        public IntPtr pSignatureSettings;
    }

    [DllImport("wintrust.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern int WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid action, ref TrustData data);

    private static bool VerifyTrust(string file)
    {
        var fi = new FileInfo { cbStruct = (uint)Marshal.SizeOf<FileInfo>(), pcwszFilePath = file };
        var pFile = Marshal.AllocHGlobal(Marshal.SizeOf<FileInfo>());
        try
        {
            Marshal.StructureToPtr(fi, pFile, false);
            var data = new TrustData
            {
                cbStruct = (uint)Marshal.SizeOf<TrustData>(),
                dwUIChoice = 2,            // WTD_UI_NONE
                fdwRevocationChecks = 0,   // WTD_REVOKE_NONE
                dwUnionChoice = 1,         // WTD_CHOICE_FILE
                pFile = pFile,
                dwStateAction = 1,         // WTD_STATEACTION_VERIFY
            };
            int r = WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, ref data);
            data.dwStateAction = 2;        // WTD_STATEACTION_CLOSE
            WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, ref data);
            return r == 0;
        }
        finally
        {
            Marshal.DestroyStructure<FileInfo>(pFile);
            Marshal.FreeHGlobal(pFile);
        }
    }
}
