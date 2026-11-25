using Surround.Desktop;
using static Surround.Desktop.WindowFrameMath;

namespace Surround.Engine.Tests;

public class WindowFrameTests
{
    [Theory]
    [InlineData("top", HTTOP)]
    [InlineData("topleft", HTTOPLEFT)]
    [InlineData("topright", HTTOPRIGHT)]
    [InlineData("left", 0)] // left / right / bottom stay the window's own borders
    [InlineData("", 0)]
    [InlineData(null, 0)]
    public void OnlyTopEdgesComeFromThePage(string? edge, int expected) => Assert.Equal(expected, HitTestForEdge(edge));

    [Fact]
    public void MaximiseButtonTogglesLikeTheNativeOne()
    {
        Assert.Equal(SC_MAXIMIZE, SysCommandFor("maximize", maximized: false));
        Assert.Equal(SC_RESTORE, SysCommandFor("maximize", maximized: true));
        Assert.Equal(SC_MINIMIZE, SysCommandFor("minimize", false));
        Assert.Equal(SC_CLOSE, SysCommandFor("close", true));
        Assert.Equal(0, SysCommandFor("explode", false));
    }

    [Fact]
    public void CaptionBecomesClientAreaAndMaximisedClientIsTheWorkArea()
    {
        // Normal: the client area starts at the window's top (no caption).
        Assert.Equal(100, ClientTop(100, maximized: false, frameY: 8));
        // Maximised: the window top is frameY above the work area; only that off-screen part stays cut off.
        Assert.Equal(0, ClientTop(-8, maximized: true, frameY: 8));
    }

    [Fact]
    public void ColorRefIsBgr() => Assert.Equal(0x004E2C28u, ColorRef(40, 44, 78));
}
