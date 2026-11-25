using System.Diagnostics;

namespace Surround.Desktop.Bridge;

/// <summary>
/// Launch timing, in ms since the process started: each step is logged once ("Açılış: …"), and once the page has its
/// data and the engine decision is made, one summary line. Steps: main (Main entered), velopack, window (constructed),
/// shown (first frame on screen), webview (WebView2 ready), navigate, page (navigation completed), ui-paint (first
/// React frame), ui-init (config and devices shown), engine (auto-start done or skipped).
/// </summary>
public static class StartupTrace
{
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly double Offset = ProcessAgeMs();
    private static readonly object Gate = new();
    private static readonly List<(string Step, double Ms)> Marks = new();
    private static bool _summarized;

    private static double ProcessAgeMs()
    {
        try
        {
            using var p = Process.GetCurrentProcess();
            return Math.Max(0, (DateTime.Now - p.StartTime).TotalMilliseconds);
        }
        catch { return 0; }
    }

    /// <summary>Milliseconds since the process started.</summary>
    public static double Now => Offset + Clock.Elapsed.TotalMilliseconds;

    /// <summary>Records <paramref name="step"/> the first time it is reached (later calls are ignored).</summary>
    public static void Mark(string step)
    {
        double ms = Now;
        string? summary = null;
        lock (Gate)
        {
            if (_summarized || Marks.Any(m => m.Step == step)) return;
            Marks.Add((step, ms));
            if (Marks.Any(m => m.Step == "ui-init") && Marks.Any(m => m.Step == "engine"))
            {
                _summarized = true;
                summary = string.Join(", ", Marks.OrderBy(m => m.Ms).Select(m => $"{m.Step} {m.Ms:0}"));
            }
        }
        AppLog.Info($"Açılış: {step} {ms:0} ms");
        if (summary != null) AppLog.Info($"Açılış süreleri (ms): {summary}");
    }

    /// <summary>The recorded steps so far (tests, diagnostics).</summary>
    public static IReadOnlyList<(string Step, double Ms)> Snapshot()
    {
        lock (Gate) return Marks.ToList();
    }
}
