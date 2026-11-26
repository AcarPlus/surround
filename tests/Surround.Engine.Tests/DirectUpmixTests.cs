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
    public void LeavesSurroundsEmptyThatOnlyLandOnFrontSpeakers()
    {
        // Konuma göre dağıtım, yalnız ön hoparlörler: sağ ön FR 0,96 + SR 1 + BR 1 çalar. R'nin kopyası SR/BR'ye
        // yazılsaydı aynı hoparlörde üç kez toplanırdı (+9,4 dB, sınırlayıcı sürekli bastırırdı).
        float[] Row(params (int Ch, float G)[] chs) { var r = new float[Up.Ch]; foreach (var (c, g) in chs) r[c] = g; return r; }
        var layout = UpmixLayout.ForSpeakers(new[]
        {
            Row((Channels.FL, 0.8f), (Channels.SL, 1), (Channels.BL, 1)),
            Row((Channels.FR, 0.96f), (Channels.SR, 1), (Channels.BR, 1)),
            Row((Channels.FL, 0.6f), (Channels.FC, 1), (Channels.FR, 0.3f)),
        });
        var o = Up.Run(new DirectUpmixer(layout), L, R);
        for (int f = 0; f < L.Length; f++)
        {
            int b = f * Up.Ch;
            Assert.Equal(R[f], o[b + Channels.FR]);
            foreach (int c in new[] { Channels.SL, Channels.SR, Channels.BL, Channels.BR }) Assert.Equal(0f, o[b + c]);
        }
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
