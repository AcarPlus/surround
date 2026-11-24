using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

public class DemoPlayerTests
{
    [Theory]
    [InlineData(0)] [InlineData(15)] [InlineData(-60)] [InlineData(120)] [InlineData(180)] [InlineData(-170)]
    public void PanKeepsPowerAndUsesNeighbours(double az)
    {
        var g = new float[Channels.Count];
        DemoPlayer.Pan(az, g);
        Assert.Equal(1.0, g.Sum(x => x * x), 3);
        Assert.True(g.Count(x => x > 0.001f) <= 2);
    }

    [Fact]
    public void PanHitsChannelsAtTheirAngles()
    {
        var g = new float[Channels.Count];
        DemoPlayer.Pan(90, g); Assert.Equal(1f, g[Channels.SR], 3);
        DemoPlayer.Pan(-30, g); Assert.Equal(1f, g[Channels.FL], 3);
        DemoPlayer.Pan(180, g); Assert.Equal(g[Channels.BL], g[Channels.BR], 3);
    }

    [Fact]
    public void TrajectoriesMatchTheUiFormulas()
    {
        Assert.Equal(0, DemoPlayer.Azimuth(DemoScene.Orbit, 0), 6);
        Assert.Equal(90, DemoPlayer.Azimuth(DemoScene.Orbit, 2.5), 6);
        Assert.Equal(-90, DemoPlayer.Azimuth(DemoScene.Orbit, 7.5), 6);
        Assert.Equal(-90, DemoPlayer.Azimuth(DemoScene.PingPong, 0), 6);
        Assert.Equal(90, DemoPlayer.Azimuth(DemoScene.PingPong, 1.5), 6);
        Assert.Equal(-90, DemoPlayer.Azimuth(DemoScene.PingPong, 3), 6);
        Assert.Equal(0, DemoPlayer.Azimuth(DemoScene.PingPong, 0.75), 6);
        Assert.Equal(15, DemoPlayer.Duration(DemoScene.PingPong), 6);
        Assert.Equal(180, DemoPlayer.Azimuth(DemoScene.Flyby, 7), 6);
        Assert.Equal(30, DemoPlayer.Azimuth(DemoScene.Speakers, 2.5), 6);
    }

    [Fact]
    public void PingPongStrikesTheLeftThenTheRightSide()
    {
        const int fs = 48000, block = 480;
        var p = new DemoPlayer(DemoScene.PingPong, fs);
        var buf = new float[block * Channels.Count];
        double left = 0, right = 0, leftLate = 0, rightLate = 0;
        for (int i = 0; i < (int)(1.6 * fs / block); i++)
        {
            p.Process(buf, block);
            double t = (double)(i + 1) * block / fs;
            for (int f = 0; f < block; f++)
            {
                float l = buf[f * Channels.Count + Channels.SL], r = buf[f * Channels.Count + Channels.SR];
                if (t < 0.1) { left += l * l; right += r * r; }
                else if (t > 1.5) { leftLate += l * l; rightLate += r * r; }
            }
        }
        Assert.True(left > 10 * right, "ilk vurus solda olmali");
        Assert.True(rightLate > 10 * leftLate, "1,5 sn'de vurus sagda olmali");
    }

    [Theory]
    [InlineData(DemoScene.Orbit)] [InlineData(DemoScene.PingPong)] [InlineData(DemoScene.Flyby)] [InlineData(DemoScene.Speakers)]
    public void ProducesBoundedSoundAndFinishes(DemoScene scene)
    {
        const int fs = 48000, block = 480;
        var p = new DemoPlayer(scene, fs);
        var buf = new float[block * Channels.Count];
        double energy = 0; float peak = 0;
        int blocks = (int)(p.DurationSeconds * fs / block) + 10;
        for (int i = 0; i < blocks; i++)
        {
            Array.Fill(buf, 0.9f); // kaynak sesi: demo bunu siler
            p.Process(buf, block);
            foreach (var v in buf) { Assert.False(float.IsNaN(v)); energy += v * v; peak = Math.Max(peak, Math.Abs(v)); }
        }
        Assert.True(p.Finished);
        Assert.True(energy > 1, "ses yok");
        Assert.True(peak < 0.7f, $"tepe {peak}");
        // Bittikten sonra sessiz.
        Array.Fill(buf, 0.9f);
        p.Process(buf, block);
        Assert.All(buf, v => Assert.Equal(0f, v));
    }
}
