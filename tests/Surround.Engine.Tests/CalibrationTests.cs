using Surround.Engine.Calibration;
using Xunit.Abstractions;

namespace Surround.Engine.Tests;

public class CalibrationTests(ITestOutputHelper output)
{
    /// <summary>One speaker in the simulated room: direct sound, plus an optional (possibly stronger) later reflection.</summary>
    private sealed record Room(double DelayMs, double Gain, double ReflMs = 0, double ReflGain = 0);

    /// <summary>
    /// Synthesizes the microphone recording of <paramref name="plan"/> at <paramref name="micRate"/>: every sweep the plan
    /// pushes reaches the mic through its speaker's room (delay with fractional samples, gain, reflection) on top of a
    /// constant <paramref name="latencyMs"/>, plus white noise. The sweep is evaluated in continuous time, so a mic rate
    /// different from the program rate is exact.
    /// </summary>
    private static float[] Record(CalibrationPlan plan, Room[] rooms, int micRate, double noiseRms, double latencyMs = 23.4, int seed = 1)
    {
        int len = (int)Math.Ceiling(plan.Seconds * micRate);
        var x = new double[len];
        var sw = plan.Sweep;
        void Add(long frame, int speaker)
        {
            double t0 = frame / (double)plan.Rate + latencyMs / 1000;
            var r = rooms[speaker];
            Path(t0 + r.DelayMs / 1000, r.Gain);
            if (r.ReflGain != 0) Path(t0 + (r.DelayMs + r.ReflMs) / 1000, r.ReflGain);
        }
        void Path(double at, double gain)
        {
            if (gain == 0) return;
            int from = (int)Math.Floor(at * micRate), to = (int)Math.Ceiling((at + sw.Seconds) * micRate);
            for (int m = Math.Max(0, from); m <= to && m < len; m++)
                x[m] += gain * plan.Amplitude * sw.Value(m / (double)micRate - at);
        }
        foreach (var st in plan.Steps)
        {
            Add(st.StartFrame, plan.Reference);
            Add(st.StartFrame + plan.OffsetFrames, st.Test);
        }
        var rng = new Random(seed);
        var y = new float[len];
        for (int i = 0; i < len; i++)
        {
            double g = Math.Sqrt(-2 * Math.Log(1 - rng.NextDouble())) * Math.Cos(2 * Math.PI * rng.NextDouble());
            y[i] = (float)Math.Clamp(x[i] + noiseRms * g, -1, 1);
        }
        return y;
    }

    private static CalibrationPlan Plan(int n, int repeats = 1, int reference = 0, bool[]? lowBand = null) =>
        new(48000, Enumerable.Range(0, n).Select(i => new CalibrationSpeaker($"s{i}", lowBand?[i] ?? false)).ToList(), reference, repeats, -20);

    private static double Db(double g) => 20 * Math.Log10(g);

    [Fact]
    public void Plan_PlacesReferenceAndTestSweepsOnTheirLanes()
    {
        var plan = Plan(3, repeats: 2, reference: 1);
        Assert.Equal(4, plan.Steps.Count);
        Assert.Equal(new[] { 0, 2, 0, 2 }, plan.Steps.Select(s => s.Test));
        var st = plan.Steps[1];
        const int stride = Channels.Count;
        var buf = new float[200 * stride];
        plan.Render(st.StartFrame - 100, 200, buf, stride);
        Assert.Equal(0f, buf[99 * stride + 1]);
        Assert.Equal(0f, buf[100 * stride + 1]); // fade-in starts at exactly zero
        Assert.NotEqual(0f, buf[101 * stride + 1]); // reference lane
        Assert.All(Enumerable.Range(0, 200), f => Assert.Equal(0f, buf[f * stride + 2]));
        Array.Clear(buf);
        plan.Render(st.StartFrame + plan.OffsetFrames - 100, 200, buf, stride);
        Assert.NotEqual(0f, buf[150 * stride + 2]); // test lane, one offset later
        Assert.Equal(0f, buf[150 * stride + 1]);
    }

