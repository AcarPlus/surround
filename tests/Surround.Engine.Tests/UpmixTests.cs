using Surround.Engine;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

internal static class Up
{
    public const int Ch = Channels.Count;
    public static readonly int[] Surrounds = { Channels.SL, Channels.SR, Channels.BL, Channels.BR };
    public static readonly int[] NonLfe = { Channels.FL, Channels.FR, Channels.FC, Channels.BL, Channels.BR, Channels.SL, Channels.SR };

    public static float[] Noise(int n, int seed, float amp = 0.25f)
    {
        var rnd = new Random(seed);
        var x = new float[n];
        for (int i = 0; i < n; i++) x[i] = amp * (float)(rnd.NextDouble() * 2 - 1);
        return x;
    }

    public static IStereoUpmixer Make(string mode, UpmixLayout? layout = null) =>
        mode == "game" ? new GameUpmixer(Sig.Fs, layout) : new FilmUpmixer(Sig.Fs, layout);

    /// <summary>Runs FL/FR through the upmixer in 480-frame blocks; returns interleaved logical output.</summary>
    public static float[] Run(IStereoUpmixer up, float[] l, float[] r, int block = 480)
    {
        int n = l.Length;
        var inp = new float[n * Ch];
        for (int f = 0; f < n; f++) { inp[f * Ch + Channels.FL] = l[f]; inp[f * Ch + Channels.FR] = r[f]; }
        var outp = new float[n * Ch];
        for (int p = 0; p < n; p += block)
        {
            int c = Math.Min(block, n - p);
            up.Process(inp.AsSpan(p * Ch, c * Ch), outp.AsSpan(p * Ch, c * Ch), c);
        }
        return outp;
    }

    public static double Energy(float[] lg, int ch, int from = 0)
    {
        double e = 0;
        for (int f = from; f < lg.Length / Ch; f++) e += (double)lg[f * Ch + ch] * lg[f * Ch + ch];
        return e;
    }

    public static double Energy(float[] lg, IEnumerable<int> chs, int from = 0) => chs.Sum(c => Energy(lg, c, from));

    public static double Energy(float[] x, int from = 0)
    {
        double e = 0;
        for (int i = from; i < x.Length; i++) e += (double)x[i] * x[i];
        return e;
    }

    /// <summary>FL, FR, BL, BR used (the user's 2.1 fronts + two rear satellites); FC and the sides are folded away.</summary>
    public static readonly bool[] FrontsAndRears = Used(Channels.FL, Channels.FR, Channels.BL, Channels.BR);

    public static bool[] Used(params int[] chs)
    {
        var u = new bool[Ch];
        foreach (var c in chs) u[c] = true;
        return u;
    }
}

public class UpmixerTests
{
    public static TheoryData<string> Modes => new() { "game", "film" };
    private const int N = Sig.Fs * 2, Warm = Sig.Fs / 2;

