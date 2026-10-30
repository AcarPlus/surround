using Surround.Engine;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

public class PeakMeterTests
{
    [Fact]
    public void ReportsPeakPerChannelAndResetsOnDrain()
    {
        var m = new PeakMeter();
        var frames = new float[4 * Channels.Count];
        frames[0 * 8 + Channels.FL] = 0.5f;
        frames[2 * 8 + Channels.FL] = -0.8f;   // negative counts by magnitude
        frames[1 * 8 + Channels.LFE] = 0.1f;
        frames[3 * 8 + Channels.SR] = 1.0f;
        m.Update(frames, 4);

        var peaks = new float[Channels.Count];
        m.Drain(peaks);
        Assert.Equal(0.8f, peaks[Channels.FL], 5);
        Assert.Equal(0.1f, peaks[Channels.LFE], 5);
        Assert.Equal(1.0f, peaks[Channels.SR], 5);
        Assert.Equal(0f, peaks[Channels.FR]);

        m.Drain(peaks);
        Assert.All(peaks, p => Assert.Equal(0f, p));
    }

    [Fact]
    public void HoldsMaximumAcrossUpdatesBetweenDrains()
    {
        var m = new PeakMeter();
        var a = new float[Channels.Count]; a[Channels.FC] = 0.9f;
        var b = new float[Channels.Count]; b[Channels.FC] = 0.2f;
        m.Update(a, 1);
        m.Update(b, 1);
        var peaks = new float[Channels.Count];
        m.Drain(peaks);
        Assert.Equal(0.9f, peaks[Channels.FC], 5);
    }

    [Fact]
    public void ToDbMapsFullScaleSilenceAndHalf()
    {
        Assert.Equal(0f, PeakMeter.ToDb(1f), 4);
        Assert.Equal(-90f, PeakMeter.ToDb(0f));
        Assert.Equal(-90f, PeakMeter.ToDb(1e-9f));
        Assert.Equal(-6.0206f, PeakMeter.ToDb(0.5f), 3);
        Assert.Equal(0f, PeakMeter.ToDb(4f)); // clamped
        Assert.Equal(-90f, PeakMeter.ToDb(float.NaN));
    }

    [Fact]
    public void IgnoresShortBufferAndZeroFrames()
    {
        var m = new PeakMeter();
        m.Update(new float[3], 5);
        m.Update(new float[16], 0);
        var peaks = new float[Channels.Count];
        m.Drain(peaks);
        Assert.All(peaks, p => Assert.Equal(0f, p));
    }
}
