using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using static Surround.Desktop.WindowFrameMath;

namespace Surround.Desktop;

/// <summary>
/// Frameless main window that keeps every native Windows behaviour. The Windows caption is taken away by answering
/// WM_NCCALCSIZE: the client area grows over the caption, while the left / right / bottom resize borders stay the
/// standard (invisible on Windows 10 / 11) ones. The window style is untouched, so Aero Snap, Win+arrow keys (and
/// Win+Z), the minimise / maximise animations, the taskbar button and icon, Alt+Tab, the system menu (Alt+Space) and
/// the DWM drop shadow all keep working. Maximised, the client area is exactly the monitor's work area.
///
/// There is no separate title bar: the app's own top row (ui/src/components/TopBar.tsx) sits at the very top of the
/// window. Dragging its empty space, double-clicking and right-clicking it, the minimise / maximise / close buttons
/// in its top-right corner and the top resize grip (ui/src/components/WindowControls.tsx) reach this class through
/// the bridge (<c>window.*</c> methods) and are handed to Windows' own move / size loop. WebView2's CSS
/// <c>app-region</c> support is deliberately not used (see MainWindow.ConfigureSettings). Any failure leaves the normal frame in place (<see cref="Active"/> false);
/// the page then draws no window buttons.
/// </summary>
public sealed class WindowFrame
{
    private const int WM_NCCALCSIZE = 0x0083, WM_NCHITTEST = 0x0084, WM_NCLBUTTONDOWN = 0x00A1, WM_SYSCOMMAND = 0x0112;
    private const int HTCLIENT = 1;
    private const int GWL_STYLE = -16;
    private const long WS_CAPTION = 0x00C00000;
    private const uint SWP_FRAMECHANGED = 0x0020, SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010;
    private const int SM_CYSIZEFRAME = 33, SM_CXPADDEDBORDER = 92;
    private const uint TPM_RETURNCMD = 0x0100, TPM_RIGHTBUTTON = 0x0002;
    private const uint MF_BYCOMMAND = 0, MF_ENABLED = 0, MF_GRAYED = 1;
    private const int SC_MOVE = 0xF010, SC_SIZE = 0xF000;
    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_BORDER_COLOR = 34;

    /// <summary>Height of the page's window buttons in DIPs (WindowControls.tsx); before the page is up, the window drags there.</summary>
    public const double TitleBarHeight = 32;
    private const double TopGrip = 5;

    private readonly Window _window;
    private IntPtr _hwnd;

    public WindowFrame(Window window)
    {
        _window = window;
        window.SourceInitialized += (_, _) => Attach();
        window.StateChanged += (_, _) => RaiseChanged();
        window.Activated += (_, _) => RaiseChanged();
        window.Deactivated += (_, _) => RaiseChanged();
    }

    /// <summary>True once the caption is gone (the page must then draw its own window buttons).</summary>
    public bool Active { get; private set; }

    public bool Maximized => _hwnd != IntPtr.Zero && IsZoomed(_hwnd);

    /// <summary>Maximised / active changed (UI thread).</summary>
    public event Action<object>? Changed;

    public object State => new { frameless = Active, maximized = Maximized, active = _window.IsActive };

    private void RaiseChanged() => Changed?.Invoke(State);

    private void Attach()
    {
        try
        {
            _hwnd = new WindowInteropHelper(_window).Handle;
            var source = HwndSource.FromHwnd(_hwnd);
            if (source is null) return;
            source.AddHook(Hook);
            Active = true;
            // Keep DWM's frame (and so its shadow) on all four sides even though the top one is now client area.
            var m = new Margins { Top = 1 };
            DwmExtendFrameIntoClientArea(_hwnd, ref m);
            SetWindowPos(_hwnd, IntPtr.Zero, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
        }
        catch (Exception ex)
        {
            Active = false;
            Bridge.AppLog.Warn("Çerçevesiz pencere kurulamadı: " + ex.Message);
        }
    }

    private IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (!Active) return IntPtr.Zero;
        try
        {
            if (msg == WM_NCCALCSIZE && wParam != IntPtr.Zero)
            {
                if ((GetWindowLongPtr(hwnd, GWL_STYLE).ToInt64() & WS_CAPTION) != WS_CAPTION) return IntPtr.Zero;
                int top0 = Marshal.ReadInt32(lParam, 4); // NCCALCSIZE_PARAMS.rgrc[0].top
                var res = DefWindowProc(hwnd, msg, wParam, lParam);
                Marshal.WriteInt32(lParam, 4, ClientTop(top0, IsZoomed(hwnd), FrameY()));
                handled = true;
                return res;
            }
            if (msg == WM_NCHITTEST)
            {
                // Only reached where the page (WebView2) does not cover the window, i.e. before it is up.
                var res = DefWindowProc(hwnd, msg, wParam, lParam);
                if (res.ToInt64() != HTCLIENT) { handled = true; return res; }
                var pt = new Point32 { X = (short)(lParam.ToInt64() & 0xFFFF), Y = (short)((lParam.ToInt64() >> 16) & 0xFFFF) };
                ScreenToClient(hwnd, ref pt);
                double scale = GetDpiForWindow(hwnd) / 96.0;
                handled = true;
                if (!IsZoomed(hwnd) && pt.Y < TopGrip * scale) return (IntPtr)HTTOP;
                if (pt.Y < TitleBarHeight * scale) return (IntPtr)HTCAPTION;
                return (IntPtr)HTCLIENT;
            }
        }
        catch { /* fall back to the default handling */ }
        return IntPtr.Zero;
    }

