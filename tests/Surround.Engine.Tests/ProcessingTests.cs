using Surround.Engine;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

internal static class Sig
{
    public const int Fs = 48000;

    public static float[] Sine(double hz, int frames, float amp = 0.5f)
    {
        var x = new float[frames];
        for (int i = 0; i < frames; i++) x[i] = amp * (float)Math.Sin(2 * Math.PI * hz * i / Fs);
        return x;
    }

    public static double Rms(ReadOnlySpan<float> x, int from = 0, int stride = 1, int offset = 0)
    {
        double s = 0; int n = 0;
        for (int i = from * stride + offset; i < x.Length; i += stride) { s += x[i] * x[i]; n++; }
        return Math.Sqrt(s / Math.Max(1, n));
    }

    public static double Db(double ratio) => 20 * Math.Log10(ratio);

    /// <summary>Same mono signal on all logical channels.</summary>
    public static float[] Logical(float[] mono)
    {
        var lg = new float[mono.Length * Channels.Count];
        for (int f = 0; f < mono.Length; f++)
            for (int c = 0; c < Channels.Count; c++) lg[f * Channels.Count + c] = mono[f];
        return lg;
    }
}

public class EqTests
{
    private static double GainDb(BiquadCoefs[] stages, double hz)
    {
        const int n = Sig.Fs;
        var x = Sig.Sine(hz, n);
        var z = new double[stages.Length * 2];
        var y = new float[n];
        for (int i = 0; i < n; i++) y[i] = (float)BiquadCascade.Process(stages, z, x[i]);
        return Sig.Db(Sig.Rms(y, n / 2) / Sig.Rms(x, n / 2));
    }

    [Fact]
    public void FlatEqIsIdentity()
    {
        var st = EqDesign.TenBand(Sig.Fs, new double[10]);
        Assert.True(EqDesign.IsFlat(st));
        var x = Sig.Sine(1000, 1000);
        var z = new double[st.Length * 2];
        for (int i = 0; i < x.Length; i++) Assert.Equal(x[i], (float)BiquadCascade.Process(st, z, x[i]), 6);
    }

    [Theory]
    [InlineData(2, 125.0)]
    [InlineData(5, 1000.0)]
    [InlineData(7, 4000.0)]
    public void BandBoostsItsOwnFrequency(int band, double hz)
    {
        var g = new double[10];
        g[band] = 6;
        var st = EqDesign.TenBand(Sig.Fs, g);
        Assert.InRange(GainDb(st, hz), 5.5, 6.5);
        Assert.InRange(GainDb(st, hz * 8), -0.1, 0.6);
        Assert.InRange(GainDb(st, hz / 8), -0.1, 0.6);
    }

    [Fact]
    public void EndBandsAreShelves()
    {
        var g = new double[10];
        g[0] = -6; g[9] = 6;
        var st = EqDesign.TenBand(Sig.Fs, g);
        Assert.InRange(GainDb(st, 15), -6.5, -5);
        Assert.InRange(GainDb(st, 20000), 5, 6.5);
        Assert.InRange(GainDb(st, 1000), -0.3, 0.3);
    }
}

public class LinkwitzRileyTests
{
    [Theory]
    [InlineData(40.0)]
    [InlineData(80.0)]
    [InlineData(120.0)]
    [InlineData(300.0)]
    [InlineData(2000.0)]
    public void HighPassPlusLowPassKeepsMagnitude(double hz)
    {
        var hp = LinkwitzRiley.HighPass(Sig.Fs, 100);
        var lp = LinkwitzRiley.LowPass(Sig.Fs, 100);
        int n = Sig.Fs;
        var x = Sig.Sine(hz, n);
        var y = new float[n];
        for (int i = 0; i < n; i++) y[i] = hp.Process(x[i]) + lp.Process(x[i]);
        Assert.InRange(Sig.Db(Sig.Rms(y, n / 2) / Sig.Rms(x, n / 2)), -0.1, 0.1);
    }