    [Fact]
    public void Analyze_RecoversRelativeArrivalAndLevel_DespiteStrongerReflectionAndOtherMicRate()
    {
        const int micRate = 44100;
        var plan = Plan(3, repeats: 2);
        // A stronger reflection 6.5 ms after the direct sound must not be taken as the arrival.
        var rooms = new[]
        {
            new Room(3.000, 0.50, 6.5, 0.75),
            new Room(7.3713, 0.25, 6.5, 0.375),   // +4.3713 ms, -6.02 dB
            new Room(1.2345, 0.80, 6.5, 1.2),     // negative relative arrival, +4.08 dB
        };
        var mic = Record(plan, rooms, micRate, noiseRms: 1e-4);
        var r = CalibrationAnalyzer.Analyze(plan, mic, mic.Length, micRate, "mic");

        foreach (var x in r.Speakers) output.WriteLine($"{x.SpeakerId}: {x.ArrivalMs:0.0000} ms, {x.LevelDb:0.000} dB, SNR {x.SnrDb}, spread {x.SpreadMs}");
        Assert.Equal("s0", r.ReferenceSpeakerId);
        Assert.False(r.MicClipped);
        Assert.InRange(r.NoiseFloorDb, -82, -78);
        var s = r.Speakers;
        Assert.True(s[0].Ok);
        Assert.Equal(0, s[0].ArrivalMs);
        Assert.True(s[1].Ok, s[1].Message);
        Assert.True(s[2].Ok, s[2].Message);
        Assert.InRange(s[1].ArrivalMs - 4.3713, -0.05, 0.05);
        Assert.InRange(s[2].ArrivalMs - (1.2345 - 3.0), -0.05, 0.05);
        Assert.InRange(s[1].LevelDb - Db(0.25 / 0.5), -0.5, 0.5);
        Assert.InRange(s[2].LevelDb - Db(0.8 / 0.5), -0.5, 0.5);
        Assert.True(s[1].SnrDb > 30);
        Assert.InRange(s[1].SpreadMs, 0, 0.02);
        Assert.Null(s[1].Message);
    }

    [Fact]
    public void Analyze_WarnsOnLowSnr()
    {
        const int micRate = 32000;
        var plan = Plan(2);
        var rooms = new[] { new Room(2, 0.5), new Room(3, 0.0025) };
        var mic = Record(plan, rooms, micRate, noiseRms: 0.002);
        var r = CalibrationAnalyzer.Analyze(plan, mic, mic.Length, micRate, "mic");
        var s = r.Speakers[1];
        Assert.InRange(s.SnrDb, CalibrationAnalyzer.MinSnrDb - 4, CalibrationAnalyzer.WarnSnrDb);
        Assert.Contains("SNR", s.Message);
        Assert.True(r.Speakers[0].SnrDb > 40);
    }

    [Fact]
    public void Analyze_ReportsNoSignal()
    {
        const int micRate = 32000;
        var plan = Plan(2);
        var mic = Record(plan, new[] { new Room(2, 0.5), new Room(3, 0) }, micRate, noiseRms: 1e-4);
        var s = CalibrationAnalyzer.Analyze(plan, mic, mic.Length, micRate, "mic").Speakers[1];
        Assert.False(s.Ok);
        Assert.Contains("algılanamadı", s.Message);
    }

    [Fact]
    public void Analyze_DetectsClipping()
    {
        const int micRate = 32000;
        var plan = Plan(2);
        var mic = Record(plan, new[] { new Room(2, 15), new Room(3, 0.5) }, micRate, noiseRms: 1e-4);
        var r = CalibrationAnalyzer.Analyze(plan, mic, mic.Length, micRate, "mic");
        Assert.True(r.MicClipped);
        Assert.Contains("kırpıldı", r.Speakers[0].Message);
    }

    [Fact]
    public void Analyze_SubwooferInBassBand()
    {
        const int micRate = 32000;
        var plan = Plan(2, lowBand: new[] { false, true });
        var mic = Record(plan, new[] { new Room(2, 0.5), new Room(9.5, 0.5) }, micRate, noiseRms: 1e-4);
        var s = CalibrationAnalyzer.Analyze(plan, mic, mic.Length, micRate, "mic").Speakers[1];
        Assert.True(s.Ok, s.Message);
        Assert.True(s.LowBand);
        Assert.InRange(s.ArrivalMs - 7.5, -0.2, 0.2);
        Assert.InRange(s.LevelDb, -1, 1); // flat simulated response: same density in both bands
        Assert.Contains("Bas bandında", s.Message);
    }

