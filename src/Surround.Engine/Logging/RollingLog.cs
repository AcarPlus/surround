using System.Text;

namespace Surround.Engine.Logging;

/// <summary>
/// Small daily-rolling text log (<c>surround-YYYYMMDD.log</c>): files older than <see cref="KeepDays"/> days are deleted,
/// a day's file stops growing at <see cref="MaxBytes"/> (a note is written once). Holds no audio data. Never throws.
/// </summary>
public sealed class RollingLog
{
    public const int KeepDays = 7;
    public const long MaxBytes = 5 * 1024 * 1024;

    private readonly string _dir;
    private readonly Func<DateTime> _now;
    private readonly object _gate = new();
    private DateTime _lastCleanup = DateTime.MinValue;
    private string? _fullFor;

    public RollingLog(string dir, Func<DateTime>? now = null)
    {
        _dir = dir;
        _now = now ?? (() => DateTime.Now);
    }

    public string Directory => _dir;

    public string PathFor(DateTime day) => Path.Combine(_dir, $"surround-{day:yyyyMMdd}.log");

    public void Write(string level, string message)
    {
        try
        {
            lock (_gate)
            {
                var now = _now();
                System.IO.Directory.CreateDirectory(_dir);
                string path = PathFor(now);
                if (now - _lastCleanup > TimeSpan.FromHours(6)) { Cleanup(now); _lastCleanup = now; }

                var info = new FileInfo(path);
                if (info.Exists && info.Length >= MaxBytes)
                {
                    if (_fullFor == path) return;
                    _fullFor = path;
                    File.AppendAllText(path, $"{now:HH:mm:ss.fff} [UYARI] Günlük dosyası sınıra ulaştı; bugün için kayıt durduruldu.{Environment.NewLine}", Encoding.UTF8);
                    return;
                }
                message = message.Replace("\r", " ").Replace("\n", " ");
                File.AppendAllText(path, $"{now:HH:mm:ss.fff} [{level}] {message}{Environment.NewLine}", Encoding.UTF8);
            }
        }
        catch { /* logging must never break the app */ }
    }

    private void Cleanup(DateTime now)
    {
        try
        {
            var limit = now.Date.AddDays(-(KeepDays - 1));
            foreach (var f in System.IO.Directory.GetFiles(_dir, "surround-*.log"))
            {
                string stamp = Path.GetFileNameWithoutExtension(f)["surround-".Length..];
                if (DateTime.TryParseExact(stamp, "yyyyMMdd", null, System.Globalization.DateTimeStyles.None, out var day) && day < limit)
                    File.Delete(f);
            }
        }
        catch { }
    }
}