    /// <summary>Height of the (off-screen) top frame of a maximised window, in physical pixels.</summary>
    private int FrameY()
    {
        uint dpi = 96;
        try { dpi = GetDpiForWindow(_hwnd); } catch { }
        return GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
    }

    /// <summary>Bridge methods <c>window.*</c> (UI thread). Returns the result object for the page.</summary>
    public object? Invoke(string method, JsonElement args)
    {
        string? Arg0() => args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.String
            ? args[0].GetString() : null;

        switch (method)
        {
            case "window.state":
                return State;
            case "window.button":
            {
                int sc = SysCommandFor(Arg0(), Maximized);
                if (sc != 0 && Active) PostMessage(_hwnd, WM_SYSCOMMAND, (IntPtr)sc, IntPtr.Zero);
                return null;
            }
            case "window.resize":
            {
                int ht = HitTestForEdge(Arg0());
                if (ht != 0 && !Maximized) StartNativeLoop(ht);
                return null;
            }
            case "window.drag":
                StartNativeLoop(HTCAPTION);
                return null;
            case "window.menu":
                _window.Dispatcher.BeginInvoke(ShowSystemMenu);
                return null;
            case "window.theme":
                SetTheme(Arg0() != "light");
                return null;
            default:
                throw new Bridge.BridgeException($"Bilinmeyen pencere komutu: {method}");
        }
    }

    /// <summary>
    /// Hands the pressed mouse button to Windows' own move / size loop (snap, shake and drag-to-top-to-maximise come
    /// with it). Started after the bridge call returns so the reply is not held up by the modal loop.
    /// </summary>
    private void StartNativeLoop(int hitTest)
    {
        if (!Active) return;
        _window.Dispatcher.BeginInvoke(() =>
        {
            if (!GetCursorPos(out var p)) return;
            ReleaseCapture();
            SendMessage(_hwnd, WM_NCLBUTTONDOWN, (IntPtr)hitTest, (IntPtr)((p.Y << 16) | (p.X & 0xFFFF)));
        });
    }

    private void ShowSystemMenu()
    {
        if (!Active || !GetCursorPos(out var p)) return;
        var menu = GetSystemMenu(_hwnd, false);
        if (menu == IntPtr.Zero) return;
        bool max = Maximized;
        EnableMenuItem(menu, SC_RESTORE, MF_BYCOMMAND | (max ? MF_ENABLED : MF_GRAYED));
        EnableMenuItem(menu, SC_MOVE, MF_BYCOMMAND | (max ? MF_GRAYED : MF_ENABLED));
        EnableMenuItem(menu, SC_SIZE, MF_BYCOMMAND | (max ? MF_GRAYED : MF_ENABLED));
        EnableMenuItem(menu, SC_MAXIMIZE, MF_BYCOMMAND | (max ? MF_GRAYED : MF_ENABLED));
        EnableMenuItem(menu, SC_MINIMIZE, MF_BYCOMMAND | MF_ENABLED);
        SetMenuDefaultItem(menu, SC_CLOSE, 0);
        int cmd = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, p.X, p.Y, 0, _hwnd, IntPtr.Zero);
        if (cmd != 0) PostMessage(_hwnd, WM_SYSCOMMAND, (IntPtr)cmd, IntPtr.Zero);
    }

    /// <summary>Dark system menu / frame for the dark theme and a Windows 11 border in the theme's line colour.</summary>
    private void SetTheme(bool dark)
    {
        if (!Active) return;
        try
        {
            int v = dark ? 1 : 0;
            DwmSetWindowAttribute(_hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref v, sizeof(int));
            // index.css --line: dark 40 44 78, light 214 220 238.
            int c = (int)(dark ? ColorRef(40, 44, 78) : ColorRef(214, 220, 238));
            DwmSetWindowAttribute(_hwnd, DWMWA_BORDER_COLOR, ref c, sizeof(int)); // fails harmlessly before Windows 11
        }
        catch { }
    }

    // ---- interop ----

    [StructLayout(LayoutKind.Sequential)]
    private struct Margins { public int Left, Right, Top, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point32 { public int X, Y; }

    [DllImport("user32.dll", EntryPoint = "DefWindowProcW")]
    private static extern IntPtr DefWindowProc(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetricsForDpi(int index, uint dpi);

    [DllImport("user32.dll")]
    private static extern bool ScreenToClient(IntPtr hWnd, ref Point32 pt);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point32 pt);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll", EntryPoint = "SendMessageW")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", EntryPoint = "PostMessageW")]
    private static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetSystemMenu(IntPtr hWnd, bool revert);

    [DllImport("user32.dll")]
    private static extern bool EnableMenuItem(IntPtr menu, int item, uint flags);

    [DllImport("user32.dll")]
    private static extern bool SetMenuDefaultItem(IntPtr menu, int item, uint byPos);

    [DllImport("user32.dll")]
    private static extern int TrackPopupMenu(IntPtr menu, uint flags, int x, int y, int reserved, IntPtr hWnd, IntPtr rect);

    [DllImport("dwmapi.dll")]
    private static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref Margins margins);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hWnd, int attr, ref int value, int size);
}
