using Microsoft.Win32;

namespace Surround.Desktop.Bridge;

/// <summary>"Windows ile başlat": the HKCU Run value "Surround", launching the app minimized to the tray (<c>--tray</c>).</summary>
public static class StartupRegistration
{
    public const string TrayArgument = "--tray";
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "Surround";

    /// <summary>The Run command line for <paramref name="exePath"/>.</summary>
    public static string BuildCommand(string exePath) => $"\"{exePath}\" {TrayArgument}";

    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            return key?.GetValue(ValueName) is string;
        }
        catch { return false; }
    }

    /// <summary>Adds (or refreshes) or removes the Run value. Throws if the registry cannot be written.</summary>
    public static void Apply(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true);
        if (enabled) key.SetValue(ValueName, BuildCommand(ResolveExePath()), RegistryValueKind.String);
        else key.DeleteValue(ValueName, throwOnMissingValue: false);
    }

    /// <summary>
    /// Velopack installs keep a stable launcher in the install root (%LocalAppData%\Surround\Surround.exe) that survives
    /// updates, while the real exe lives in a versioned "current" folder. Prefer the launcher; otherwise this process.
    /// </summary>
    public static string ResolveExePath()
    {
        string self = Environment.ProcessPath ?? throw new InvalidOperationException("Uygulama yolu bulunamadı.");
        try
        {
            var loc = Velopack.Locators.VelopackLocator.Current;
            if (!loc.IsPortable && !string.IsNullOrEmpty(loc.RootAppDir) && !string.IsNullOrEmpty(loc.UpdateExePath) && File.Exists(loc.UpdateExePath))
            {
                string stub = Path.Combine(loc.RootAppDir, Path.GetFileName(self));
                if (File.Exists(stub)) return stub;
            }
        }
        catch { /* not a Velopack install (dev build) */ }
        return self;
    }
}