    [Theory]
    [MemberData(nameof(Modes))]
    public void HardLeftStaysLeft(string mode)
    {
        var l = Up.Noise(N, 1);
        var lg = Up.Run(Up.Make(mode), l, new float[N]);
        double fl = Up.Energy(lg, Channels.FL, Warm);
        double others = Up.Energy(lg, Up.NonLfe.Where(c => c != Channels.FL), Warm);
        Assert.True(others < fl * 1e-4, $"{mode}: leak {Sig.Db(Math.Sqrt(others / fl)):0.0} dB");
        // And it is the same signal (game: no delay, film: its latency).
        int lat = Up.Make(mode).LatencyFrames;
        double err = 0;
        for (int f = Warm; f < N; f++) { double d = lg[f * Up.Ch + Channels.FL] - l[f - lat]; err += d * d; }
        Assert.True(err < Up.Energy(l, Warm) * 1e-4, $"{mode}: FL is not L delayed by {lat}");
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void HardRightStaysRightWithItsPolarity(string mode)
    {
        // A whisper of L keeps the steering direction hovering around hard right (where the eigenvector sign flips).
        var r = Up.Noise(N, 2);
        var l = Up.Noise(N, 3, 0.0005f);
        var lg = Up.Run(Up.Make(mode), l, r);
        int lat = Up.Make(mode).LatencyFrames;
        double fr = Up.Energy(lg, Channels.FR, Warm), dot = 0;
        for (int f = Warm; f < N; f++) dot += lg[f * Up.Ch + Channels.FR] * r[f - lat];
        Assert.True(dot / Math.Sqrt(fr * Up.Energy(r, Warm - lat)) > 0.99, $"{mode}: FR not R");
        Assert.True(Up.Energy(lg, Up.NonLfe.Where(c => c != Channels.FR), Warm) < fr * 1e-3);
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void CenteredMonoAddsTheFlatCenterAndKeepsTheFronts(string mode)
    {
        // As the flat mode: FL = L, FR = R and the center gets (L+R)/2. Moving it out of the fronts instead made film
        // and game thinner and up to 6 dB quieter than the flat mode (see ModeLoudnessTests).
        var m = Up.Noise(N, 4);
        var up = Up.Make(mode);
        var lg = Up.Run(up, m, m);
        int lat = up.LatencyFrames;
        double fc = Up.Energy(lg, Channels.FC, Warm), mE = Up.Energy(m, Warm - lat);
        Assert.InRange(10 * Math.Log10(fc / mE), -0.5, 0.5);
        foreach (int ch in new[] { Channels.FL, Channels.FR })
        {
            double err = 0;
            for (int f = Warm; f < N; f++) { double d = lg[f * Up.Ch + ch] - m[f - lat]; err += d * d; }
            Assert.True(err < mE * 1e-6, $"{mode}: {Channels.Names[ch]} is not the input");
        }
        Assert.True(Up.Energy(lg, Up.Surrounds, Warm) < 0.02 * fc, $"{mode}: centered sound in the surrounds");
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void UncorrelatedStereoFeedsTheSurrounds(string mode)
    {
        var lg = Up.Run(Up.Make(mode), Up.Noise(N, 5), Up.Noise(N, 6));
        double sur = Up.Energy(lg, Up.Surrounds, Warm), all = Up.Energy(lg, Up.NonLfe, Warm);
        Assert.True(sur > 0.25 * all, $"{mode}: surround share {sur / all:P1}");
        foreach (var c in Up.Surrounds) Assert.True(Up.Energy(lg, c, Warm) > 0.05 * all, $"{mode}: {Channels.Names[c]} empty");
        Assert.True(Up.Energy(lg, Channels.FC, Warm) < 0.1 * all, $"{mode}: FC from uncorrelated");
    }

    [Theory]
    [InlineData("game", 0.0)]
    [InlineData("game", 0.5)]
    [InlineData("game", 1.0)]
    [InlineData("film", 0.0)]
    [InlineData("film", 0.5)]
    [InlineData("film", 1.0)]
    public void NeverQuieterThanTheInput(string mode, double correlated)
    {
        // Mix of a centered (correlated) part, a left-panned part and independent ambience.
        var c = Up.Noise(N, 7); var a1 = Up.Noise(N, 8); var a2 = Up.Noise(N, 9); var p = Up.Noise(N, 10);
        float k = (float)correlated, q = (float)Math.Sqrt(1 - correlated);
        var l = new float[N]; var r = new float[N];
        for (int i = 0; i < N; i++)
        {
            l[i] = k * (0.7f * c[i] + 0.5f * p[i]) + q * a1[i];
            r[i] = k * (0.7f * c[i] + 0.1f * p[i]) + q * a2[i];
        }
        var lg = Up.Run(Up.Make(mode), l, r);
        // The fronts carry the input; the center and the surrounds add to it (at most the flat mode's center, +1.8 dB,
        // plus the surround ambience).
        double outE = Up.Energy(lg, Up.NonLfe, Warm), inE = Up.Energy(l, Warm) + Up.Energy(r, Warm);
        Assert.InRange(10 * Math.Log10(outE / inE), 0.5, 3.5);
        double fronts = Up.Energy(lg, new[] { Channels.FL, Channels.FR }, Warm);
        Assert.InRange(10 * Math.Log10(fronts / inE), -0.1, 0.1);
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void CenterLevelScalesDialog(string mode)
    {
        var m = Up.Noise(N, 11);
        var up = Up.Make(mode);
        up.Update(UpmixSettings.Build(new UpmixOptions { CenterDb = -6 }));
        var lg = Up.Run(up, m, m);
        // The center (the flat mode's (L+R)/2 at 0 dB) follows the level; the fronts keep the input.
        double ratio = Up.Energy(lg, Channels.FC, Warm) / Up.Energy(m, Warm);
        Assert.InRange(10 * Math.Log10(ratio), -6.5, -5.5);
        Assert.InRange(10 * Math.Log10(Up.Energy(lg, Channels.FL, Warm) / Up.Energy(m, Warm)), -0.1, 0.1);

        // A layout without FC: nothing to scale, the dialog plays from FL/FR as it is.
        var up2 = Up.Make(mode, new UpmixLayout(Up.FrontsAndRears, false));
        up2.Update(UpmixSettings.Build(new UpmixOptions { CenterDb = -6 }));
        var lg2 = Up.Run(up2, m, m);
        Assert.Equal(0, Up.Energy(lg2, Channels.FC, Warm));
        double ratio2 = Up.Energy(lg2, new[] { Channels.FL, Channels.FR }, Warm) / (2 * Up.Energy(m, Warm));
        Assert.InRange(10 * Math.Log10(ratio2), -0.1, 0.1);
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void FrontsAndRearsLayoutUsesOnlyItsSpeakers(string mode)
    {
        var up = Up.Make(mode, new UpmixLayout(Up.FrontsAndRears, false));
        var m = Up.Noise(N, 12);
        var lg = Up.Run(up, m, m);
        Assert.InRange(Up.Energy(lg, Channels.FL, Warm) / Up.Energy(lg, Channels.FR, Warm), 0.95, 1.05);

        lg = Up.Run(Up.Make(mode, new UpmixLayout(Up.FrontsAndRears, false)), Up.Noise(N, 13), Up.Noise(N, 14));
        foreach (var c in new[] { Channels.FC, Channels.SL, Channels.SR, Channels.LFE })
            Assert.Equal(0, Up.Energy(lg, c, Warm));
        double rear = Up.Energy(lg, new[] { Channels.BL, Channels.BR }, Warm), all = Up.Energy(lg, Up.NonLfe, Warm);
        Assert.True(rear > 0.25 * all, $"{mode}: rear share {rear / all:P1}");
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void SideWithoutSurroundKeepsItsAmbienceInFront(string mode)
    {
        // FL, FR and only the back right: the left ambience must not be rendered into SL/BL (the fold would add the
        // decorrelated, delayed copy back onto FL, which already carries it — a comb that sounds like an echo).
        var layout = new UpmixLayout(Up.Used(Channels.FL, Channels.FR, Channels.BR), false);
        var l = Up.Noise(N, 30); var r = Up.Noise(N, 31);
        var lg = Up.Run(Up.Make(mode, layout), l, r);
        foreach (var c in new[] { Channels.SL, Channels.BL, Channels.SR, Channels.FC })
            Assert.Equal(0, Up.Energy(lg, c, Warm));
        double br = Up.Energy(lg, Channels.BR, Warm), fl = Up.Energy(lg, Channels.FL, Warm), fr = Up.Energy(lg, Channels.FR, Warm);
        Assert.True(br > 0.25 * (fr + br), $"{mode}: right ambience not in BR ({br / (fr + br):P1})");
        // Both fronts keep their input; only the right side adds its ambience in BR.
        Assert.InRange(10 * Math.Log10(fl / Up.Energy(l, Warm)), -0.2, 0.2);
        Assert.InRange(10 * Math.Log10(fr / Up.Energy(r, Warm)), -0.2, 0.2);
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void SurroundsSharingAFrontSpeakerGetPlainCopies(string mode)
    {
        // "Distribute by position" with three fronts: the left speaker also plays SL and BL. Ambience rendered there
        // (decorrelated, 10 ms later) would comb with the front in the same cone, and the speaker would be quieter
        // than in the flat mode, so these channels get exactly what the flat mode gives them.
        float[] Row(params int[] chs) { var r = new float[Up.Ch]; foreach (var c in chs) r[c] = 1; return r; }
        var layout = UpmixLayout.ForSpeakers(new[]
        {
            Row(Channels.FL, Channels.SL, Channels.BL), Row(Channels.FR, Channels.SR, Channels.BR), Row(Channels.FC),
        });
        Assert.True(layout.Shared(Channels.SL) && layout.Shared(Channels.BR));
        Assert.False(layout.Steerable.Has(Channels.SL));
        var l = Up.Noise(N, 40); var r = Up.Noise(N, 41);
        var up = Up.Make(mode, layout);
        var lg = Up.Run(up, l, r);
        int lat = up.LatencyFrames;
        foreach (var (ch, src) in new[] { (Channels.SL, l), (Channels.BL, l), (Channels.SR, r), (Channels.BR, r) })
        {
            double err = 0;
            for (int f = Warm; f < N; f++) { double d = lg[f * Up.Ch + ch] - src[f - lat]; err += d * d; }
            Assert.True(err < Up.Energy(src, Warm) * 1e-6, $"{mode}: {Channels.Names[ch]} is not a copy");
        }

        // Real side/back speakers (rows without a front) are separate: they get the decorrelated ambience.
        var five = UpmixLayout.ForSpeakers(new[]
        {
            Row(Channels.FL), Row(Channels.FR), Row(Channels.FC), Row(Channels.SL, Channels.BL), Row(Channels.SR, Channels.BR),
        });
        Assert.False(five.Shared(Channels.SL));
        Assert.Same(five, five.Steerable);
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void SurroundLevelAndLfeSwitch(string mode)
    {
        var l = Up.Noise(N, 15); var r = Up.Noise(N, 16);
        double sur0 = Up.Energy(Up.Run(Up.Make(mode), l, r), Up.Surrounds, Warm);
        var up = Up.Make(mode);
        up.Update(UpmixSettings.Build(new UpmixOptions { SurroundDb = 6, LfeEnabled = false }));
        var lg = Up.Run(up, l, r);
        Assert.InRange(10 * Math.Log10(Up.Energy(lg, Up.Surrounds, Warm) / sur0), 5.5, 6.5);
        Assert.Equal(0, Up.Energy(lg, Channels.LFE, Warm));
    }

    [Fact]
    public void LfeIsLowPassedMid()
    {
        foreach (var mode in new[] { "game", "film" })
        {
            double Lfe(double hz)
            {
                var x = Sig.Sine(hz, N);
                var lg = Up.Run(Up.Make(mode), x, x);
                return Math.Sqrt(Up.Energy(lg, Channels.LFE, Warm) / (N - Warm));
            }
            Assert.True(Lfe(50) > 0.3, mode);
            Assert.True(Lfe(2000) < 0.005, mode);
        }
    }

    [Fact]
    public void FilmLatencyIsOneFrame()
    {
        var up = new FilmUpmixer(48000);
        Assert.Equal(1024, up.LatencyFrames);
        Assert.Equal(2048, new FilmUpmixer(96000).LatencyFrames);
        Assert.Equal(0, new GameUpmixer(48000).LatencyFrames);
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void SilenceStaysCleanAndFinite(string mode)
    {
        var up = Up.Make(mode);
        var silent = new float[N];
        var lg = Up.Run(up, silent, silent);
        Assert.All(lg, v => Assert.Equal(0f, v));

        // Signal, then a long silence: output decays to (exact) zero without NaN or subnormal values.
        int n = Sig.Fs * 6;
        var l = new float[n]; var r = new float[n];
        var s1 = Up.Noise(Sig.Fs, 17); var s2 = Up.Noise(Sig.Fs, 18);
        Array.Copy(s1, l, s1.Length); Array.Copy(s2, r, s2.Length);
        lg = Up.Run(up, l, r);
        foreach (var v in lg) Assert.True(float.IsFinite(v) && !float.IsSubnormal(v));
        for (int i = lg.Length - Sig.Fs * Up.Ch; i < lg.Length; i++) Assert.True(Math.Abs(lg[i]) < 1e-9f);
    }

    [Fact]
    public void FftRoundTrips()
    {
        var fft = new Fft(64);
        var re = Up.Noise(64, 19); var im = Up.Noise(64, 20);
        var r0 = (float[])re.Clone(); var i0 = (float[])im.Clone();
        // DFT of a unit impulse at 1 is e^{-2πik/N}.
        var dr = new float[64]; var di = new float[64]; dr[1] = 1;
        fft.Transform(dr, di, false);
        Assert.Equal(Math.Cos(-2 * Math.PI * 3 / 64), dr[3], 5);
        Assert.Equal(Math.Sin(-2 * Math.PI * 3 / 64), di[3], 5);
        fft.Transform(re, im, false);
        fft.Transform(re, im, true);
        for (int i = 0; i < 64; i++) { Assert.Equal(r0[i], re[i] / 64, 5); Assert.Equal(i0[i], im[i] / 64, 5); }
    }
}

public class StereoDetectorTests
{
    private static float Db(double db) => (float)Math.Pow(10, db / 20);

    private static int FramesUntil(StereoDetector d, float level, bool target, int max)
    {
        for (int i = 1; i <= max; i++)
        {
            // A sine-like level: peaks at 'level', zero crossings in between.
            float v = level * MathF.Abs(MathF.Sin(i * 0.05f));
            if (d.Step(v) == target) return i;
        }
        return -1;
    }

    [Fact]
    public void SwitchesToNativeFastAndBackSlowly()
    {
        var d = new StereoDetector(Sig.Fs);
        Assert.True(d.Stereo);
        int toNative = FramesUntil(d, Db(-40), false, Sig.Fs);
        Assert.InRange(toNative, 1, Sig.Fs / 100); // ≤ 10 ms

        // Silence: stays native for ≥ 300 ms, then stereo (plus the 10 ms envelope release).
        int toStereo = FramesUntil(d, 0f, true, Sig.Fs);
        Assert.InRange(toStereo, (int)(0.300 * Sig.Fs), (int)(0.400 * Sig.Fs));
    }

    [Fact]
    public void HysteresisHoldsBetweenThresholds()
    {
        // -67 dBFS lies between the enter (-70) and exit (-64) thresholds: neither state changes.
        var d = new StereoDetector(Sig.Fs);
        Assert.Equal(-1, FramesUntil(d, Db(-67), false, Sig.Fs));
        var n = new StereoDetector(Sig.Fs, startStereo: false);
        Assert.Equal(-1, FramesUntil(n, Db(-67), true, Sig.Fs));
        // Dither-level noise never leaves stereo.
        Assert.Equal(-1, FramesUntil(d, Db(-90), false, Sig.Fs));
    }

    [Fact]
    public void ShortGapsDoNotFlap()
    {
        var d = new StereoDetector(Sig.Fs, startStereo: false);
        for (int burst = 0; burst < 10; burst++)
        {
            Assert.Equal(-1, FramesUntil(d, Db(-30), true, Sig.Fs / 20)); // 50 ms of content
            Assert.Equal(-1, FramesUntil(d, 0f, true, Sig.Fs / 5));      // 200 ms gap < 300 ms
        }
        Assert.False(d.Stereo);
    }
}

public class AdaptiveUpmixTests
{
    private const int Ch = Channels.Count;

    private static void Run(AdaptiveUpmix a, Span<float> lg, int block = 480)
    {
        for (int p = 0; p < lg.Length / Ch; p += block)
        {
            int c = Math.Min(block, lg.Length / Ch - p);
            a.Process(lg.Slice(p * Ch, c * Ch), c);
        }
    }

    [Theory]
    [InlineData("game")]
    [InlineData("film")]
    public void UpmixesStereoContentAndPassesNativeThrough(string mode)
    {
        var up = Up.Make(mode);
        var a = new AdaptiveUpmix(Sig.Fs, up, adaptive: true);
        int n = Sig.Fs;
        var m = Up.Noise(n, 21);

        // 7.1 stream that carries only centered stereo: upmixed (FC appears).
        var lg = new float[n * Ch];
        for (int f = 0; f < n; f++) lg[f * Ch + Channels.FL] = lg[f * Ch + Channels.FR] = m[f];
        Run(a, lg);
        Assert.Equal(UpmixState.Stereo, a.State);
        Assert.InRange(Up.Energy(lg, Channels.FC, n / 2) / Up.Energy(lg, Channels.FL, n / 2), 0.85, 1.15);

        // Real multichannel content appears on SL: native within 50 ms, SL passes through (delayed by the latency).
        var sl = Up.Noise(n, 22);
        lg = new float[n * Ch];
        for (int f = 0; f < n; f++) { lg[f * Ch + Channels.FL] = lg[f * Ch + Channels.FR] = m[f]; lg[f * Ch + Channels.SL] = sl[f]; }
        var src = (float[])lg.Clone();
        a.Process(lg.AsSpan(0, 480 * Ch), 480); // 10 ms
        Assert.Equal(UpmixState.Native, a.State);
        Run(a, lg.AsSpan(480 * Ch));
        int lat = up.LatencyFrames, settled = (int)(0.05 * Sig.Fs) + lat;
        for (int f = settled; f < n; f++)
            for (int c = 0; c < Ch; c++)
                Assert.Equal(src[(f - lat) * Ch + c], lg[f * Ch + c], 6);
    }

    [Fact]
    public void CrossfadeHasNoClicks()
    {
        // Steady 200 Hz centered tone; SL toggles on and off. Output steps must stay near the tone's own slope.
        var a = new AdaptiveUpmix(Sig.Fs, new GameUpmixer(Sig.Fs), adaptive: true);
        int n = Sig.Fs * 2;
        var x = Sig.Sine(200, n, 0.5f);
        var lg = new float[n * Ch];
        for (int f = 0; f < n; f++)
        {
            lg[f * Ch + Channels.FL] = lg[f * Ch + Channels.FR] = x[f];
            if ((f / (Sig.Fs / 2)) % 2 == 1) lg[f * Ch + Channels.SL] = 0.01f * MathF.Sin(f * 0.01f);
        }
        Run(a, lg);
        float maxStep = 0;
        for (int f = Sig.Fs / 10; f < n; f++)
        {
            float y0 = lg[(f - 1) * Ch + Channels.FL] + lg[(f - 1) * Ch + Channels.FC] * 0.7071f;
            float y1 = lg[f * Ch + Channels.FL] + lg[f * Ch + Channels.FC] * 0.7071f;
            maxStep = Math.Max(maxStep, Math.Abs(y1 - y0));
        }
        // The tone itself moves at most 2π·200/48000·0.5·(1+√2·0.7071) ≈ 0.026 per sample.
        Assert.True(maxStep < 0.05f, $"step {maxStep}");
    }

    [Fact]
    public void StereoSourceAlwaysUpmixes()
    {
        var a = new AdaptiveUpmix(Sig.Fs, new GameUpmixer(Sig.Fs), adaptive: false);
        var lg = new float[4800 * Ch];
        for (int f = 0; f < 4800; f++) { lg[f * Ch] = 0.3f; lg[f * Ch + 1] = 0.3f; lg[f * Ch + Channels.SL] = 0.5f; }
        Run(a, lg);
        Assert.Equal(UpmixState.Stereo, a.State);
    }
}

public class ChannelFoldTests
{
    [Fact]
    public void FrontsAndRearsFoldCenterAndSides()
    {
        var fold = ChannelFold.Plan(Up.FrontsAndRears)!;
        var ops = fold.Ops.ToHashSet();
        float h = 1 / MathF.Sqrt(2);
        Assert.Contains((Channels.FC, Channels.FL, h), ops);
        Assert.Contains((Channels.FC, Channels.FR, h), ops);
        Assert.Contains((Channels.SL, Channels.BL, 1f), ops);
        Assert.Contains((Channels.SR, Channels.BR, 1f), ops);
        Assert.Equal(4, ops.Count); // LFE is left to the bass receivers rule

        var lg = new float[Channels.Count];
        lg[Channels.SL] = 0.5f; lg[Channels.FC] = 1f; lg[Channels.BL] = 0.25f; lg[Channels.LFE] = 0.3f;
        fold.Process(lg, 1);
        Assert.Equal(0.75f, lg[Channels.BL], 6);
        Assert.Equal(h, lg[Channels.FL], 6);
        Assert.Equal(h, lg[Channels.FR], 6);
        Assert.Equal(0f, lg[Channels.SL]);
        Assert.Equal(0f, lg[Channels.FC]);
        Assert.Equal(0.3f, lg[Channels.LFE]);
    }

    [Fact]
    public void FullLayoutNeedsNoFold()
    {
        Assert.Null(ChannelFold.Plan(Enumerable.Repeat(true, Channels.Count).ToArray()));
        // LFE unused is not a fold either.
        Assert.Null(ChannelFold.Plan(Up.Used(0, 1, 2, 4, 5, 6, 7)));
    }

    [Fact]
    public void FrontsOnlyFoldEverythingForward()
    {
        var ops = ChannelFold.Plan(Up.Used(Channels.FL, Channels.FR))!.Ops;
        Assert.Contains((Channels.SL, Channels.FL, 1f), ops);
        Assert.Contains((Channels.BL, Channels.FL, 1f), ops);
        Assert.Contains((Channels.BR, Channels.FR, 1f), ops);
        Assert.Contains((Channels.SR, Channels.FR, 1f), ops);
    }

    [Fact]
    public void SidesOnlyLayoutTakesTheBacks()
    {
        var ops = ChannelFold.Plan(Up.Used(Channels.FL, Channels.FR, Channels.FC, Channels.SL, Channels.SR))!.Ops;
        Assert.Contains((Channels.BL, Channels.SL, 1f), ops);
        Assert.Contains((Channels.BR, Channels.SR, 1f), ops);
        Assert.Equal(2, ops.Count);
    }

    [Fact]
    public void UsedChannelsCountsRowsOfUnmutedSpeakers()
    {
        var row = new float[Channels.Count]; row[Channels.FL] = 1; row[Channels.SL] = 0.5f;
        var muted = new float[Channels.Count]; muted[Channels.FC] = 1;
        var used = ChannelFold.UsedChannels(new[] { (row, false), (muted, true) });
        Assert.True(used[Channels.FL] && used[Channels.SL]);
        Assert.False(used[Channels.FC]);
    }
}

public class UpmixConfigTests
{
    private const string Json = """
    {
      "source": { "deviceId": "SRC", "mode": "loopback" },
      "upmix": true,
      "outputs": [ { "deviceId": "A" } ],
      "speakers": [ { "name": "FL", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 1 } } ]
    }
    """;

    [Fact]
    public void DefaultsAndRoundTrip()
    {
        var cfg = SurroundConfig.Parse(Json);
        Assert.Equal("film", cfg.UpmixOptions.Mode);
        Assert.Equal(0, cfg.UpmixOptions.CenterDb);
        Assert.True(cfg.UpmixOptions.LfeEnabled);
        Assert.False(cfg.UpmixOptions.IsGame);

        cfg.UpmixOptions = new UpmixOptions { Mode = "game", CenterDb = 3, SurroundDb = -4, LfeEnabled = false };
        var back = SurroundConfig.Parse(cfg.ToJson());
        Assert.True(back.UpmixOptions.IsGame);
        Assert.Equal(3, back.UpmixOptions.CenterDb);
        Assert.Equal(-4, back.UpmixOptions.SurroundDb);
        Assert.False(back.UpmixOptions.LfeEnabled);
        Assert.Contains("\"upmixOptions\"", cfg.ToJson());
        Assert.Empty(ConfigValidator.Validate(back));
    }

    [Fact]
    public void Validates()
    {
        var cfg = SurroundConfig.Parse(Json);
        cfg.UpmixOptions = new UpmixOptions { Mode = "concert", CenterDb = 9, SurroundDb = -13 };
        var e = ConfigValidator.Validate(cfg);
        Assert.Contains(e, m => m.Contains("upmixOptions.mode"));
        Assert.Contains(e, m => m.Contains("upmixOptions.centerDb"));
        Assert.Contains(e, m => m.Contains("upmixOptions.surroundDb"));
    }

    [Fact]
    public void FingerprintIgnoresGainsButNotMode()
    {
        var a = SurroundConfig.Parse(Json);
        var b = SurroundConfig.Parse(Json);
        b.UpmixOptions.CenterDb = -6; b.UpmixOptions.SurroundDb = 4; b.UpmixOptions.LfeEnabled = false;
        Assert.Equal(a.EngineFingerprint(), b.EngineFingerprint());
        b.UpmixOptions.Mode = "game";
        Assert.NotEqual(a.EngineFingerprint(), b.EngineFingerprint());
        var c = SurroundConfig.Parse(Json);
        c.UpmixOptions.Mode = "FILM";
        Assert.Equal(a.EngineFingerprint(), c.EngineFingerprint());
    }

    [Fact]
    public void SettingsClampAndConvert()
    {
        var s = UpmixSettings.Build(new UpmixOptions { CenterDb = -6, SurroundDb = 40, LfeEnabled = false });
        Assert.Equal(0.501, s.CenterGain, 3);
        Assert.Equal(Math.Pow(10, 6 / 20.0), s.SurroundGain, 3);
        Assert.Equal(0f, s.LfeGain);
    }
}