    [Fact]
    public void HighPassCutsBelowCrossover()
    {
        var hp = LinkwitzRiley.HighPass(Sig.Fs, 120);
        int n = Sig.Fs;
        var x = Sig.Sine(30, n);
        var y = new float[n];
        for (int i = 0; i < n; i++) y[i] = hp.Process(x[i]);
        Assert.True(Sig.Db(Sig.Rms(y, n / 2) / Sig.Rms(x, n / 2)) < -40);
    }
}

public class LimiterTests
{
    [Fact]
    public void NeverExceedsCeiling()
    {
        var lim = new PeakLimiter(2, Sig.Fs);
        var rnd = new Random(3);
        const int frames = Sig.Fs;
        var buf = new float[frames * 2];
        for (int i = 0; i < buf.Length; i++)
        {
            double burst = (i / 2) % 4800 < 600 ? 4.0 : 0.3; // loud bursts with quiet gaps
            buf[i] = (float)((rnd.NextDouble() * 2 - 1) * burst);
        }
        for (int off = 0; off < frames; off += 480) lim.Process(buf.AsSpan(off * 2, 480 * 2), 480);
        float max = buf.Max(Math.Abs);
        Assert.True(max <= PeakLimiter.DefaultCeiling + 1e-6f, $"max {max}");
    }

    [Fact]
    public void QuietSignalPassesUnchangedAfterLatency()
    {
        var lim = new PeakLimiter(1, Sig.Fs);
        var x = Sig.Sine(1000, 2000, 0.5f);
        var y = (float[])x.Clone();
        lim.Process(y, y.Length);
        int d = lim.LatencyFrames;
        Assert.True(d > 0 && d <= Sig.Fs / 500); // <= 2 ms
        for (int i = d; i < y.Length; i++) Assert.Equal(x[i - d], y[i], 6);
    }

    [Fact]
    public void LinkedGainKeepsChannelRatio()
    {
        var lim = new PeakLimiter(2, Sig.Fs);
        const int n = 4800;
        var buf = new float[n * 2];
        for (int f = 0; f < n; f++) { float v = 2f * (float)Math.Sin(f * 0.05); buf[f * 2] = v; buf[f * 2 + 1] = 0.5f * v; }
        lim.Process(buf, n);
        for (int f = 2400; f < n; f++)
            if (Math.Abs(buf[f * 2]) > 0.05f) Assert.Equal(0.5f, buf[f * 2 + 1] / buf[f * 2], 3);
    }

    [Fact]
    public void DisabledLimiterOnlyDelays()
    {
        var lim = new PeakLimiter(1, Sig.Fs) { Enabled = false };
        var x = Sig.Sine(100, 1000, 3f);
        var y = (float[])x.Clone();
        lim.Process(y, y.Length);
        for (int i = lim.LatencyFrames; i < y.Length; i++) Assert.Equal(x[i - lim.LatencyFrames], y[i]);
    }
}

public class GlobalProcessorTests
{
    private static float[] Run(GlobalProcessor p, float[] mono)
    {
        var lg = Sig.Logical(mono);
        for (int off = 0; off < mono.Length; off += 480)
        {
            int k = Math.Min(480, mono.Length - off);
            p.Process(lg.AsSpan(off * Channels.Count, k * Channels.Count), k);
        }
        return lg;
    }

    [Fact]
    public void DefaultSettingsAreTransparent()
    {
        var p = new GlobalProcessor(Sig.Fs);
        p.Update(ProcessingSettings.Build(new ProcessingConfig(), Sig.Fs));
        var x = Sig.Sine(440, 4800);
        var lg = Run(p, x);
        for (int f = 0; f < x.Length; f++) Assert.Equal(x[f], lg[f * Channels.Count + Channels.BL], 6);
    }

    [Fact]
    public void LiveUpdateChangesGain()
    {
        var p = new GlobalProcessor(Sig.Fs);
        p.Update(ProcessingSettings.Build(new ProcessingConfig(), Sig.Fs));
        var x = Sig.Sine(1000, Sig.Fs / 2);
        var before = Run(p, x);
        p.Update(ProcessingSettings.Build(new ProcessingConfig { PreampDb = -6 }, Sig.Fs));
        var after = Run(p, x);
        double db = Sig.Db(Sig.Rms(after, x.Length / 2, Channels.Count) / Sig.Rms(before, x.Length / 2, Channels.Count));
        Assert.InRange(db, -6.1, -5.9);
    }

