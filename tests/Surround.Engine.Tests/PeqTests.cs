using System.Text.Json;
using Surround.Engine;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

/// <summary>Parametric EQ (processing.peq, speakers[].peq) and the automatic preamp.</summary>
public class PeqTests
{
    private const int Fs = Sig.Fs, Ch = Channels.Count;

    private static PeqBand Band(string type, double f, double g, double q = 1, bool on = true) =>
        new() { Type = type, FreqHz = f, GainDb = g, Q = q, Enabled = on };

    /// <summary>Gain in dB of a steady sine through the real GlobalProcessor.</summary>
    private static double MeasureDb(ProcessingConfig p, double hz)
    {
        var proc = new GlobalProcessor(Fs);
        proc.Update(ProcessingSettings.Build(p, Fs));
        int n = Fs * 2;
        var x = Sig.Sine(hz, n, 0.1f);
        var lg = Sig.Logical(x);
        proc.Process(lg, n);
        return Sig.Db(Sig.Rms(lg, Fs, Ch, Channels.FL) / Sig.Rms(x, Fs));
    }

    [Theory]
    [InlineData(1000, 6, 1.0)]
    [InlineData(250, -9, 2.0)]
    [InlineData(8000, 4, 0.5)]
    public void PeakBandGivesItsGainAtItsFrequency(double f, double g, double q)
    {
        var p = new ProcessingConfig { Peq = new() { Band("peak", f, g, q) } };
        Assert.Equal(g, MeasureDb(p, f), 0.15);
        Assert.Equal(0, MeasureDb(p, f > 1000 ? 60 : 12000 + 0), 1.2);
    }

    [Fact]
    public void ShelvesAndRealResponseAgree()
    {
        var p = new ProcessingConfig { Peq = new() { Band("lowShelf", 200, 6, 0.7), Band("highShelf", 4000, -5, 0.7) } };
        Assert.Equal(6, MeasureDb(p, 30), 0.4);
        Assert.Equal(-5, MeasureDb(p, 15000), 0.4);
        Assert.Equal(0, MeasureDb(p, 1000), 1.5);
        // The analytic response used for the curve / auto preamp matches the measured one.
        var st = ProcessingSettings.BuildStages(p, Fs);
        foreach (double f in new[] { 30.0, 200, 1000, 4000, 15000 })
            Assert.Equal(MeasureDb(p, f), FrequencyResponse.MagnitudeDb(st, Fs, f), 0.1);
    }

    [Fact]
    public void DisabledZeroGainAndExtraBandsDoNothing()
    {
        var p = new ProcessingConfig { Peq = new() { Band("peak", 1000, 6, 1, on: false), Band("peak", 2000, 0) } };
        Assert.True(EqDesign.IsFlat(EqDesign.Peq(Fs, p.Peq)));
        var seven = Enumerable.Range(0, 7).Select(i => Band("peak", 1000, 6)).ToList();
        var st = EqDesign.Peq(Fs, seven);
        Assert.Equal(6, st.Length);
        Assert.All(st, s => Assert.False(s.IsIdentity));
        Assert.True(EqDesign.IsFlat(EqDesign.Peq(Fs, new List<PeqBand> { Band("weird", 1000, 6) })));
        Assert.True(EqDesign.IsFlat(EqDesign.Peq(Fs, null)));
    }

    [Fact]
    public void LiveUpdateChangesTheResponseWithoutRestart()
    {
        var proc = new GlobalProcessor(Fs);
        proc.Update(ProcessingSettings.Build(new ProcessingConfig(), Fs));
        int n = Fs;
        var x = Sig.Sine(1000, n, 0.1f);
        var a = Sig.Logical(x);
        proc.Process(a, n);
        Assert.Equal(0, Sig.Db(Sig.Rms(a, Fs / 2, Ch, Channels.FL) / Sig.Rms(x, Fs / 2)), 0.05);
        proc.Update(ProcessingSettings.Build(new ProcessingConfig { Peq = new() { Band("peak", 1000, 6) } }, Fs));
        var b = Sig.Logical(x);
        proc.Process(b, n);
        Assert.Equal(6, Sig.Db(Sig.Rms(b, Fs / 2, Ch, Channels.FL) / Sig.Rms(x, Fs / 2)), 0.15);
    }

