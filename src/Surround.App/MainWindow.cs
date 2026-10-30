using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Surround.Desktop.Bridge;

namespace Surround.Desktop;

/// <summary>Single window hosting the React UI in WebView2. Code-only (no XAML).</summary>
public sealed class MainWindow : Window
{
    public const string VirtualHost = "app.surround";
    private const string AppOrigin = "https://" + VirtualHost + "/";

    // Matches the UI's dark --bg token (14 15 17) so nothing flashes white before the page paints.
    private static readonly System.Windows.Media.Color Backdrop = System.Windows.Media.Color.FromRgb(14, 15, 17);

    private readonly WebView2 _web;
    private readonly SurroundBackend _backend = new();
    private BridgeHost? _bridge;
    private string? _devOrigin;
    private readonly TrayIcon _tray;
    private bool _exiting;
    private bool _shutDown;

    public MainWindow()
    {
        Title = "Surround";
        MinWidth = 1024;
        MinHeight = 700;
        Width = 1280;
        Height = 800;
        Background = new SolidColorBrush(Backdrop);
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        try { Icon = BitmapFrame.Create(new Uri("pack://application:,,,/Assets/surround.ico", UriKind.Absolute)); } catch { }

        _web = new WebView2
        {
            DefaultBackgroundColor = System.Drawing.Color.FromArgb(Backdrop.R, Backdrop.G, Backdrop.B),
            CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = AppPaths.WebView2Dir },
        };
        Content = _web;

        _tray = new TrayIcon(BringToFront, () => _ = ToggleEngineAsync(), ExitApplication);
        _backend.RunningChanged += running => _ = Dispatcher.InvokeAsync(() => { if (!_shutDown) _tray.SetRunning(running); });