    [Fact]
    public void BassBoostRaisesLowsOnly()
    {
        double Gain(double hz)
        {
            var p = new GlobalProcessor(Sig.Fs);
            p.Update(ProcessingSettings.Build(new ProcessingConfig { BassBoostDb = 9 }, Sig.Fs));
            var x = Sig.Sine(hz, Sig.Fs);
            var y = Run(p, x);
            return Sig.Db(Sig.Rms(y, Sig.Fs / 2, Channels.Count) / Sig.Rms(x, Sig.Fs / 2));
        }
        Assert.InRange(Gain(40), 7.5, 9.5);
        Assert.InRange(Gain(3000), -0.2, 0.3);
    }

    [Fact]
    public void DynamicBoostLiftsQuietMoreThanLoud()
    {
        double Gain(float amp)
        {
            var p = new GlobalProcessor(Sig.Fs);
            p.Update(ProcessingSettings.Build(new ProcessingConfig { DynamicBoost = 1 }, Sig.Fs));
            var x = Sig.Sine(1000, Sig.Fs, amp);
            var y = Run(p, x);
            return Sig.Db(Sig.Rms(y, Sig.Fs / 2, Channels.Count) / Sig.Rms(x, Sig.Fs / 2));
        }
        double quiet = Gain(0.01f), loud = Gain(0.9f);
        Assert.True(quiet > loud + 6, $"quiet {quiet:F1} dB, loud {loud:F1} dB");
        Assert.True(quiet > 3);
    }

    [Fact]
    public void AmbienceWidensSideOnly()
    {
        var p = new GlobalProcessor(Sig.Fs);
        p.Update(ProcessingSettings.Build(new ProcessingConfig { Ambience = 1 }, Sig.Fs));
        const int n = Sig.Fs;
        var lg = new float[n * Channels.Count];
        for (int f = 0; f < n; f++) { lg[f * Channels.Count + Channels.FL] = 0.3f; lg[f * Channels.Count + Channels.FR] = 0.1f; }
        p.Process(lg, n);
        int last = (n - 1) * Channels.Count;
        // mid 0.2 kept, side 0.1 doubled
        Assert.Equal(0.4f, lg[last + Channels.FL], 4);
        Assert.Equal(0.0f, lg[last + Channels.FR], 4);
    }

    [Fact]
    public void DisabledSkipsProcessing()
    {
        var p = new GlobalProcessor(Sig.Fs);
        p.Update(ProcessingSettings.Build(new ProcessingConfig { Enabled = false, PreampDb = -12, BassBoostDb = 12 }, Sig.Fs));
        var x = Sig.Sine(60, 2000);
        var lg = Run(p, x);
        for (int f = 0; f < x.Length; f++) Assert.Equal(x[f], lg[f * Channels.Count + Channels.FL]);
    }
}

public class BassManagementTests
{
    private static float[] Row(int ch) { var r = new float[Channels.Count]; r[ch] = 1f; return r; }

