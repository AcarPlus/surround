namespace Surround.Desktop;

/// <summary>
/// The pure (WPF-free, testable) part of the frameless main window (<see cref="WindowFrame"/>): which hit-test code
/// a resize grip of the page's title bar stands for, and which system command a title-bar button sends.
/// </summary>
public static class WindowFrameMath
{
    public const int HTCAPTION = 2, HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;
    public const int SC_MINIMIZE = 0xF020, SC_MAXIMIZE = 0xF030, SC_RESTORE = 0xF120, SC_CLOSE = 0xF060;

    /// <summary>
    /// The page's title bar can only start the top-edge resizes (left, right and bottom are the window's own invisible
    /// resize borders, which stay native). Unknown edges give 0.
    /// </summary>
    public static int HitTestForEdge(string? edge) => edge switch
    {
        "top" => HTTOP,
        "topleft" => HTTOPLEFT,
        "topright" => HTTOPRIGHT,
        _ => 0,
    };

    /// <summary>The WM_SYSCOMMAND for a caption button (0 = not a button); maximise toggles like the native one.</summary>
    public static int SysCommandFor(string? button, bool maximized) => button switch
    {
        "minimize" => SC_MINIMIZE,
        "maximize" => maximized ? SC_RESTORE : SC_MAXIMIZE,
        "close" => SC_CLOSE,
        _ => 0,
    };

    /// <summary>
    /// Top of the client area after WM_NCCALCSIZE: the caption becomes client area. Maximised, Windows pushes the
    /// frame beyond the monitor edge, so only that (off-screen) part stays cut off and the client area equals the
    /// monitor's work area.
    /// </summary>
    public static int ClientTop(int windowTop, bool maximized, int frameY) => windowTop + (maximized ? frameY : 0);

    /// <summary>Colour for DWMWA_BORDER_COLOR (COLORREF 0x00BBGGRR).</summary>
    public static uint ColorRef(byte r, byte g, byte b) => (uint)(r | (g << 8) | (b << 16));
}
