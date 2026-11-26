using Surround.Engine;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

/// <summary>
/// Switching Film / Game / Flat used to restart the engine (the mode was part of the fingerprint): the sound cut out for a
/// moment. The upmixer is now swapped in place: the new one warms up next to the old, then a 40 ms crossfade.
/// </summary>
public class ModeSwapTests
{
    private const int Ch = Channels.Count, Block = 480;

    private static IStereoUpmixer Make(string mode, UpmixLayout layout) => mode switch
    {
        "direct" => new DirectUpmixer(layout),
        "game" => new GameUpmixer(Sig.Fs, layout),
        _ => new FilmUpmixer(Sig.Fs, layout),
    };

    /// <summary>Runs <paramref name="seconds"/> of independent L/R noise, swapping to <paramref name="to"/> at 1 s; returns FL.</summary>
    private static float[] RunSwap(string from, string to, bool adaptive, double seconds = 2)
    {
        var layout = new UpmixLayout(Up.Used(Channels.FL, Channels.FR, Channels.FC), false);
        var a = new AdaptiveUpmix(Sig.Fs, Make(from, layout), adaptive);
        int n = (int)(Sig.Fs * seconds);
        var l = Up.Noise(n, 70); var r = Up.Noise(n, 71);
        var fl = new float[n];
        var buf = new float[Block * Ch];
        for (int start = 0; start < n; start += Block)
        {
            if (start == Sig.Fs) a.SwapUpmixer(Make(to, layout));
            Array.Clear(buf);
            for (int f = 0; f < Block; f++) { buf[f * Ch + Channels.FL] = l[start + f]; buf[f * Ch + Channels.FR] = r[start + f]; }
            a.Process(buf, Block);
            for (int f = 0; f < Block; f++) fl[start + f] = buf[f * Ch + Channels.FL];
        }
        return fl;
    }

    private static double RmsDb(float[] x, int from, int len)
    {
        double s = 0;
        for (int i = from; i < from + len; i++) s += (double)x[i] * x[i];
        return 10 * Math.Log10(s / len + 1e-30);
    }

    [Theory]
    [InlineData("direct", "film", false)]
    [InlineData("film", "direct", false)]
    [InlineData("film", "game", false)]
    [InlineData("game", "direct", false)]
    [InlineData("direct", "film", true)]
    [InlineData("film", "game", true)]
    public void SwitchingModesNeverLeavesAGap(string from, string to, bool adaptive)
    {
        var fl = RunSwap(from, to, adaptive);
        int win = Sig.Fs / 200; // 5 ms
        double steady = RmsDb(fl, Sig.Fs / 2, Sig.Fs / 4);
        // From 20 ms before the swap to 200 ms after it (warm-up 21 ms + crossfade 40 ms + margin), every 5 ms window
        // stays within -3 / +2 dB of the steady level: no silence, no bump.
        for (int at = Sig.Fs - Sig.Fs / 50; at < Sig.Fs + Sig.Fs / 5; at += win)
        {
            double d = RmsDb(fl, at, win) - steady;
            Assert.True(d > -3 && d < 2, $"{from}→{to}: {d:+0.0;-0.0} dB at {(at - Sig.Fs) * 1000.0 / Sig.Fs:0} ms");
        }
    }

    [Fact]
    public void AfterTheSwapTheNewModeIsPlaying()
    {
        // Flat passes FL through untouched; after switching to it the output is the input again, sample for sample.
        var layout = new UpmixLayout(Up.Used(Channels.FL, Channels.FR, Channels.FC), false);
        var a = new AdaptiveUpmix(Sig.Fs, new FilmUpmixer(Sig.Fs, layout), adaptive: false);
        a.SwapUpmixer(new DirectUpmixer(layout));
        Assert.IsType<DirectUpmixer>(a.Upmixer);
        int n = Sig.Fs / 2;
        var l = Up.Noise(n, 72);
        var buf = new float[Block * Ch];
        float maxErr = 0;
        for (int start = 0; start < n; start += Block)
        {
            Array.Clear(buf);
            for (int f = 0; f < Block; f++) buf[f * Ch + Channels.FL] = l[start + f];
            a.Process(buf, Block);
            if (start >= Sig.Fs / 10)
                for (int f = 0; f < Block; f++) maxErr = Math.Max(maxErr, Math.Abs(buf[f * Ch + Channels.FL] - l[start + f]));
        }
        Assert.True(maxErr < 1e-6f, $"max error {maxErr}");
        Assert.Equal(0, a.LatencyFrames);
    }

    [Fact]
    public void ModeIsNotPartOfTheEngineFingerprint()
    {
        var film = new SurroundConfig { UpmixOptions = new() { Mode = "film" } };
        var flat = new SurroundConfig { UpmixOptions = new() { Mode = "direct" } };
        var game = new SurroundConfig { UpmixOptions = new() { Mode = "game" } };
        Assert.Equal(film.EngineFingerprint(), flat.EngineFingerprint());
        Assert.Equal(film.EngineFingerprint(), game.EngineFingerprint());
    }
}