    [Fact]
    public void CutBassReachesReceiversAndSumIsFlat()
    {
        // Rear left is high-passed at 100 Hz; two front receivers share the cut bass.
        var bm = new BassManager(Sig.Fs, new[] { new BassSource(Row(Channels.BL), 0, 100) });
        var routes = new[]
        {
            new SpeakerRoute("FL", 0, Row(Channels.FL), 0, false, 0, BassShare: 0.5f),
            new SpeakerRoute("FR", 1, Row(Channels.FR), 0, false, 0, BassShare: 0.5f),
            new SpeakerRoute("BL", 2, Row(Channels.BL), 0, false, 0, HighPassHz: 100),
        };
        var mixer = new SinkMixer(3, routes, Sig.Fs);

        double Measure(double hz, out double rear, out double front)
        {
            int n = Sig.Fs;
            var mono = Sig.Sine(hz, n);
            var lg = new float[n * Channels.Count];
            for (int f = 0; f < n; f++) lg[f * Channels.Count + Channels.BL] = mono[f];
            var bass = new float[n];
            bm.Process(lg, bass, n);
            var ring = new RingBuffer(n * 3, 3);
            mixer.Process(lg, bass, n, ring);
            var o = new float[n * 3];
            ring.Read(o);
            rear = Sig.Rms(o, n / 2, 3, 2) / Sig.Rms(mono, n / 2);
            front = Sig.Rms(o, n / 2, 3, 0) / Sig.Rms(mono, n / 2);
            var sum = new float[n];
            for (int f = 0; f < n; f++) sum[f] = o[f * 3] + o[f * 3 + 1] + o[f * 3 + 2];
            return Sig.Db(Sig.Rms(sum, n / 2) / Sig.Rms(mono, n / 2));
        }

        double lowSum = Measure(40, out double rearLow, out double frontLow);
        Assert.True(Sig.Db(rearLow) < -20);          // the satellite is protected
        Assert.InRange(frontLow, 0.45, 0.52);        // each receiver gets half
        Assert.InRange(lowSum, -0.3, 0.3);           // nothing lost acoustically

        double highSum = Measure(1000, out double rearHigh, out double frontHigh);
        Assert.InRange(Sig.Db(rearHigh), -0.2, 0.2);
        Assert.True(frontHigh < 0.01);
        Assert.InRange(highSum, -0.2, 0.2);
    }

    [Fact]
    public void SpeakerEqLiveUpdateChangesLevel()
    {
        var routes = new[] { new SpeakerRoute("a", 0, Row(Channels.FL), 0, false, 0) };
        var mixer = new SinkMixer(1, routes, Sig.Fs);
        int n = Sig.Fs / 2;
        var lg = new float[n * Channels.Count];
        var x = Sig.Sine(1000, n);
        for (int f = 0; f < n; f++) lg[f * Channels.Count] = x[f];

        double Level()
        {
            var ring = new RingBuffer(n, 1);
            mixer.Process(lg, n, ring);
            var o = new float[n];
            ring.Read(o);
            return Sig.Rms(o, n / 2);
        }
        double flat = Level();
        var eq = new double[10]; eq[5] = -6;
        mixer.SetEq(new[] { eq });
        Assert.InRange(Sig.Db(Level() / flat), -6.2, -5.8);
        mixer.SetEq(new double[]?[] { null });
        Assert.InRange(Sig.Db(Level() / flat), -0.05, 0.05);
    }

    [Fact]
    public void LimiterInSinkKeepsDeviceUnderCeiling()
    {
        var routes = new[] { new SpeakerRoute("a", 0, Row(Channels.FL), 12, false, 0) };
        var mixer = new SinkMixer(1, routes, Sig.Fs, new PeakLimiter(1, Sig.Fs));
        int n = 9600;
        var lg = new float[n * Channels.Count];
        var x = Sig.Sine(200, n, 0.9f);
        for (int f = 0; f < n; f++) lg[f * Channels.Count] = x[f];
        var ring = new RingBuffer(n, 1);
        mixer.Process(lg, n, ring);
        var o = new float[n];
        ring.Read(o);
        Assert.True(o.Max(Math.Abs) <= PeakLimiter.DefaultCeiling + 1e-6f);
        Assert.True(o.Max(Math.Abs) > 0.85f);
    }
}

public class ChannelMapTests
{
    [Fact]
    public void WideSourceUsesFirstEightAs71()
    {
        var map = Channels.MapForSourceChannels(16);
        Assert.Equal(Enumerable.Range(0, 8), map);
    }

    [Fact]
    public void SixChannelsAre51()
    {
        Assert.Equal(new[] { Channels.FL, Channels.FR, Channels.FC, Channels.LFE, Channels.BL, Channels.BR }, Channels.MapForSourceChannels(6));
    }
}

