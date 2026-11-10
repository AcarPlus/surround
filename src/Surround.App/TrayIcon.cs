using System.Drawing;
using System.Windows.Forms;

namespace Surround.Desktop;

/// <summary>
/// Notification-area icon: double-click shows the window; menu = Göster, Başlat/Durdur, Profil ▸, Çıkış.
/// Must be created and used on the UI thread (it relies on the WPF message loop).
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _toggle;
    private readonly ToolStripMenuItem _profiles;
    private readonly Action<string> _selectProfile;
    private bool _running;

    public TrayIcon(Action show, Action toggleEngine, Action<string> selectProfile, Action exit)
    {
        _selectProfile = selectProfile;
        _profiles = new ToolStripMenuItem("Profil") { Visible = false };
        _toggle = new ToolStripMenuItem("Başlat");
        _toggle.Click += (_, _) => toggleEngine();

        var menu = new ContextMenuStrip();
        var showItem = new ToolStripMenuItem("Göster");
        showItem.Click += (_, _) => show();
        menu.Items.Add(showItem);
        menu.Items.Add(_toggle);
        menu.Items.Add(_profiles);
        menu.Items.Add(new ToolStripSeparator());
        var exitItem = new ToolStripMenuItem("Çıkış");
        exitItem.Click += (_, _) => exit();
        menu.Items.Add(exitItem);
        showItem.Font = new Font(showItem.Font, System.Drawing.FontStyle.Bold); // the default (double-click) action

        _icon = new NotifyIcon { ContextMenuStrip = menu, Icon = LoadIcon(), Visible = true };
        _icon.DoubleClick += (_, _) => show();
        SetRunning(false);
    }

    /// <param name="waiting">Stopped by a device change, restarts on its own (Durdur cancels it).</param>
    public void SetRunning(bool running, bool waiting = false)
    {
        _running = running;
        _icon.Text = waiting ? "Surround — cihaz bekleniyor" : running ? "Surround — çalışıyor" : "Surround — durdu";
        _toggle.Text = running ? "Durdur" : "Başlat";
    }

    public bool IsRunning => _running;

    /// <summary>Rebuilds the "Profil" submenu (hidden while there are no profiles); the active one is ticked.</summary>
    public void SetProfiles(IReadOnlyList<Surround.Engine.Config.ProfileEntry> profiles, string? activeId)
    {
        _profiles.DropDownItems.Clear();
        foreach (var p in profiles)
        {
            var id = p.Id;
            // '&' would turn the next letter into a mnemonic instead of showing it.
            var item = new ToolStripMenuItem(p.Name.Replace("&", "&&")) { Checked = id == activeId };
            item.Click += (_, _) => _selectProfile(id);
            _profiles.DropDownItems.Add(item);
        }
        _profiles.Visible = profiles.Count > 0;
        var active = profiles.FirstOrDefault(p => p.Id == activeId);
        _profiles.Text = active is null ? "Profil" : $"Profil: {active.Name.Replace("&", "&&")}";
    }

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
