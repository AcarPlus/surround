using Velopack;
using Velopack.Sources;

namespace Surround.Desktop.Bridge;

/// <summary>
/// state: "unsupported" (not an installed copy, e.g. a dev build), "idle" (up to date or not checked yet), "checking",
/// "downloading" (progress 0..100), "ready" (version downloaded; applied on restart or on the next launch), "error".
/// </summary>
public sealed record UpdateDto(string State, string Current, string? Version = null, int Progress = 0, string? Message = null);

/// <summary>
/// Automatic updates from the GitHub releases (Velopack feed: releases.win.json + nupkg). Checks shortly after launch and
/// then every few hours, downloads in the background, and leaves the restart to the user; a downloaded update that was
/// never applied is installed on the next launch (VelopackApp auto-apply).
/// </summary>
public sealed class AppUpdater : IDisposable
{
    public const string RepoUrl = "https://github.com/AcarPlus/surround";
    public const string SourceOverrideVariable = "SURROUND_UPDATE_SOURCE";
    private static readonly TimeSpan FirstCheck = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    private readonly UpdateManager? _mgr;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _gate = new(1, 1);
    private UpdateInfo? _ready;
    private UpdateDto _state;
    private int _started;

    /// <summary>The update state changed, on a worker thread.</summary>
    public event Action<UpdateDto>? Changed;

    public AppUpdater()
    {
        string current = typeof(AppUpdater).Assembly.GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "?";
        try
        {
            // Test hook: a local folder (or URL) with a build.ps1 release output instead of GitHub.
            string? local = Environment.GetEnvironmentVariable(SourceOverrideVariable);
            var mgr = string.IsNullOrWhiteSpace(local)
                ? new UpdateManager(new GithubSource(RepoUrl, null, false))
                : new UpdateManager(local.Trim());
            if (!string.IsNullOrWhiteSpace(local)) AppLog.Info($"Güncelleme kaynağı (test): {local}");
            if (mgr.IsInstalled)
            {
                _mgr = mgr;
                current = mgr.CurrentVersion?.ToString() ?? current;
            }
        }
        catch (Exception ex) { AppLog.Warn($"Güncelleme denetleyicisi kurulamadı: {ex.Message}"); }
        _state = new UpdateDto(_mgr is null ? "unsupported" : "idle", current);
    }

    public UpdateDto State => _state;

    /// <summary>Starts the background checks (once).</summary>
    public void StartBackground()
    {
        if (_mgr is null || Interlocked.Exchange(ref _started, 1) != 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(FirstCheck, _cts.Token);
                while (!_cts.IsCancellationRequested)
                {
                    await CheckAsync();
                    if (_ready != null) return; // nothing more to do until the restart
                    await Task.Delay(Interval, _cts.Token);
                }
            }
            catch (OperationCanceledException) { }
        });
    }

    /// <summary>Checks now and downloads a newer release; returns the resulting state. Never throws.</summary>
    public async Task<UpdateDto> CheckAsync()
    {
        if (_mgr is null) return _state;
        if (!await _gate.WaitAsync(0)) return _state; // a check is already running
        try
        {
            if (_ready != null) return _state;
            Set(_state with { State = "checking", Message = null, Progress = 0 });
            var info = await _mgr.CheckForUpdatesAsync();
            if (info is null)
            {
                Set(_state with { State = "idle", Version = null });
                return _state;
            }
            string version = info.TargetFullRelease.Version.ToString();
            AppLog.Info($"Güncelleme bulundu: {version}, indiriliyor");
            Set(_state with { State = "downloading", Version = version, Progress = 0 });
            int last = -1;
            await _mgr.DownloadUpdatesAsync(info, p =>
            {
                if (p / 5 == last / 5) return;
                last = p;
                Set(_state with { Progress = p });
            }, _cts.Token);
            _ready = info;
            AppLog.Info($"Güncelleme indirildi: {version}");
            Set(_state with { State = "ready", Progress = 100 });
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            AppLog.Warn($"Güncelleme denetlenemedi: {ex.Message}");
            Set(_state with { State = "error", Message = ex.Message });
        }
        finally { _gate.Release(); }
        return _state;
    }

    /// <summary>
    /// Hands the downloaded update to the Velopack updater, which waits for this process to exit, installs it and starts
    /// the new version. The caller then exits normally (engine stop, default output restored). false = nothing to apply.
    /// </summary>
    public bool PrepareRestart()
    {
        if (_mgr is null || _ready is null) return false;
        AppLog.Info($"Güncelleme uygulanıyor: {_ready.TargetFullRelease.Version}");
        _mgr.WaitExitThenApplyUpdates(_ready.TargetFullRelease, silent: false, restart: true);
        return true;
    }

    private void Set(UpdateDto s)
    {
        _state = s;
        try { Changed?.Invoke(s); } catch (Exception ex) { AppLog.Warn($"Güncelleme bildirimi: {ex.Message}"); }
    }

    public void Dispose()
    {
        _cts.Cancel();
    }
}
