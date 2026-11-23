using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

public class DirectUpmixTests
{
    private static readonly float[] L = Up.Noise(960, 1), R = Up.Noise(960, 2);

    [Fact]
    public void FrontsPassThroughCenterIsMonoSumSurroundsCopy()
    {
        var layout = new UpmixLayout(Up.Used(Channels.FL, Channels.FR, Channels.FC, Channels.BL, Channels.BR), false);
        var o = Up.Run(new DirectUpmixer(layout), L, R);
        for (int f = 0; f < L.Length; f++)
        {
            int b = f * Up.Ch;
            Assert.Equal(L[f], o[b + Channels.FL]);
            Assert.Equal(R[f], o[b + Channels.FR]);
            Assert.Equal(0.5f * (L[f] + R[f]), o[b + Channels.FC], 6);
            Assert.Equal(L[f], o[b + Channels.BL]);
            Assert.Equal(R[f], o[b + Channels.BR]);
            Assert.Equal(0f, o[b + Channels.LFE]);
        }
    }

    [Fact]
    public void WritesOnlyChannelsSomeSpeakerPlays()
    {
        // Yalnız ön çift + orta: yan/arka/üst yazılmaz, yoksa katlama onları öne ekler (+6 dB).
        var layout = new UpmixLayout(Up.Used(Channels.FL, Channels.FR, Channels.FC), false);
        var o = Up.Run(new DirectUpmixer(layout), L, R);
        foreach (int c in new[] { Channels.SL, Channels.SR, Channels.BL, Channels.BR, Channels.TFL, Channels.TBR })
            for (int f = 0; f < L.Length; f++) Assert.Equal(0f, o[f * Up.Ch + c]);
    }

    [Fact]
    public void ConfigAcceptsDirectModeAndFingerprintKeepsIt()
    {
        var cfg = new SurroundConfig { UpmixOptions = new() { Mode = "direct" } };
        Assert.True(cfg.UpmixOptions.IsDirect);
        Assert.DoesNotContain(ConfigValidator.Validate(cfg), m => m.Contains("upmixOptions.mode"));
        var film = new SurroundConfig { UpmixOptions = new() { Mode = "film" } };
        Assert.NotEqual(film.EngineFingerprint(), cfg.EngineFingerprint());
    }
}
