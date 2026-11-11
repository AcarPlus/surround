using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

public class DriftTests
{
    // Producer delivers srcRate in 10 ms chunks; the device clock runs at devRate*(1+ppm).
    private static (double minFill, double maxFill, long underruns, long underrunsAfterSettle, long overruns, double endCorrPpm)
        Simulate(double srcRate, double devRate, double ppm, double targetMs, double seconds, double settleSeconds)
    {
        const int ch = 2;
        var ring = new RingBuffer((int)(srcRate * 0.5) * ch, ch);
        var reader = new DriftResamplingReader(ring, ch, srcRate, devRate, targetMs);

        double tick = 0.010;
        int ticks = (int)(seconds / tick);
        var chunk = new float[(int)Math.Round(srcRate * tick) * ch];
        double devPerTick = devRate * (1 + ppm * 1e-6) * tick;
        double devAcc = 0;
        var outBuf = new float[(int)(devPerTick + 4) * ch];

        double minFill = double.MaxValue, maxFill = double.MinValue;
        long underrunsAtSettle = 0;
        for (int t = 0; t < ticks; t++)
        {
            ring.Write(chunk);
            double fillBefore = ring.Count / ch * 1000.0 / srcRate;
            devAcc += devPerTick;
            int frames = (int)devAcc;
            devAcc -= frames;
            reader.Render(outBuf.AsSpan(0, frames * ch));

            double time = t * tick;
            if (time >= settleSeconds)
            {
                if (underrunsAtSettle == 0 && time - settleSeconds < tick) underrunsAtSettle = reader.Underruns + 1;
                minFill = Math.Min(minFill, fillBefore);
                maxFill = Math.Max(maxFill, fillBefore);
            }
        }
        return (minFill, maxFill, reader.Underruns, reader.Underruns - (underrunsAtSettle - 1), reader.Overruns, reader.CorrectionPpm);
    }

    [Theory]
    [InlineData(48000, 48000, 300)]
    [InlineData(48000, 48000, -300)]
    [InlineData(44100, 48000, 300)]
    [InlineData(48000, 44100, -300)]
    public void FillStaysNearTargetUnderClockDrift(double src, double dev, double ppm)
    {
        const double target = 40;
        var r = Simulate(src, dev, ppm, target, 60, 30);
        Assert.InRange(r.minFill, target * 0.75, target * 1.25);
        Assert.InRange(r.maxFill, target * 0.75, target * 1.25);
        Assert.Equal(0, r.underruns);
        Assert.Equal(0, r.underrunsAfterSettle);
        Assert.Equal(0, r.overruns);
    }

    [Fact]
    public void ControllerConvergesToDriftPpm()
    {
        var r = Simulate(48000, 48000, 300, 40, 90, 60);
        Assert.InRange(r.endCorrPpm, -400, -200);
    }

    [Fact]
    public void ControllerClampsCorrection()
    {
        var c = new DriftController(40);
        double v = 0;
        for (int i = 0; i < 100000; i++) v = c.Update(400, 0.01);
        Assert.Equal(0.005, v, 9);
        for (int i = 0; i < 100000; i++) v = c.Update(0, 0.01);
        Assert.Equal(-0.005, v, 9);
    }

    [Fact]
    public void UnderflowOutputsSilenceAndRefillsToTarget()
    {
        const int ch = 2;
        var ring = new RingBuffer(48000 * ch, ch);
        var reader = new DriftResamplingReader(ring, ch, 48000, 48000, 40);
        ring.Write(new float[2000 * ch].Select(_ => 0.5f).ToArray()); // ~41.7 ms: primes
        var outBuf = new float[480 * ch];
        for (int i = 0; i < 10; i++) reader.Render(outBuf); // drains ring -> underrun
        Assert.True(reader.Underruns >= 1);
        Assert.All(outBuf, v => Assert.Equal(0f, v));

        ring.Write(new float[960 * ch].Select(_ => 0.5f).ToArray()); // 20 ms: below target, still silent
        reader.Render(outBuf);
        Assert.All(outBuf, v => Assert.Equal(0f, v));
        Assert.Equal(960, ring.Count / ch);
    }

    [Fact]
    public void OverflowDropsBackToTarget()
    {
        const int ch = 1;
        var ring = new RingBuffer(48000 * ch, ch);
        var reader = new DriftResamplingReader(ring, ch, 48000, 48000, 40);
        ring.Write(new float[2000]);
        reader.Render(new float[480]); // primes
        ring.Write(new float[10000]); // ~250 ms > 3x target
        reader.Render(new float[480]);
        Assert.Equal(1, reader.Overruns);
        Assert.InRange(reader.FillMs, 0, 3 * 40);
        Assert.True(ring.Count / ch < 3000);
    }

    private static DriftResamplingReader Underrun(RingBuffer ring, LatencyGroup g, double target)
    {
        var r = new DriftResamplingReader(ring, 1, 48000, 48000, target, null, g);
        ring.Write(new float[(int)(48000 * (target + 2) / 1000)]);
        var buf = new float[480];
        for (int i = 0; i < 20; i++) r.Render(buf); // drains the ring -> underrun
        return r;
    }

    [Fact]
    public void UnderrunOnOneOutputGrowsTargetOfAllOutputsInGroup()
    {
        var g = new LatencyGroup();
        var a = Underrun(new RingBuffer(48000, 1), g, 40);
        var bRing = new RingBuffer(48000, 1);
        var b = new DriftResamplingReader(bRing, 1, 48000, 48000, 40, null, g);
        Assert.True(a.Underruns >= 1);
        Assert.True(g.ExtraMs > 0);
        b.Render(new float[480]);
        Assert.Equal(a.TargetMs, b.TargetMs, 6);
        Assert.True(b.TargetMs > 40);
    }

    [Fact]
    public void GroupExtraIsCappedAndDecaysAfterQuietPeriod()
    {
        long now = 0;
        var g = new LatencyGroup(decayAfterMs: 1000, nowMs: () => now);
        for (int i = 0; i < 50; i++) g.Grow(40, 40 + g.ExtraMs, 150);
        Assert.InRange(g.ExtraMs, 1, LatencyGroup.MaxExtraMs);
        double peak = g.ExtraMs;
        now = 500; g.MaybeDecay();
        Assert.Equal(peak, g.ExtraMs);          // still within the quiet window
        now = 1500; g.MaybeDecay();
        Assert.Equal(peak - LatencyGroup.DecayStepMs, g.ExtraMs, 6);
        g.MaybeDecay();                         // next step needs another quiet period
        Assert.Equal(peak - LatencyGroup.DecayStepMs, g.ExtraMs, 6);
        for (int i = 0; i < 100; i++) { now += 1001; g.MaybeDecay(); }
        Assert.Equal(0, g.ExtraMs);
    }

    [Fact]
    public void ReadersFollowGroupDecay()
    {
        long now = 0;
        var g = new LatencyGroup(1000, () => now);
        var r = Underrun(new RingBuffer(48000, 1), g, 40);
        double grown = r.TargetMs;
        Assert.True(grown > 40);
        now = 5000;
        r.Render(new float[480]);
        Assert.True(r.TargetMs < grown);
    }
}
