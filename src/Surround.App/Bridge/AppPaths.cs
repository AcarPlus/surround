namespace Surround.Desktop.Bridge;

public static class AppPaths
{
    /// <summary>
    /// Deneme çalıştırması: <c>SURROUND_DATA_DIR</c> ayarlıysa yapılandırma, günlük ve WebView2 önbelleği oraya gider;
    /// kurulu uygulamanın ayarlarına, "Windows ile başlat" kaydına ve güncellemelerine dokunulmaz.
    /// </summary>
    private static readonly string? Redirect = RedirectDir();

    public static bool IsRedirected => Redirect is not null;

    /// <summary>%AppData%\Surround: kullanıcı yapılandırması. Velopack kurulum kökünün
    /// (%LocalAppData%\Surround) dışında tutulur, böylece kaldırma/güncelleme silmez.</summary>
    public static string DataDir { get; } = Redirect ?? Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Surround");

    /// <summary>%LocalAppData%\Surround\WebView2: yalnızca önbellek; kaldırmada silinmesi sorun değil.</summary>
    public static string CacheDir { get; } = Redirect is not null ? Path.Combine(Redirect, "cache") : Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Surround");

    private static string? RedirectDir()
    {
        var v = Environment.GetEnvironmentVariable("SURROUND_DATA_DIR");
        return string.IsNullOrWhiteSpace(v) ? null : Path.GetFullPath(v);
    }

    /// <summary>%AppData%\Surround\logs: günlük dosyaları (surround-YYYYMMDD.log).</summary>
    public static string LogDir => Path.Combine(DataDir, "logs");
    public static string ConfigFile => Path.Combine(DataDir, "config.json");
    /// <summary>Uygulama ayarları (varsayılan cihaz, Windows ile başlat, tepsi ...); motor yapılandırmasından ayrı.</summary>
    public static string AppSettingsFile => Path.Combine(DataDir, "app.json");
    public static string WebView2Dir => Path.Combine(CacheDir, "WebView2");
}