        Loaded += async (_, _) => await InitializeWebAsync();
        Closing += OnClosing;
        Closed += (_, _) => Shutdown();
    }

    /// <summary>Launch-time chores that do not need the page: repair the default output after a crash, auto-start the engine.</summary>
    public async Task RunStartupAsync()
    {
        var settings = _backend.Settings.Load();
        try { StartupRegistration.Apply(settings.StartWithWindows); } catch { /* keep the stored value */ }

        if (settings.StartEngineOnLaunch)
        {
            try { await _backend.StartAsync(); return; }
            catch (Exception ex)
            {
                _tray.Balloon("Motor başlatılamadı: " + (ex is BridgeException { Errors.Count: > 0 } be ? be.Errors[0] : ex.Message));
            }
        }
        // The engine is not running: if an earlier crash left the source as the default output, undo that now.
        await Task.Run(_backend.RestoreDefaultDevice);
    }

    private async Task ToggleEngineAsync()
    {
        try
        {
            if (_backend.IsRunning) await _backend.StopAsync();
            else await _backend.StartAsync();
        }
        catch (Exception ex)
        {
            _tray.Balloon((_backend.IsRunning ? "Durdurulamadı: " : "Başlatılamadı: ") +
                (ex is BridgeException { Errors.Count: > 0 } be ? be.Errors[0] : ex.Message));
        }
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_exiting || !_backend.Settings.Load().MinimizeToTray) return;
        e.Cancel = true;
        Hide();
        var s = _backend.Settings.Load();
        if (!s.TrayHintShown)
        {
            _backend.Settings.Update(x => x with { TrayHintShown = true });
            _tray.Balloon("Surround arka planda çalışıyor");
        }
    }

    /// <summary>Really quits (tray "Çıkış"): stops the engine and restores the default output.</summary>
    public void ExitApplication()
    {
        _exiting = true;
        Close();
    }

    /// <summary>Windows is ending the session: do the cleanup now and never block the shutdown by hiding to tray.</summary>
    public void PrepareForSessionEnd()
    {
        _exiting = true;
        Shutdown();
    }

    private async Task InitializeWebAsync()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.WebView2Dir);
            await _web.EnsureCoreWebView2Async();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this,
                "Arayüz bileşeni (Microsoft Edge WebView2 Runtime) başlatılamadı.\n" +
                "Windows 10/11'de genellikle yüklüdür; değilse Microsoft'un WebView2 Runtime paketini kurun.\n\n" + ex.Message,
                "Surround", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
            return;
        }

        var core = _web.CoreWebView2;
        ConfigureSettings(core.Settings);

        var devUrl = DevUrl();
        if (devUrl is not null) _devOrigin = new Uri(devUrl).GetLeftPart(UriPartial.Authority) + "/";

        // The app never leaves its own origin: no external navigation, no pop-up windows (and so no browser).
        core.NavigationStarting += (_, e) => { if (!IsTrusted(e.Uri)) e.Cancel = true; };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.DownloadStarting += (_, e) => e.Cancel = true;

        _bridge = new BridgeHost(core, _backend, Dispatcher, IsTrusted);

        string uiDir = Path.Combine(AppContext.BaseDirectory, "ui");
        if (devUrl is null)
        {
            if (!File.Exists(Path.Combine(uiDir, "index.html")))
            {
                core.NavigateToString(MissingUiPage(uiDir));
                return;
            }
            core.SetVirtualHostNameToFolderMapping(VirtualHost, uiDir, CoreWebView2HostResourceAccessKind.DenyCors);
            core.Navigate(AppOrigin + "index.html");
        }
        else
        {
            core.Navigate(devUrl);
        }
    }

    private static void ConfigureSettings(CoreWebView2Settings s)
    {
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsSwipeNavigationEnabled = false;
#if DEBUG
        s.AreDevToolsEnabled = true;
        s.AreDefaultContextMenusEnabled = true;
        s.AreBrowserAcceleratorKeysEnabled = true;
#else
        // Release: behave like an app, not a browser (no devtools, context menu, Ctrl+R/F5/Ctrl+P ...).
        s.AreDevToolsEnabled = false;
        s.AreDefaultContextMenusEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
#endif
    }

    /// <summary>Vite dev server address; honoured in Debug builds only.</summary>
    private static string? DevUrl()
    {
#if DEBUG
        var v = Environment.GetEnvironmentVariable("SURROUND_DEV_URL");
        return Uri.TryCreate(v, UriKind.Absolute, out var u) && (u.Scheme is "http" or "https") ? u.ToString() : null;
#else
        return null;
#endif
    }

    private bool IsTrusted(string uri) =>
        uri.StartsWith(AppOrigin, StringComparison.OrdinalIgnoreCase) ||
        uri.StartsWith("data:text/html", StringComparison.OrdinalIgnoreCase) || // NavigateToString page
        (_devOrigin is not null && uri.StartsWith(_devOrigin, StringComparison.OrdinalIgnoreCase));

    private static string MissingUiPage(string dir) =>
        "<!doctype html><meta charset=utf-8><body style=\"background:#0e0f11;color:#e6e8eb;font:14px Segoe UI,sans-serif;padding:32px\">" +
        "<h3>Arayüz dosyaları bulunamadı</h3><p>Beklenen konum: <code>" + System.Net.WebUtility.HtmlEncode(dir) + "</code></p>" +
        "<p>Önce <code>npm --prefix ui run build</code> çalıştırıp uygulamayı yeniden derleyin (build.ps1 bunu yapar).</p>";

    /// <summary>Idempotent (window Closed, session end and Application.Exit all lead here).</summary>
    public void Shutdown()
    {
        if (_shutDown) return;
        _shutDown = true;
        _bridge?.Dispose();
        _backend.Dispose(); // stops the engine and restores the default output device
        _tray.Dispose();
        _web.Dispose();
    }

    /// <summary>Brings the window to the foreground (second launch).</summary>
    public void BringToFront()
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Show();
        Activate();
        Topmost = true;  // foreground-lock workaround
        Topmost = false;
        Focus();
    }
}
