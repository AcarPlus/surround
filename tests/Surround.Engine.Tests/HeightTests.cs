using Surround.Engine;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

public class HeightLaneTests
{
    public static TheoryData<string> Modes => new() { "game", "film" };
    private const int Ch = Channels.Count, N = Sig.Fs * 2, Warm = Sig.Fs / 2;
    private static readonly int[] Heights = { Channels.TFL, Channels.TFR, Channels.TBL, Channels.TBR };
    private static readonly int[] Floor = Enumerable.Range(0, Channels.SourceCount).ToArray();
    private static readonly int[] Full71 = Floor;

    private static UpmixLayout Layout(params int[] chs) => new(Up.Used(chs), false);
    private static UpmixLayout Full71And(params int[] heights) => Layout(Full71.Concat(heights).ToArray());

    private static double Corr(float[] lg, int a, int b, int from)
    {
        double ab = 0, aa = 0, bb = 0;
        for (int f = from; f < lg.Length / Ch; f++)
        {
            double x = lg[f * Ch + a], y = lg[f * Ch + b];
            ab += x * y; aa += x * x; bb += y * y;
        }
        return ab / Math.Sqrt(aa * bb + 1e-30);
    }

    [Fact]
    public void TwelveLogicalLanes()
    {
        Assert.Equal(12, Channels.Count);
        Assert.Equal(new[] { "FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR", "TFL", "TFR", "TBL", "TBR" }, Channels.Names);
        Assert.Equal(Channels.TFL, Channels.IndexOf("tfl"));
        Assert.Equal(Channels.TBR, Channels.IndexOf("TBR"));
        Assert.True(Channels.IsHeight(Channels.TFL) && !Channels.IsHeight(Channels.SR));
        // Sources never feed the height lanes.
        Assert.Equal(Enumerable.Range(0, 8), Channels.MapForSourceChannels(8));
        Assert.Equal(Enumerable.Range(0, 8), Channels.MapForSourceChannels(12));
    }