    [Fact]
    public void SpeakerPeqWorksThroughTheSinkMixer()
    {
        var row = new float[Ch]; row[Channels.FL] = 1f;
        var mixer = new SinkMixer(2, new[] { new SpeakerRoute("a", 0, row, 0, false, 0) });
        mixer.SetEq(new[] { new SinkMixer.SpeakerEq(null, new[] { Band("peak", 1000, 6) }) });
        int n = Fs;
        var x = Sig.Sine(1000, n, 0.1f);
        var ring = new RingBuffer(n * 2 * 2);
        Assert.Equal(0, mixer.Process(Sig.Logical(x), n, ring));
        var o = new float[n * 2];
        ring.Read(o);
        Assert.Equal(6, Sig.Db(Sig.Rms(o, Fs / 2, 2, 0) / Sig.Rms(x, Fs / 2)), 0.15);
    }

    [Fact]
    public void ValidatorChecksPeq()
    {
        static List<string> V(Action<SurroundConfig> a) { var c = TestCfg.Valid(); a(c); return ConfigValidator.Validate(c); }
        Assert.Empty(V(c => c.Processing.Peq = new() { Band("peak", 20, -12, 0.3), Band("lowShelf", 20000, 12, 10) }));
        Assert.Contains(V(c => c.Processing.Peq = Enumerable.Range(0, 7).Select(_ => Band("peak", 1000, 1)).ToList()), m => m.Contains("en fazla 6"));
        Assert.Contains(V(c => c.Processing.Peq = new() { Band("bell", 1000, 1) }), m => m.Contains("peq[0].type"));
        Assert.Contains(V(c => c.Processing.Peq = new() { Band("peak", 10, 1) }), m => m.Contains("peq[0].freqHz"));
        Assert.Contains(V(c => c.Processing.Peq = new() { Band("peak", 1000, 13) }), m => m.Contains("peq[0].gainDb"));
        Assert.Contains(V(c => c.Processing.Peq = new() { Band("peak", 1000, 1, 0.1) }), m => m.Contains("peq[0].q"));
        Assert.Contains(V(c => c.Speakers[0].Peq = new() { Band("peak", 1000, 1, 11) }), m => m.Contains("peq[0].q") && m.Contains("'FL'"));
    }

    [Fact]
    public void PeqRoundTripsAndStaysOutOfTheFingerprint()
    {
        var c = TestCfg.Valid();
        c.Processing.AutoPreamp = true;
        c.Processing.Peq = new() { Band("peak", 1500, 3, 2) };
        c.Speakers[0].Peq = new() { Band("highShelf", 9000, -4, 0.8, on: false) };
        c.Extra = new() { ["userSoundPresets"] = JsonSerializer.SerializeToElement(new[] { new { id = "u1", name = "Benim" } }),
                          ["userSpeakerPresets"] = JsonSerializer.SerializeToElement(new[] { new { id = "s1", name = "Uydu" } }) };
        var back = SurroundConfig.Parse(c.ToJson());
        Assert.True(back.Processing.AutoPreamp);
        Assert.Equal(1500, back.Processing.Peq![0].FreqHz);
        Assert.Equal("highShelf", back.Speakers[0].Peq![0].Type);
        Assert.False(back.Speakers[0].Peq![0].Enabled);
        Assert.Contains("userSoundPresets", back.Extra!.Keys);
        Assert.Contains("userSpeakerPresets", back.Extra.Keys);
        // The engine's routed copy keeps them too (ForRouting re-parses), the fingerprint ignores all of it.
        Assert.Contains("userSoundPresets", back.ForRouting().Extra!.Keys);
        Assert.Equal(TestCfg.Valid().EngineFingerprint(), c.EngineFingerprint());
        // Old configs: no peq / autoPreamp.
        var old = SurroundConfig.Parse(TestCfg.Valid().ToJson());
        Assert.Null(old.Processing.Peq);
        Assert.False(old.Processing.AutoPreamp);
        Assert.DoesNotContain("peq", TestCfg.Valid().ToJson());
        // Null bands are dropped.
        var nulls = SurroundConfig.Parse("""{ "processing": { "peq": [ null, { "freqHz": 500 } ] } }""");
        Assert.Single(nulls.Processing.Peq!);
    }

