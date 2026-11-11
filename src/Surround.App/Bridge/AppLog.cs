using Surround.Engine.Logging;

namespace Surround.Desktop.Bridge;

/// <summary>Process-wide log at %AppData%\Surround\logs: engine state changes, device changes, errors. No audio data.</summary>
public static class AppLog
{
    public static RollingLog Log { get; } = new(AppPaths.LogDir);

    public static void Info(string message) => Log.Write("BILGI", message);
    public static void Warn(string message) => Log.Write("UYARI", message);
    public static void Error(string message) => Log.Write("HATA", message);
}
