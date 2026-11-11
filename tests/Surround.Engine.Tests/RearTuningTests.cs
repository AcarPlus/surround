using Surround.Engine;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

/// <summary>Live rear-channel tuning of the upmix: surroundDelayMs, surroundHighCutHz, diffusion.</summary>
public class RearTuningTests
{
    private const int Fs = Sig.Fs, Ch = Channels.Count;

    /// <summary>The renderer exactly as it was before the tuning options existed (fixed 10 ms delay, g = 0.5 all-pass).</summary>
    private sealed class LegacyRenderer
    {
        private readonly Decorrelator _l1 = new(Fs, 1.9, 4.4, 7.9), _l2 = new(Fs, 2.7, 5.3, 9.1), _r1 = new(Fs, 2.3, 4.9, 8.3), _r2 = new(Fs, 3.1, 5.9, 9.7);
        private readonly DelayLine _dSL, _dBL, _dSR, _dBR;
        private readonly bool _lPair, _rPair, _lBack, _rBack;

        public LegacyRenderer(UpmixLayout layout)
        {
            int d = (int)Math.Round(10.0 * Fs / 1000);
            _dSL = new DelayLine(d); _dBL = new DelayLine(d); _dSR = new DelayLine(d); _dBR = new DelayLine(d);
            _lPair = layout.Has(Channels.SL) && layout.Has(Channels.BL);
            _rPair = layout.Has(Channels.SR) && layout.Has(Channels.BR);
            _lBack = !layout.Has(Channels.SL) && layout.Has(Channels.BL);
            _rBack = !layout.Has(Channels.SR) && layout.Has(Channels.BR);
        }

        public void Render(float al, float ar, float g, float sl, float bl, float sr, float br, Span<float> frame)
        {
            float h1 = _l1.Process(al) * g;
            if (_lPair) { float h2 = _l2.Process(al) * g; sl += 0.5f * (h1 + h2); bl += 0.5f * (h1 - h2); }
            else if (_lBack) bl += h1; else sl += h1;
            h1 = _r1.Process(ar) * g;
            if (_rPair) { float h2 = _r2.Process(ar) * g; sr += 0.5f * (h1 + h2); br += 0.5f * (h1 - h2); }
            else if (_rBack) br += h1; else sr += h1;
            frame[Channels.SL] = _dSL.Process(sl); frame[Channels.BL] = _dBL.Process(bl);
            frame[Channels.SR] = _dSR.Process(sr); frame[Channels.BR] = _dBR.Process(br);
        }
    }

    private static float[] Run(SurroundRenderer r, float[] al, float[] ar, int block = 480)
    {
        var o = new float[al.Length * Ch];
        for (int f = 0; f < al.Length; f++) r.Render(al[f], ar[f], 1f, 0.1f * al[f], 0f, 0f, 0.1f * ar[f], o.AsSpan(f * Ch, Ch));
        return o;
    }

    public static TheoryData<int> Layouts => new() { 0, 1, 2 };

    private static UpmixLayout Layout(int k) => k switch
    {
        0 => UpmixLayout.Full,
        1 => new UpmixLayout(Up.FrontsAndRears, false),
        _ => new UpmixLayout(Up.Used(Channels.FL, Channels.FR, Channels.SL, Channels.SR), false),
    };

    [Theory]
    [MemberData(nameof(Layouts))]
    public void DefaultsAreIdenticalToTheLegacyRenderer(int layoutKind)
    {
        var layout = Layout(layoutKind);
        var al = Up.Noise(Fs, 11); var ar = Up.Noise(Fs, 12);
        var legacy = new LegacyRenderer(layout);
        var expect = new float[al.Length * Ch];
        for (int f = 0; f < al.Length; f++)
            legacy.Render(al[f], ar[f], 1f, 0.1f * al[f], 0f, 0f, 0.1f * ar[f], expect.AsSpan(f * Ch, Ch));

        foreach (var st in new[] { UpmixSettings.Default, UpmixSettings.Build(new UpmixOptions()) })
        {
            var r = new SurroundRenderer(Fs, layout);
            r.Configure(st);
            var got = Run(r, al, ar);
            for (int i = 0; i < got.Length; i++) Assert.Equal(expect[i], got[i]);
        }
    }

    [Fact]
    public void DefaultsKeepTheDocumentedValues()
    {
        var o = new UpmixOptions();
        Assert.Equal(10, o.SurroundDelayMs);
        Assert.Equal(0, o.SurroundHighCutHz);
        Assert.Equal(1, o.Diffusion);
        var st = UpmixSettings.Build(o);
        Assert.Equal(10, st.SurroundDelayMs);
        Assert.Equal(0, st.HighCutHz);
        Assert.Equal(1, st.Diffusion);
    }

