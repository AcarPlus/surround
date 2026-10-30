namespace Surround.Desktop.Bridge;

public static class AppPaths
{
    /// <summary>%AppData%\Surround: kullanıcı yapılandırması. Velopack kurulum kökünün
    /// (%LocalAppData%\Surround) dışında tutulur, böylece kaldırma/güncelleme silmez.</summary>
    public static string DataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Surround");

    /// <summary>%LocalAppData%\Surround\WebView2: yalnızca önbellek; kaldırmada silinmesi sorun değil.</summary>
    public static string CacheDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Surround");

    public static string ConfigFile => Path.Combine(DataDir, "config.json");
    /// <summary>Uygulama ayarları (varsayılan cihaz, Windows ile başlat, tepsi ...); motor yapılandırmasından ayrı.</summary>
    public static string AppSettingsFile => Path.Combine(DataDir, "app.json");
    public static string WebView2Dir => Path.Combine(CacheDir, "WebView2");
}
