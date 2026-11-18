using System.ComponentModel;
using System.Diagnostics;

namespace Surround.Engine.Phone;

/// <summary>
/// Windows Firewall for the phone link. Without an allow rule (or with the block rules Windows adds when its
/// "allow access" prompt is dismissed, or on a network marked Public) the phone's connection times out. <see cref="Allow"/>
/// replaces every rule for this program with one inbound allow rule: TCP <see cref="PhoneLink.DefaultPort"/>..+9, from the
/// local subnet only, on every profile (so a home network left as "Public" works too). It needs one UAC confirmation.
/// </summary>
public static class PhoneFirewall
{
    public const string RuleName = "Surround telefon kalibrasyonu";
    private const int NetFwRuleDirIn = 1, NetFwActionBlock = 0;

    /// <summary>
    /// true: an enabled inbound allow rule for <paramref name="exe"/> covers the current network profile and no block rule
    /// does; false: not allowed; null: unknown (the firewall API failed).
    /// </summary>
    public static bool? IsAllowed(string exe)
    {
        try
        {
            var type = Type.GetTypeFromProgID("HNetCfg.FwPolicy2");
            if (type is null) return null;
            dynamic policy = Activator.CreateInstance(type)!;
            int current = policy.CurrentProfileTypes;
            bool enabledFw = false;
            foreach (int p in new[] { 1, 2, 4 })
                if ((current & p) != 0 && (bool)policy.FirewallEnabled[p]) enabledFw = true;
            if (!enabledFw) return true; // firewall off for the active network
            bool allow = false, block = false;
            foreach (dynamic r in policy.Rules)
            {
                string? app = r.ApplicationName;
                if (string.IsNullOrEmpty(app) || !SamePath(app, exe)) continue;
                if (!(bool)r.Enabled || (int)r.Direction != NetFwRuleDirIn) continue;
                if (((int)r.Profiles & current) == 0) continue;
                if ((int)r.Action == NetFwActionBlock) block = true;
                else allow = true;
            }
            return allow && !block;
        }
        catch { return null; }
    }

    private static bool SamePath(string a, string b)
    {
        try
        {
            return string.Equals(Path.GetFullPath(Environment.ExpandEnvironmentVariables(a)), Path.GetFullPath(b),
                StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    /// <summary>The elevated command: drop this program's rules (also Windows' own block rules), add ours.</summary>
    public static string Arguments(string exe)
    {
        if (exe.Contains('"')) throw new ArgumentException("Geçersiz program yolu.", nameof(exe));
        int lo = PhoneLink.DefaultPort, hi = PhoneLink.DefaultPort + 9;
        return $"/c netsh advfirewall firewall delete rule name=all program=\"{exe}\" >nul & " +
               $"netsh advfirewall firewall add rule name=\"{RuleName}\" dir=in action=allow program=\"{exe}\" " +
               $"protocol=TCP localport={lo}-{hi} remoteip=localsubnet profile=any enable=yes";
    }

    /// <summary>Runs <see cref="Arguments"/> elevated (one UAC prompt). Returns false when the user declined or it failed.</summary>
    public static bool Allow(string exe, out string? error)
    {
        error = null;
        var psi = new ProcessStartInfo("cmd.exe", Arguments(exe))
        {
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        try
        {
            using var p = Process.Start(psi);
            if (p is null) { error = "İzin komutu başlatılamadı."; return false; }
            if (!p.WaitForExit(30000)) { error = "İzin komutu yanıt vermedi."; return false; }
            if (p.ExitCode != 0) { error = $"Güvenlik duvarı kuralı eklenemedi (kod {p.ExitCode})."; return false; }
            return true;
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            error = "Yönetici onayı verilmedi.";
            return false;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }
}
