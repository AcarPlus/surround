namespace Surround.Desktop.Bridge;

public static class AppPaths
{
    /// <summary>
    /// Ortam değişkeni: ayrı (geçici) bir veri klasörüyle çalıştırmak için (ölçüm, deneme). Doluysa yapılandırma, kayıtlar
    /// ve WebView2 önbelleği bu klasöre gider; kurulu uygulamanın ayarlarına, "Windows ile başlat" kaydına ve
    /// güncellemelere dokunulmaz, tek örnek kilidi de ayrıdır (kurulu uygulama açıkken de çalışır).
    /// </summary>
    public const string IsolatedDirVariable = "SURROUND_DATA_DIR";

    /// <summary>Ayrı veri klasörü (bkz. <see cref="IsolatedDirVariable"/>); yoksa null.</summary>
    public static string? IsolatedDir { get; } = ReadIsolatedDir();

    public static bool IsIsolated => IsolatedDir is not null;

    private static string? ReadIsolatedDir()
    {
        var v = Environment.GetEnvironmentVariable(IsolatedDirVariable);
        return string.IsNullOrWhiteSpace(v) || !Path.IsPathFullyQualified(v.Trim()) ? null : Path.GetFullPath(v.Trim());
    }

    /// <summary>%AppData%\Surround: kullanıcı yapılandırması. Velopack kurulum kökünün
    /// (%LocalAppData%\Surround) dışında tutulur, böylece kaldırma/güncelleme silmez.</summary>
    public static string DataDir { get; } = IsolatedDir ?? Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Surround");

    /// <summary>%LocalAppData%\Surround\WebView2: yalnızca önbellek; kaldırmada silinmesi sorun değil.</summary>
    public static string CacheDir { get; } = IsolatedDir is { } iso ? Path.Combine(iso, "cache") : Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Surround");

    /// <summary>%AppData%\Surround\logs: günlük dosyaları (surround-YYYYMMDD.log).</summary>
    public static string LogDir => Path.Combine(DataDir, "logs");
    public static string ConfigFile => Path.Combine(DataDir, "config.json");
    /// <summary>Uygulama ayarları (varsayılan cihaz, Windows ile başlat, tepsi ...); motor yapılandırmasından ayrı.</summary>
    public static string AppSettingsFile => Path.Combine(DataDir, "app.json");
    public static string WebView2Dir => Path.Combine(CacheDir, "WebView2");
}
