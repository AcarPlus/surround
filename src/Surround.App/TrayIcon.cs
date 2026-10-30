using System.Drawing;
using System.Windows.Forms;

namespace Surround.Desktop;

/// <summary>
/// Notification-area icon: double-click shows the window; menu = Göster, Başlat/Durdur, Çıkış.
/// Must be created and used on the UI thread (it relies on the WPF message loop).
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _toggle;
    private bool _running;

    public TrayIcon(Action show, Action toggleEngine, Action exit)
    {
        _toggle = new ToolStripMenuItem("Başlat");
        _toggle.Click += (_, _) => toggleEngine();

        var menu = new ContextMenuStrip();
        var showItem = new ToolStripMenuItem("Göster");
        showItem.Click += (_, _) => show();
        menu.Items.Add(showItem);
        menu.Items.Add(_toggle);
        menu.Items.Add(new ToolStripSeparator());
        var exitItem = new ToolStripMenuItem("Çıkış");
        exitItem.Click += (_, _) => exit();
        menu.Items.Add(exitItem);
        showItem.Font = new Font(showItem.Font, System.Drawing.FontStyle.Bold); // the default (double-click) action

        _icon = new NotifyIcon { ContextMenuStrip = menu, Icon = LoadIcon(), Visible = true };
        _icon.DoubleClick += (_, _) => show();
        SetRunning(false);
    }

    public void SetRunning(bool running)
    {
        _running = running;
        _icon.Text = running ? "Surround — çalışıyor" : "Surround — durdu";
        _toggle.Text = running ? "Durdur" : "Başlat";
    }

    public bool IsRunning => _running;

    public void Balloon(string text)
    {
        try { _icon.ShowBalloonTip(4000, "Surround", text, ToolTipIcon.Info); } catch { }
    }

    private static Icon LoadIcon()
    {
        try
        {
            var res = System.Windows.Application.GetResourceStream(new Uri("pack://application:,,,/Assets/surround.ico", UriKind.Absolute));
            if (res is not null)
            {
                using var stream = res.Stream;
                return new Icon(stream);
            }
        }
        catch { }
        try
        {
            if (Environment.ProcessPath is { } exe && Icon.ExtractAssociatedIcon(exe) is { } assoc) return assoc;
        }
        catch { }
        return SystemIcons.Application;
    }

    public void Dispose()
    {
        _icon.Visible = false; // otherwise a ghost icon lingers until the mouse passes over it
        _icon.Dispose();
    }
}