    [Fact]
    public void ProfilesCarryPeqAndAutoPreamp()
    {
        var c = TestCfg.Valid();
        c.Extra = new()
        {
            ["profiles"] = JsonDocument.Parse("""[ { "id": "p", "name": "P", "processing": { "autoPreamp": true, "peq": [ { "type": "peak", "freqHz": 800, "gainDb": 2, "q": 1 } ] } } ]""").RootElement.Clone(),
        };
        Assert.True(ProfileCatalog.Apply(c, "p"));
        Assert.True(c.Processing.AutoPreamp);
        Assert.Equal(800, c.Processing.Peq![0].FreqHz);
    }

    // ---- Auto preamp ----

    [Fact]
    public void AutoPreampIsMinusThePeakAndNeverBoosts()
    {
        var p = new ProcessingConfig { Eq = new double[] { 0, 0, 0, 0, 0, 6, 0, 0, 0, 0 }, BassBoostDb = 4, AutoPreamp = true,
                                       Peq = new() { Band("peak", 3000, 5, 2) } };
        var st = ProcessingSettings.BuildStages(p, Fs);
        double peak = FrequencyResponse.PeakDb(st, Fs);
        Assert.True(peak > 6);
        Assert.Equal(-peak, FrequencyResponse.AutoPreampDb(p, Fs), 1e-9);
        // Build uses it, ignoring preampDb: the processed peak lands at (about) 0 dB.
        p.PreampDb = 9;
        var s = ProcessingSettings.Build(p, Fs);
        Assert.Equal(-peak, 20 * Math.Log10(s.Preamp), 1e-4);
        double worst = Enumerable.Range(0, 400).Select(i => MeasureAt(p, 20 * Math.Pow(1000, i / 399.0))).Max();
        Assert.InRange(worst, -0.4, 0.05);
        // Cuts only: preamp stays 0.
        var cut = new ProcessingConfig { Eq = new double[] { -3, -3, -3, -3, -3, -3, -3, -3, -3, -3 }, AutoPreamp = true };
        Assert.Equal(0, FrequencyResponse.AutoPreampDb(cut, Fs), 1e-9);
        Assert.Equal(0, FrequencyResponse.AutoPreampDb(new ProcessingConfig(), Fs), 1e-9);
        // Off: the manual preamp is used as before.
        Assert.Equal(-6, 20 * Math.Log10(ProcessingSettings.Build(new ProcessingConfig { PreampDb = -6 }, Fs).Preamp), 1e-4);
    }

    private static double MeasureAt(ProcessingConfig p, double f) =>
        FrequencyResponse.MagnitudeDb(ProcessingSettings.BuildStages(p, Fs), Fs, f) + 20 * Math.Log10(ProcessingSettings.Build(p, Fs).Preamp);

    [Fact]
    public void AutoPreampIsLimitedToTheTwentyFourDbFloor()
    {
        var p = new ProcessingConfig { Eq = Enumerable.Repeat(12.0, 10).ToArray(), BassBoostDb = 12, ClarityDb = 12, AutoPreamp = true,
                                       Peq = Enumerable.Range(0, 6).Select(_ => Band("peak", 1000, 12, 1)).ToList() };
        Assert.Equal(-24, FrequencyResponse.AutoPreampDb(p, Fs));
    }

    /// <summary>Reference values the UI tests (ui/src/lib/eqCurve.test.ts) compare against; they pin the shared formulas.</summary>
    [Fact]
    public void ReferenceResponseForTheUiMirror()
    {
        var p = new ProcessingConfig
        {
            Eq = new double[] { 3, 2, 0, -2, 0, 1.5, 0, -1, 2, 4 }, BassBoostDb = 3, ClarityDb = 2,
            Peq = new() { Band("peak", 2000, 4, 2), Band("lowShelf", 80, -3, 0.7), Band("highShelf", 6000, -2.5, 1.2) },
        };
        var st = ProcessingSettings.BuildStages(p, 48000);
        var expected = new (double F, double Db)[]
        {
            (20, 2.6813), (31, 1.9043), (100, 1.1268), (500, 0.0413), (1000, 2.0308),
            (2000, 5.1160), (3500, 2.4037), (8000, -0.1977), (16000, 0.5373), (20000, 2.3276),
        };
        foreach (var (f, db) in expected) Assert.Equal(db, FrequencyResponse.MagnitudeDb(st, 48000, f), 3);
        Assert.Equal(-5.1207, FrequencyResponse.AutoPreampDb(p, 48000), 3);
    }
}