    [Fact]
    public void HighCutAttenuatesTheRearButNotTheLows()
    {
        const int n = Fs;
        var layout = new UpmixLayout(Up.FrontsAndRears, false);
        double Gain(double hz, double cut)
        {
            var x = Sig.Sine(hz, n);
            var r = new SurroundRenderer(Fs, layout);
            r.Configure(UpmixSettings.Build(new UpmixOptions { SurroundHighCutHz = cut, Diffusion = 0 }));
            var o = Run(r, x, x);
            double rear = Sig.Rms(o, Fs / 2, Ch, Channels.BL);
            // Reference: the same without the cut.
            var r0 = new SurroundRenderer(Fs, layout);
            r0.Configure(UpmixSettings.Build(new UpmixOptions { Diffusion = 0 }));
            double rear0 = Sig.Rms(Run(r0, x, x), Fs / 2, Ch, Channels.BL);
            return Sig.Db(rear / rear0);
        }
        Assert.True(Gain(10000, 4000) < -8, "10 kHz must drop with a 4 kHz cut");
        Assert.InRange(Gain(500, 4000), -0.5, 0.1);
        Assert.InRange(Gain(4000, 4000), -3.6, -2.4); // Butterworth: -3 dB at the cutoff
    }

    [Theory]
    [InlineData("game")]
    [InlineData("film")]
    public void HighCutAppliesLiveThroughBothUpmixers(string mode)
    {
        var l = Up.Noise(Fs * 2, 5); var r = Up.Noise(Fs * 2, 6);
        var layout = new UpmixLayout(Up.FrontsAndRears, false);
        double RearHf(UpmixOptions o)
        {
            var up = Up.Make(mode, layout);
            up.Update(UpmixSettings.Build(o));
            var lg = Up.Run(up, l, r);
            // High-passed energy proxy: first difference emphasises the highs.
            double e = 0;
            for (int f = Fs; f < l.Length; f++)
                foreach (int c in new[] { Channels.BL, Channels.BR })
                { double d = lg[f * Ch + c] - lg[(f - 1) * Ch + c]; e += d * d; }
            return e;
        }
        Assert.True(RearHf(new UpmixOptions { SurroundHighCutHz = 3000 }) < 0.3 * RearHf(new UpmixOptions()));
    }

    [Fact]
    public void DiffusionZeroRemovesTheAllPassSmearing()
    {
        var layout = UpmixLayout.Full;
        var imp = new float[Fs / 2];
        imp[100] = 1f;
        var r = new SurroundRenderer(Fs, layout);
        r.Configure(UpmixSettings.Build(new UpmixOptions { Diffusion = 0 }));
        var o = new float[imp.Length * Ch];
        for (int f = 0; f < imp.Length; f++) r.Render(imp[f], 0f, 1f, 0, 0, 0, 0, o.AsSpan(f * Ch, Ch));
        // Pair collapses to side = A, back = 0; the impulse appears once, exactly 10 ms later.
        int d = (int)Math.Round(10.0 * Fs / 1000);
        for (int f = 0; f < imp.Length; f++)
        {
            Assert.Equal(f == 100 + d ? 1f : 0f, o[f * Ch + Channels.SL]);
            Assert.Equal(0f, o[f * Ch + Channels.BL]);
        }
        // With full diffusion the same impulse is smeared over many samples.
        var r1 = new SurroundRenderer(Fs, layout);
        r1.Configure(UpmixSettings.Default);
        int nonZero = 0;
        for (int f = 0; f < imp.Length; f++)
        {
            var fr = new float[Ch];
            r1.Render(imp[f], 0f, 1f, 0, 0, 0, 0, fr);
            if (Math.Abs(fr[Channels.SL]) > 1e-4f) nonZero++;
        }
        Assert.True(nonZero > 20);
    }

    [Fact]
    public void DiffusionHalfIsBetweenTheExtremes()
    {
        var x = Up.Noise(Fs, 3);
        var layout = UpmixLayout.Full;
        double Back(double d)
        {
            var r = new SurroundRenderer(Fs, layout);
            r.Configure(UpmixSettings.Build(new UpmixOptions { Diffusion = d }));
            return Sig.Rms(Run(r, x, x), Fs / 2, Ch, Channels.BL);
        }
        Assert.True(Back(0) < Back(0.5) && Back(0.5) < Back(1));
    }

    [Fact]
    public void DelayChangeIsClickFreeAndSettlesExactly()
    {
        var layout = new UpmixLayout(Up.FrontsAndRears, false);
        const int n = Fs;
        var x = Sig.Sine(1000, n, 0.5f);
        foreach (var (from, to) in new[] { (10.0, 25.0), (25.0, 0.0), (10.0, 10.5) })
        {
            var r = new SurroundRenderer(Fs, layout);
            var o0 = new UpmixOptions { Diffusion = 0, SurroundDelayMs = from };
            r.Configure(UpmixSettings.Build(o0));
            var o = new float[n * Ch];
            for (int f = 0; f < n; f++)
            {
                if (f == Fs / 4) r.Configure(UpmixSettings.Build(new UpmixOptions { Diffusion = 0, SurroundDelayMs = to }));
                r.Render(x[f], x[f], 1f, 0, 0, 0, 0, o.AsSpan(f * Ch, Ch));
            }
            // A 1 kHz sine at 0.5 changes by at most ~0.065 per sample; a click would be far larger.
            double maxJump = 0;
            for (int f = Fs / 8; f < n; f++) maxJump = Math.Max(maxJump, Math.Abs(o[f * Ch + Channels.BL] - o[(f - 1) * Ch + Channels.BL]));
            Assert.True(maxJump < 0.1, $"{from}->{to} ms: jump {maxJump:0.000}");
            // Settled: the output is the input delayed by `to` ms.
            int dTo = (int)Math.Round(to * Fs / 1000);
            for (int f = n - 100; f < n; f++) Assert.Equal(x[f - dTo], o[f * Ch + Channels.BL], 5);
        }
    }

