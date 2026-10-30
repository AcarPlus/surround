using System.Windows;
using Velopack;

namespace Surround.Desktop;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        // Must be the very first thing: handles installer/updater hooks (install, uninstall, updated ...)
        // and exits the process for them before any UI starts.
        VelopackApp.Build().Run();

        // TODO(update): once a release feed exists (e.g. a GitHub repo), check for updates here or in the
        // background after the window is up:
        //   var mgr = new Velopack.UpdateManager(new Velopack.Sources.GithubSource("https://github.com/<owner>/<repo>", null, false));
        //   var update = await mgr.CheckForUpdatesAsync();
        //   if (update != null) { await mgr.DownloadUpdatesAsync(update); mgr.ApplyUpdatesAndRestart(update); }

        using var instance = SingleInstance.TryAcquire();
        if (instance is null) return 0; // another instance exists and was asked to come to the front

        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var window = new MainWindow();
        instance.Activated += () => app.Dispatcher.InvokeAsync(window.BringToFront);
        app.MainWindow = window;
        window.Show();
        return app.Run();
    }
}
