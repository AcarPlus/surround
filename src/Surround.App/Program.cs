using System.Windows;
using Surround.Desktop.Bridge;
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

        // It also installs an update that was downloaded but never applied (auto-apply on startup). The checks
        // themselves run in the background once the window is up (Bridge/AppUpdater.cs).

        using var instance = SingleInstance.TryAcquire();
        if (instance is null) return 0; // another instance exists and was asked to come to the front

        // --tray (written by "Windows ile başlat"): stay in the notification area; the window is created on first use.
        bool startInTray = args.Any(a => a.Equals(StartupRegistration.TrayArgument, StringComparison.OrdinalIgnoreCase));

        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var window = new MainWindow();
        instance.Activated += () => app.Dispatcher.InvokeAsync(window.BringToFront);
        app.SessionEnding += (_, _) => window.PrepareForSessionEnd();
        app.Exit += (_, _) => window.Shutdown();
        app.MainWindow = window;
        if (!startInTray) window.Show();
        app.Dispatcher.InvokeAsync(async () => await window.RunStartupAsync());
        return app.Run();
    }
}