    [Fact]
    public void HighCutSwitchedOnAndOffIsClickFree()
    {
        var layout = new UpmixLayout(Up.FrontsAndRears, false);
        const int n = Fs;
        var x = Sig.Sine(2000, n, 0.5f);
        var r = new SurroundRenderer(Fs, layout);
        r.Configure(UpmixSettings.Build(new UpmixOptions { Diffusion = 0 }));
        var o = new float[n * Ch];
        for (int f = 0; f < n; f++)
        {
            if (f == n / 4) r.Configure(UpmixSettings.Build(new UpmixOptions { Diffusion = 0, SurroundHighCutHz = 3000 }));
            if (f == n / 2) r.Configure(UpmixSettings.Build(new UpmixOptions { Diffusion = 0, SurroundHighCutHz = 9000 }));
            if (f == 3 * n / 4) r.Configure(UpmixSettings.Build(new UpmixOptions { Diffusion = 0 }));
            r.Render(x[f], x[f], 1f, 0, 0, 0, 0, o.AsSpan(f * Ch, Ch));
        }
        double maxJump = 0;
        for (int f = Fs / 8; f < n; f++) maxJump = Math.Max(maxJump, Math.Abs(o[f * Ch + Channels.BL] - o[(f - 1) * Ch + Channels.BL]));
        Assert.True(maxJump < 0.15, $"jump {maxJump:0.000}"); // natural max step of 2 kHz at 0.5 is ~0.13 at the gain peak
    }

    [Fact]
    public void ValidatorChecksTheNewRanges()
    {
        static SurroundConfig Cfg(Action<UpmixOptions> a)
        {
            var c = TestCfg.Valid();
            a(c.UpmixOptions);
            return c;
        }
        Assert.Empty(ConfigValidator.Validate(Cfg(o => { o.SurroundDelayMs = 25; o.SurroundHighCutHz = 3000; o.Diffusion = 0; })));
        Assert.Empty(ConfigValidator.Validate(Cfg(o => { o.SurroundDelayMs = 0; o.SurroundHighCutHz = 16000; o.Diffusion = 1; })));
        Assert.Contains(ConfigValidator.Validate(Cfg(o => o.SurroundDelayMs = 26)), m => m.Contains("surroundDelayMs"));
        Assert.Contains(ConfigValidator.Validate(Cfg(o => o.SurroundDelayMs = -1)), m => m.Contains("surroundDelayMs"));
        Assert.Contains(ConfigValidator.Validate(Cfg(o => o.SurroundHighCutHz = 2000)), m => m.Contains("surroundHighCutHz") && m.Contains("kapalı"));
        Assert.Contains(ConfigValidator.Validate(Cfg(o => o.SurroundHighCutHz = 20000)), m => m.Contains("surroundHighCutHz"));
        Assert.Contains(ConfigValidator.Validate(Cfg(o => o.Diffusion = 1.5)), m => m.Contains("diffusion"));
    }

    [Fact]
    public void OldConfigsLoadWithDefaultsAndNewFieldsAreLive()
    {
        var c = TestCfg.Valid();
        var json = c.ToJson();
        Assert.DoesNotContain("surroundDelayMs\": 99", json);
        var back = SurroundConfig.Parse(json.Replace("\"surroundDelayMs\": 10,", "").Replace("\"diffusion\": 1", "\"x\": 1"));
        Assert.Equal(10, back.UpmixOptions.SurroundDelayMs);
        Assert.Equal(1, back.UpmixOptions.Diffusion);

        var a = TestCfg.Valid(); var b = TestCfg.Valid();
        b.UpmixOptions.SurroundDelayMs = 3; b.UpmixOptions.SurroundHighCutHz = 5000; b.UpmixOptions.Diffusion = 0.2;
        Assert.Equal(a.EngineFingerprint(), b.EngineFingerprint());
    }
}

internal static class TestCfg
{
    public static SurroundConfig Valid() => SurroundConfig.Parse("""
    {
      "source": { "deviceId": "SRC", "mode": "loopback" },
      "upmix": true,
      "outputs": [ { "deviceId": "A", "latencyMs": 10, "bufferMs": 40 } ],
      "speakers": [
        { "name": "FL", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 1.0 } },
        { "name": "FR", "outputDeviceId": "A", "deviceChannel": 2, "source": { "FR": 1.0 } }
      ]
    }
    """);
}