    [Fact]
    public void Analyze_CompensatesFillAndSkipsGlitchedSteps()
    {
        const int micRate = 32000;
        var plan = new CalibrationPlan(48000, new[] { new CalibrationSpeaker("a", false, 0), new CalibrationSpeaker("b", false, 1) }, 0, 2, -20);
        var mic = Record(plan, new[] { new Room(2, 0.5), new Room(5, 0.5) }, micRate, noiseRms: 1e-4);
        // Sink 1's ring holds 1.5 ms more than its target during the whole run: that part is not steady-state latency.
        // Clock samples every 10 ms (10^7 ticks/s); the mic's delivery offset (here 3 ms) is common and cancels.
        int k = (int)(plan.Seconds * 100) + 1;
        var ticks = Enumerable.Range(0, k).Select(i => i * 100_000L).ToArray();
        var micFrames = ticks.Select(t => t / 10_000_000.0 * micRate).Select(x => (long)x).ToArray();
        long[] Consumed(double latencyMs) => ticks.Select(t => (long)((t / 1e7 - 0.003 - latencyMs / 1000) * 48000)).ToArray();
        var fill = new LatencyTrack(48000, micRate, ticks, micFrames, k, new[] { ticks, ticks }, new[] { Consumed(40), Consumed(41.5) },
            new[] { k, k }, new double[] { 40, 40 });
        var r = CalibrationAnalyzer.Analyze(plan, mic, mic.Length, micRate, "mic",
            new CalibrationExtras { Latency = fill, StepGlitched = new[] { true, false } });
        var s = r.Speakers[1];
        Assert.True(s.Ok);
        Assert.InRange(s.ArrivalMs - (3 - 1.5), -0.05, 0.05);
        Assert.Contains("atlandı", s.Message);
    }

    [Fact]
    public void Types_SerializeToTheBridgeContract()
    {
        var web = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        var p = System.Text.Json.JsonSerializer.Serialize(new CalibrationProgress(CalibrationPhase.Noise, null, 0, 4, "x"), web);
        Assert.Equal("""{"phase":"noise","index":0,"total":4,"message":"x"}""", p);
        var r = System.Text.Json.JsonSerializer.Serialize(new CalibrationResult("a", "m", -80, false,
            new[] { new SpeakerCalibration("a", true, 0, 0, 40, 0, false, null), new SpeakerCalibration("b", false, 0, 0, 3, 0, true, "w") }), web);
        Assert.Equal("""{"referenceSpeakerId":"a","micDeviceId":"m","noiseFloorDb":-80,"micClipped":false,"speakers":[""" +
            """{"speakerId":"a","ok":true,"arrivalMs":0,"levelDb":0,"snrDb":40,"spreadMs":0,"lowBand":false},""" +
            """{"speakerId":"b","ok":false,"arrivalMs":0,"levelDb":0,"snrDb":3,"spreadMs":0,"lowBand":true,"message":"w"}]}""", r);
    }

    [Fact]
    public void Analyze_CancelledDuringAnalysis_Throws()
    {
        const int micRate = 48000;
        var plan = Plan(3);
        var mic = Record(plan, new[] { new Room(2, 0.5), new Room(3, 0.5), new Room(4, 0.5) }, micRate, noiseRms: 1e-4);
        using var cts = new CancellationTokenSource();
        var phases = new List<string>();
        Assert.Throws<OperationCanceledException>(() => CalibrationAnalyzer.Analyze(plan, mic, mic.Length, micRate, "mic", null, p =>
        {
            phases.Add(p.Phase);
            if (p.Phase == CalibrationPhase.Analyzing) cts.Cancel();
        }, cts.Token));
        Assert.Equal(new[] { CalibrationPhase.Analyzing }, phases); // stopped at the next step, never "done"

        using var pre = new CancellationTokenSource();
        pre.Cancel();
        Assert.Throws<OperationCanceledException>(() => CalibrationAnalyzer.Analyze(plan, mic, mic.Length, micRate, "mic", ct: pre.Token));
    }

