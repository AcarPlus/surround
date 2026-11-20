using Surround.Engine.Audio;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

public class VolumeTests
{
    [Fact]
    public void Gain_FollowsDecibels_MuteAndZeroAreSilent()
    {
        Assert.Equal(1f, new VolumeState(true, 1, false, 0).Gain);
        Assert.Equal(0.5f, new VolumeState(true, 0.5, false, -6.0206).Gain, 3);
        Assert.Equal(0f, new VolumeState(true, 0.8, true, -2).Gain);
        Assert.Equal(0f, new VolumeState(true, 0, false, -96).Gain);
        // A device that cannot report its volume leaves the signal alone.
        Assert.Equal(1f, VolumeState.Unavailable.Gain);
        // Never a boost, whatever the device reports.
        Assert.Equal(1f, new VolumeState(true, 1, false, 6).Gain);
    }

    [Fact]
    public void ApproxDb_IsMonotonicAndCloseToWindowsTaper()
    {
        Assert.Equal(0, VolumeState.ApproxDb(1), 3);
        Assert.InRange(VolumeState.ApproxDb(0.5), -13, -9);
        Assert.InRange(VolumeState.ApproxDb(0.25), -25, -19);
        Assert.Equal(-96, VolumeState.ApproxDb(0));
    }

    [Fact]
    public void Ramp_UnityIsUntouched_ConstantGainScales()
    {
        var r = new VolumeRamp();
        float[] buf = { 1, -1, 0.5f, -0.5f };
        r.Process(buf, 2, 2);
        Assert.Equal(new float[] { 1, -1, 0.5f, -0.5f }, buf);

        r.Reset(0.5f);
        r.Process(buf, 2, 2);
        Assert.Equal(new float[] { 0.5f, -0.5f, 0.25f, -0.25f }, buf);
    }

    [Fact]
    public void Ramp_StepsSmoothlyToNewTarget_ThenHolds()
    {
        var r = new VolumeRamp();
        r.SetTarget(0);
        const int frames = 100, ch = 3;
        var buf = Enumerable.Repeat(1f, frames * ch).ToArray();
        r.Process(buf, frames, ch);
        // Same gain for every channel of a frame, falling monotonically, no jump larger than one step.
        for (int f = 0; f < frames; f++)
        {
            Assert.Equal(buf[f * ch], buf[f * ch + 2]);
            if (f > 0)
            {
                Assert.True(buf[f * ch] <= buf[(f - 1) * ch]);
                Assert.True(buf[(f - 1) * ch] - buf[f * ch] <= 1.0f / frames + 1e-6f);
            }
        }
        Assert.Equal(0f, buf[^1], 6);

        var next = Enumerable.Repeat(1f, 8).ToArray();
        r.Process(next, 4, 2);
        Assert.All(next, x => Assert.Equal(0f, x));
    }

    [Fact]
    public void Ramp_RejectsBadTargets()
    {
        var r = new VolumeRamp();
        r.SetTarget(float.NaN);
        Assert.Equal(1f, r.Target);
        r.SetTarget(3f);
        Assert.Equal(1f, r.Target);
        r.SetTarget(-1f);
        Assert.Equal(0f, r.Target);
    }
}