public class ProcessingConfigTests
{
    private const string Json = """
    {
      "source": { "deviceId": "SRC", "mode": "loopback" },
      "outputs": [ { "deviceId": "A" } ],
      "speakers": [
        { "name": "FL", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 1 }, "bassReceiver": true },
        { "name": "RL", "outputDeviceId": "A", "deviceChannel": 2, "source": { "BL": 1 }, "highPassHz": 120,
          "eq": [0,0,0,0,0,0,0,0,0,0], "eqPreset": "x" }
      ],
      "processing": { "preampDb": -3, "eq": [1,2,3,4,5,6,7,8,9,10], "dynamicBoost": 0.5, "preset": "music", "uiOnly": 1 }
    }
    """;

    [Fact]
    public void ParsesWithDefaultsAndValidates()
    {
        var cfg = SurroundConfig.Parse(Json);
        Assert.Equal(-3, cfg.Processing.PreampDb);
        Assert.True(cfg.Processing.Limiter);
        Assert.True(cfg.Processing.Enabled);
        Assert.Equal(120, cfg.Speakers[1].HighPassHz);
        Assert.True(cfg.Speakers[0].BassReceiver);
        Assert.Null(cfg.Speakers[0].Eq);
        Assert.Empty(ConfigValidator.Validate(cfg));
        Assert.Contains("uiOnly", SurroundConfig.Parse(cfg.ToJson()).Processing.Extra!.Keys);

        var bare = SurroundConfig.Parse("""{ "source": { "deviceId": "S" }, "processing": null }""");
        Assert.Equal(10, bare.Processing.Eq.Length);
        Assert.Equal("flat", bare.Processing.Preset);
    }

    [Fact]
    public void FingerprintIgnoresProcessingAndSpeakerEq()
    {
        var a = SurroundConfig.Parse(Json);
        var b = SurroundConfig.Parse(Json);
        b.Processing.PreampDb = 6; b.Processing.Limiter = false; b.Processing.Eq[3] = -12;
        b.Speakers[1].Eq = new double[10]; b.Speakers[1].Eq![0] = 5; b.Speakers[1].EqPreset = "y";
        Assert.Equal(a.EngineFingerprint(), b.EngineFingerprint());

        var c = SurroundConfig.Parse(Json);
        c.Speakers[1].HighPassHz = 80;
        Assert.NotEqual(a.EngineFingerprint(), c.EngineFingerprint());
        var d = SurroundConfig.Parse(Json);
        d.Speakers[1].BassReceiver = false; d.Speakers[0].BassReceiver = false;
        Assert.NotEqual(a.EngineFingerprint(), d.EngineFingerprint());
    }

    [Fact]
    public void RejectsOutOfRangeValues()
    {
        var cfg = SurroundConfig.Parse(Json);
        cfg.Processing.PreampDb = 20;
        cfg.Processing.Eq = new double[9];
        cfg.Processing.Ambience = 2;
        cfg.Speakers[1].HighPassHz = 20;
        cfg.Speakers[1].Eq = new double[10]; cfg.Speakers[1].Eq![2] = 13;
        cfg.Speakers[0].HighPassHz = 100; // also a receiver
        var e = ConfigValidator.Validate(cfg);
        Assert.Contains(e, m => m.Contains("preampDb"));
        Assert.Contains(e, m => m.Contains("processing.eq") && m.Contains("10 bant"));
        Assert.Contains(e, m => m.Contains("ambience"));
        Assert.Contains(e, m => m.Contains("'RL'") && m.Contains("highPassHz"));
        Assert.Contains(e, m => m.Contains("'RL': eq[2]"));
        Assert.Contains(e, m => m.Contains("'FL'") && m.Contains("bassReceiver"));
    }

    [Fact]
    public void SpeakerEqNullIsNotWritten()
    {
        var cfg = SurroundConfig.Parse(Json);
        using var doc = System.Text.Json.JsonDocument.Parse(cfg.ToJson());
        var sp = doc.RootElement.GetProperty("speakers");
        Assert.False(sp[0].TryGetProperty("eq", out _));
        Assert.True(sp[1].TryGetProperty("eq", out _));
        Assert.True(doc.RootElement.GetProperty("processing").GetProperty("limiter").GetBoolean());
    }
}