    private static Config.SurroundConfig LoopbackRoom(string mode = "loopback") => Config.SurroundConfig.Parse($$"""
    {
      "source": { "deviceId": "SRC", "mode": "{{mode}}" },
      "outputs": [ { "deviceId": "A" }, { "deviceId": "SRC" } ],
      "speakers": [
        { "id": "fl", "name": "FL", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 1.0 } },
        { "id": "fr", "name": "FR", "outputDeviceId": " src ", "deviceChannel": 2, "source": { "FR": 1.0 } },
        { "id": "sub", "name": "Sub", "outputDeviceId": "SRC", "deviceChannel": 4, "source": { "LFE": 1.0 } },
        { "id": "bl", "name": "BL", "outputDeviceId": "A", "deviceChannel": 2, "source": { "BL": 1.0 } }
      ]
    }
    """);

    [Fact]
    public void Resolve_SkipsSpeakersOnTheLoopbackSource_AndReportsThemInRequestOrder()
    {
        var sel = CalibrationRunner.Resolve(LoopbackRoom(), new CalibrationRequest("mic", new[] { "fl", "fr", "sub", "bl" }, "fl"));
        Assert.Equal(new[] { "fl", "bl" }, sel.Targets.Select(t => t.Id));
        Assert.Equal(0, sel.Reference);
        Assert.Equal(new[] { "fr", "sub" }, sel.Skipped.Keys.Order());
        Assert.True(sel.Skipped["sub"].LowBand);

        var measured = new CalibrationResult("fl", "mic", -80, false, new[]
        {
            new SpeakerCalibration("fl", true, 0, 0, 40, 0, false, null),
            new SpeakerCalibration("bl", true, 1.5, -2, 38, 0.01, false, null),
        });
        var r = CalibrationRunner.WithSkipped(measured, sel);
        Assert.Equal(new[] { "fl", "fr", "sub", "bl" }, r.Speakers.Select(s => s.SpeakerId));
        Assert.Equal("fl", r.ReferenceSpeakerId);
        foreach (var s in r.Speakers.Where(s => s.SpeakerId is "fr" or "sub"))
        {
            Assert.False(s.Ok);
            Assert.Equal(0, s.ArrivalMs);
            Assert.Equal(0, s.LevelDb);
            Assert.Equal("Kaynak cihazdaki hoparlör ölçülemez.", s.Message);
        }
        Assert.Same(measured.Speakers[1], r.Speakers[3]);
    }

    [Fact]
    public void Resolve_DefaultReferenceIsTheFirstMeasurableSpeaker()
    {
        var sel = CalibrationRunner.Resolve(LoopbackRoom(), new CalibrationRequest("mic", new[] { "fr", "bl", "fl" }));
        Assert.Equal(new[] { "bl", "fl" }, sel.Targets.Select(t => t.Id));
        Assert.Equal(0, sel.Reference);
        Assert.Equal(new[] { "fr", "bl", "fl" }, sel.Order);
    }

    [Fact]
    public void Resolve_SourceSpeakerAsReferenceOrOnlySourceSpeakers_Fails()
    {
        var cfg = LoopbackRoom();
        var ex = Assert.Throws<ArgumentException>(() => CalibrationRunner.Resolve(cfg, new CalibrationRequest("mic", new[] { "fl", "fr" }, "fr")));
        Assert.Contains("Referans", ex.Message);
        Assert.Throws<ArgumentException>(() => CalibrationRunner.Resolve(cfg, new CalibrationRequest("mic", new[] { "fr", "sub" })));
    }

    [Fact]
    public void Resolve_CaptureSourceSkipsNothing()
    {
        var sel = CalibrationRunner.Resolve(LoopbackRoom("capture"), new CalibrationRequest("mic", new[] { "fl", "fr" }, "fr"));
        Assert.Equal(new[] { "fl", "fr" }, sel.Targets.Select(t => t.Id));
        Assert.Equal(1, sel.Reference);
        Assert.Empty(sel.Skipped);
        var measured = new CalibrationResult("fr", "mic", -80, false, Array.Empty<SpeakerCalibration>());
        Assert.Same(measured, CalibrationRunner.WithSkipped(measured, sel));
    }
}