    [Fact]
    public void SinkMixerRoutesHeightLanes()
    {
        static float[] Row(params (int Ch, float G)[] g) { var r = new float[Ch]; foreach (var (c, v) in g) r[c] = v; return r; }
        var routes = new[]
        {
            new SpeakerRoute("top", 0, Row((Channels.TFL, 1f)), 0, false, 0),
            new SpeakerRoute("top center", 1, Row((Channels.TFL, 0.5f), (Channels.TFR, 0.5f), (Channels.TBL, 0.5f), (Channels.TBR, 0.5f)), 0, false, 0),
            new SpeakerRoute("fl", 2, Row((Channels.FL, 1f)), 0, false, 0),
        };
        var mixer = new SinkMixer(3, routes, Sig.Fs);
        var lg = new float[4 * Ch];
        for (int f = 0; f < 4; f++)
        {
            lg[f * Ch + Channels.FL] = 0.1f;
            lg[f * Ch + Channels.TFL] = 0.2f; lg[f * Ch + Channels.TFR] = 0.3f;
            lg[f * Ch + Channels.TBL] = 0.4f; lg[f * Ch + Channels.TBR] = 0.5f;
        }
        var ring = new RingBuffer(64, 3);
        Assert.Equal(0, mixer.Process(lg, 4, ring));
        var o = new float[12];
        ring.Read(o);
        for (int f = 0; f < 4; f++)
        {
            Assert.Equal(0.2f, o[f * 3], 6);
            Assert.Equal(0.7f, o[f * 3 + 1], 6);
            Assert.Equal(0.1f, o[f * 3 + 2], 6);
        }
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void HeightLanesSilentWhenUnused(string mode)
    {
        var lg = Up.Run(Up.Make(mode, Layout(Full71)), Up.Noise(N, 31), Up.Noise(N, 32));
        foreach (var h in Heights) Assert.Equal(0, Up.Energy(lg, h, 0));
        Assert.Null(NativeHeights.Create(Sig.Fs, Layout(Full71)));
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void HeightsAreAdditiveAndOnlyWhereUsed(string mode)
    {
        var l = Up.Noise(N, 33); var r = Up.Noise(N, 34);
        var with = Up.Run(Up.Make(mode, Full71And(Channels.TFL, Channels.TFR)), l, r);
        var without = Up.Run(Up.Make(mode, Layout(Full71)), l, r);
        // The floor lanes are untouched by the heights (additive, nothing is taken away).
        for (int f = 0; f < N; f++)
            foreach (var c in Floor) Assert.Equal(without[f * Ch + c], with[f * Ch + c]);

        double amb = Up.Energy(with, Up.Surrounds, Warm);
        double tf = Up.Energy(with, new[] { Channels.TFL, Channels.TFR }, Warm);
        Assert.True(tf > 0.2 * amb, $"{mode}: front heights {tf / amb:P1} of the surrounds");
        Assert.Equal(0, Up.Energy(with, Channels.TBL, 0));
        Assert.Equal(0, Up.Energy(with, Channels.TBR, 0));
        // Decorrelated from the floor surrounds and from each other.
        foreach (var s in Up.Surrounds)
            Assert.InRange(Corr(with, Channels.TFL, s, Warm), -0.3, 0.3);
        Assert.InRange(Corr(with, Channels.TFL, Channels.TFR, Warm), -0.3, 0.3);
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void HeightLevelFollowsHeightDb(string mode)
    {
        var l = Up.Noise(N, 35); var r = Up.Noise(N, 36);
        var layout = Full71And(Heights);
        double E(double db)
        {
            var up = Up.Make(mode, layout);
            up.Update(UpmixSettings.Build(new UpmixOptions { HeightDb = db }));
            return Up.Energy(Up.Run(up, l, r), Heights, Warm);
        }
        double e0 = E(0);
        Assert.InRange(10 * Math.Log10(E(-12) / e0), -12.3, -11.7);
        Assert.InRange(10 * Math.Log10(E(6) / e0), 5.7, 6.3);
        // Both heights of a side together carry about the ambient power at 0 dB (the floor surrounds carry 60 % of it).
        var up0 = Up.Make(mode, layout);
        up0.Update(UpmixSettings.Build(new UpmixOptions { HeightDb = 0 }));
        var lg = Up.Run(up0, l, r);
        double ambient = Up.Energy(lg, Up.Surrounds, Warm) / (1 - UpmixTuning.FrontAmbientShare);
        Assert.InRange(10 * Math.Log10(e0 / ambient), -1.5, 1.0);
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void HeightsAreHighPassed(string mode)
    {
        // Uncorrelated (ambient) bass vs broadband: the heights get almost none of the bass ambience.
        static float[] Low(float[] x) { var lp = LinkwitzRiley.LowPass(Sig.Fs, 50); return x.Select(lp.Process).ToArray(); }
        double H(float[] l, float[] r)
        {
            var lg = Up.Run(Up.Make(mode, Full71And(Heights)), l, r);
            return Up.Energy(lg, Heights, Warm) / Up.Energy(lg, Up.Surrounds, Warm);
        }
        double low = H(Low(Up.Noise(N, 37)), Low(Up.Noise(N, 38))), wide = H(Up.Noise(N, 37), Up.Noise(N, 38));
        Assert.True(low < 0.1 * wide, $"{mode}: {low:0.000} vs {wide:0.000}");

        // Native: side signal at 40 Hz vs 2 kHz.
        double Nat(double hz)
        {
            var nh = NativeHeights.Create(Sig.Fs, Full71And(Channels.TFL))!;
            var x = Sig.Sine(hz, N, 0.3f);
            var lg = new float[x.Length * Ch];
            for (int f = 0; f < x.Length; f++) { lg[f * Ch + Channels.FL] = x[f]; lg[f * Ch + Channels.FR] = -x[f]; }
            nh.Process(lg, x.Length);
            return Up.Energy(lg, Channels.TFL, Warm);
        }
        Assert.True(Nat(40) < 0.05 * Nat(2000));
    }

    [Fact]
    public void LiveHeightGainIsSmoothedAndClamped()
    {
        Assert.Equal(Math.Pow(10, -3 / 20.0), UpmixSettings.Default.HeightGain, 4);
        Assert.Equal(Math.Pow(10, -3 / 20.0), UpmixSettings.Build(new UpmixOptions()).HeightGain, 4);
        Assert.Equal(Math.Pow(10, 6 / 20.0), UpmixSettings.Build(new UpmixOptions { HeightDb = 40 }).HeightGain, 4);
        Assert.Equal(Math.Pow(10, -24 / 20.0), UpmixSettings.Build(new UpmixOptions { HeightDb = -90 }).HeightGain, 4);
        Assert.Equal(Math.Pow(10, -3 / 20.0), UpmixSettings.Build(new UpmixOptions { HeightDb = double.NaN }).HeightGain, 4);
    }

    [Fact]
    public void NativeHeightsFromSideAndSurroundAmbience()
    {
        var nh = NativeHeights.Create(Sig.Fs, Full71And(Heights))!;
        nh.Update(UpmixSettings.Build(new UpmixOptions { HeightDb = 0 }));
        var lg = new float[N * Ch];
        var srcs = new[] { Channels.FL, Channels.FR, Channels.SL, Channels.SR, Channels.BL, Channels.BR };
        var noise = srcs.Select((c, i) => Up.Noise(N, 40 + i)).ToArray();
        for (int f = 0; f < N; f++)
            for (int i = 0; i < srcs.Length; i++) lg[f * Ch + srcs[i]] = noise[i][f];
        var src = (float[])lg.Clone();
        nh.Process(lg, N);

        for (int f = 0; f < N; f++)
            foreach (var c in Floor) Assert.Equal(src[f * Ch + c], lg[f * Ch + c]);
        // Uncorrelated pair of power p each: every height lane gets p/2 (white noise loses < 1 % to the high-pass).
        double p = Up.Energy(noise[0], Warm);
        foreach (var h in Heights)
            Assert.InRange(10 * Math.Log10(Up.Energy(lg, h, Warm) / (p / 2)), -0.5, 0.5);
        Assert.InRange(Corr(lg, Channels.TFL, Channels.TFR, Warm), -0.3, 0.3);
        Assert.InRange(Corr(lg, Channels.TBL, Channels.TBR, Warm), -0.3, 0.3);

        // Centered (mono) fronts have no side signal: no front heights.
        var nh2 = NativeHeights.Create(Sig.Fs, Full71And(Channels.TFL, Channels.TFR))!;
        var m = Up.Noise(N, 50);
        var lg2 = new float[N * Ch];
        for (int f = 0; f < N; f++) { lg2[f * Ch + Channels.FL] = lg2[f * Ch + Channels.FR] = m[f]; lg2[f * Ch + Channels.SL] = m[f]; }
        nh2.Process(lg2, N);
        Assert.Equal(0, Up.Energy(lg2, Channels.TFL, 0));
        Assert.Equal(0, Up.Energy(lg2, Channels.TBL, 0)); // TBL not used
    }

    [Fact]
    public void NativeHeightLevelIsLive()
    {
        var nh = NativeHeights.Create(Sig.Fs, Full71And(Channels.TFL))!;
        var lg = new float[N * Ch];
        var a = Up.Noise(N, 51); var b = Up.Noise(N, 52);
        for (int f = 0; f < N; f++) { lg[f * Ch + Channels.FL] = a[f]; lg[f * Ch + Channels.FR] = b[f]; }
        var x = (float[])lg.Clone();
        nh.Process(x, N);
        double e3 = Up.Energy(x, Channels.TFL, Warm);
        nh.Update(UpmixSettings.Build(new UpmixOptions { HeightDb = -15 }));
        x = (float[])lg.Clone();
        nh.Process(x, N);
        Assert.InRange(10 * Math.Log10(Up.Energy(x, Channels.TFL, Warm) / e3), -12.3, -11.7);
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void NativeDetectionStillWorksWithHeights(string mode)
    {
        var layout = Full71And(Heights);
        var up = Up.Make(mode, layout);
        var a = new AdaptiveUpmix(Sig.Fs, up, adaptive: true, NativeHeights.Create(Sig.Fs, layout));
        int n = Sig.Fs;
        var l = Up.Noise(n, 53); var r = Up.Noise(n, 54);

        // 7.1 stream carrying only stereo: upmixed, heights from the upmixer.
        var lg = new float[n * Ch];
        for (int f = 0; f < n; f++) { lg[f * Ch + Channels.FL] = l[f]; lg[f * Ch + Channels.FR] = r[f]; }
        Run(a, lg);
        Assert.Equal(UpmixState.Stereo, a.State);
        Assert.True(Up.Energy(lg, Up.Surrounds, n / 2) > 0);
        Assert.True(Up.Energy(lg, Heights, n / 2) > 0);

        // Real surround content: native within 10 ms, floor lanes pass through exactly, rear heights from SL.
        var sl = Up.Noise(n, 55);
        lg = new float[n * Ch];
        for (int f = 0; f < n; f++) { lg[f * Ch + Channels.FL] = l[f]; lg[f * Ch + Channels.FR] = r[f]; lg[f * Ch + Channels.SL] = sl[f]; }
        var src = (float[])lg.Clone();
        a.Process(lg.AsSpan(0, 480 * Ch), 480);
        Assert.Equal(UpmixState.Native, a.State);
        Run(a, lg.AsSpan(480 * Ch));
        int lat = up.LatencyFrames, settled = (int)(0.05 * Sig.Fs) + lat;
        for (int f = settled; f < n; f++)
            foreach (var c in Floor) Assert.Equal(src[(f - lat) * Ch + c], lg[f * Ch + c], 6);
        Assert.True(Up.Energy(lg, Channels.TBL, settled) > 0.05 * Up.Energy(sl, settled));
        Assert.True(Up.Energy(lg, Channels.TFL, settled) > 0.05 * Up.Energy(l, settled));
    }

    private static void Run(AdaptiveUpmix a, Span<float> lg, int block = 480)
    {
        for (int p = 0; p < lg.Length / Ch; p += block)
        {
            int c = Math.Min(block, lg.Length / Ch - p);
            a.Process(lg.Slice(p * Ch, c * Ch), c);
        }
    }

    [Theory]
    [MemberData(nameof(Modes))]
    public void NoNaNsOnSilence(string mode)
    {
        var layout = Full71And(Heights);
        var nh = NativeHeights.Create(Sig.Fs, layout)!;
        var a = new AdaptiveUpmix(Sig.Fs, Up.Make(mode, layout), adaptive: true, NativeHeights.Create(Sig.Fs, layout));
        int n = Sig.Fs * 6;
        var lg = new float[n * Ch];
        nh.Process(lg, n);
        Run(a, lg);
        Assert.All(lg, v => Assert.Equal(0f, v));

        // Signal on every source lane, then a long silence: decays to (exact) zero, never NaN or subnormal.
        var lg2 = new float[n * Ch];
        for (int c = 0; c < Channels.SourceCount; c++)
        {
            var x = Up.Noise(Sig.Fs, 60 + c);
            for (int f = 0; f < Sig.Fs; f++) lg2[f * Ch + c] = x[f];
        }
        var lg3 = (float[])lg2.Clone();
        nh.Process(lg2, n);
        Run(a, lg3);
        foreach (var buf in new[] { lg2, lg3 })
        {
            foreach (var v in buf) Assert.True(float.IsFinite(v) && !float.IsSubnormal(v));
            for (int i = buf.Length - Sig.Fs * Ch; i < buf.Length; i++) Assert.True(Math.Abs(buf[i]) < 1e-9f);
        }
    }

    [Fact]
    public void HeightLanesAreNeverFolded()
    {
        foreach (var used in new[] { Up.Used(Channels.FL, Channels.FR), Up.Used(Channels.FL, Channels.FR, Channels.TFL, Channels.TFR), Up.Used(Channels.TFL) })
        {
            var plan = ChannelFold.Plan(used);
            if (plan is null) continue;
            Assert.DoesNotContain(plan.Ops, o => Channels.IsHeight(o.Src) || Channels.IsHeight(o.Dst));
        }
        // A 7.1 + heights layout needs no fold.
        Assert.Null(ChannelFold.Plan(Up.Used(Full71.Concat(Heights).ToArray())));
    }

    [Fact]
    public void GlobalProcessingCoversUsedHeightLanesOnly()
    {
        var cfg = new ProcessingConfig { PreampDb = -6, Ambience = 1 };
        float[] Run(IReadOnlyList<bool>? used)
        {
            var p = new GlobalProcessor(Sig.Fs, used);
            p.Update(ProcessingSettings.Build(cfg, Sig.Fs));
            var lg = new float[Sig.Fs * Ch];
            for (int f = 0; f < Sig.Fs; f++) { lg[f * Ch + Channels.FL] = 0.4f; lg[f * Ch + Channels.TFL] = 0.4f; lg[f * Ch + Channels.TFR] = 0.2f; }
            p.Process(lg, Sig.Fs);
            return lg;
        }
        int last = (Sig.Fs - 1) * Ch;
        var off = Run(Up.Used(Full71));
        Assert.Equal(0.4f, off[last + Channels.TFL]);
        var on = Run(Up.Used(Full71.Concat(Heights).ToArray()));
        // -6 dB preamp, then the side doubled: mid 0.3, side 0.1 → 0.5 / 0.1.
        float G6 = (float)Math.Pow(10, -6 / 20.0);
        Assert.Equal(G6 * 0.5f, on[last + Channels.TFL], 3);
        Assert.Equal(G6 * 0.1f, on[last + Channels.TFR], 3);
        Assert.Equal(on[last + Channels.FL], off[last + Channels.FL]);
    }
}

public class HeightConfigTests
{
    private const string OldJson = """
    {
      "source": { "deviceId": "SRC", "mode": "loopback" },
      "upmix": true,
      "upmixOptions": { "mode": "game", "centerDb": -2, "surroundDb": 1, "lfeEnabled": true },
      "outputs": [ { "deviceId": "A" } ],
      "speakers": [
        { "name": "L", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 1, "SL": 0.707 } },
        { "name": "R", "outputDeviceId": "A", "deviceChannel": 2, "source": { "FR": 1, "SR": 0.707 } }
      ]
    }
    """;

    [Fact]
    public void OldEightChannelConfigRoundTrips()
    {
        var cfg = SurroundConfig.Parse(OldJson);
        Assert.Equal(-3, cfg.UpmixOptions.HeightDb);
        Assert.Empty(ConfigValidator.Validate(cfg));
        var back = SurroundConfig.Parse(cfg.ToJson());
        Assert.Equal(cfg.EngineFingerprint(), back.EngineFingerprint());
        Assert.Equal(cfg.Speakers[0].Source, back.Speakers[0].Source);
        Assert.Equal(-2, back.UpmixOptions.CenterDb);

        // Same used set (and fold plan) as before: no height lane is used, so none is derived.
        var rows = cfg.Speakers.Select(s =>
        {
            var row = new float[Channels.Count];
            foreach (var (k, v) in s.Source) row[Channels.IndexOf(k)] = (float)v;
            return (row, s.Mute);
        });
        var used = ChannelFold.UsedChannels(rows);
        Assert.Equal(12, used.Length);
        Assert.DoesNotContain(Enumerable.Range(Channels.SourceCount, 4), c => used[c]);
        var ops = ChannelFold.Plan(used)!.Ops.ToHashSet();
        float h = 1 / MathF.Sqrt(2);
        Assert.Equal(new HashSet<(int, int, float)>
        {
            (Channels.FC, Channels.FL, h), (Channels.FC, Channels.FR, h), (Channels.BL, Channels.SL, 1f), (Channels.BR, Channels.SR, 1f),
        }, ops);
        Assert.False(new UpmixLayout(used, false).AnyHeight);
    }

    [Fact]
    public void HeightNamesAndRangeValidate()
    {
        var cfg = SurroundConfig.Parse(OldJson);
        cfg.Speakers[0].Source = new() { ["tfl"] = 1, ["TBR"] = 0.5 };
        cfg.UpmixOptions.HeightDb = 6;
        Assert.Empty(ConfigValidator.Validate(cfg));

        cfg.Speakers[0].Source = new() { ["TOP"] = 1 };
        cfg.UpmixOptions.HeightDb = -25;
        var e = ConfigValidator.Validate(cfg);
        Assert.Contains(e, m => m.Contains("bilinmeyen kanal adı 'TOP'") && m.Contains("TFL, TFR, TBL, TBR"));
        Assert.Contains(e, m => m.Contains("upmixOptions.heightDb") && m.Contains("-24..6"));
        cfg.UpmixOptions.HeightDb = 7;
        Assert.Contains(ConfigValidator.Validate(cfg), m => m.Contains("upmixOptions.heightDb"));
    }

    [Fact]
    public void FingerprintIgnoresHeightDb()
    {
        var a = SurroundConfig.Parse(OldJson);
        var b = SurroundConfig.Parse(OldJson);
        b.UpmixOptions.HeightDb = -18;
        Assert.Equal(a.EngineFingerprint(), b.EngineFingerprint());
        Assert.Equal(-18, SurroundConfig.Parse(b.ToJson()).UpmixOptions.HeightDb);
    }
}
