using Surround.Engine.Calibration;
using Surround.Engine.Config;
using Surround.Engine.Dsp;
using Xunit.Abstractions;

namespace Surround.Engine.Tests;

/// <summary>Phone microphone: aligning a recording made on another clock, responses, verification, roomEq plumbing.</summary>
public class PhoneCalibrationTests(ITestOutputHelper output)
{
    /// <param name="DelayMs">Extra latency of this speaker (Bluetooth: hundreds of ms).</param>
    /// <param name="Peak">Optional coloration: a peaking filter (Hz, dB, Q) on this speaker.</param>
    private sealed record Spk(double DelayMs, double Gain, (double Hz, double Db, double Q)? Peak = null);

    /// <summary>
    /// The phone's recording: it starts <paramref name="leadSec"/> before the program, its clock runs
    /// <paramref name="ppm"/> fast against the PC's, and every speaker has its own latency, gain and coloration.
    /// </summary>
    private static float[] PhoneRecord(CalibrationPlan plan, Spk[] spk, int micRate, double leadSec, double ppm, double noiseRms,
        double tailSec = 1.0, int seed = 3)
    {
        double rate = micRate * (1 + ppm * 1e-6); // phone samples per PC second
        int len = (int)Math.Ceiling((leadSec + plan.Seconds + tailSec) * rate);
        var lanes = new double[spk.Length][];
        for (int s = 0; s < spk.Length; s++) lanes[s] = new double[len];
        var sw = plan.Sweep;
        void Add(long frame, int s)
        {
            double at = leadSec + frame / (double)plan.Rate + 0.0234 + spk[s].DelayMs / 1000;
            int from = (int)Math.Floor(at * rate), to = (int)Math.Ceiling((at + sw.Seconds) * rate);
            for (int m = Math.Max(0, from); m <= to && m < len; m++)
                lanes[s][m] += spk[s].Gain * plan.Amplitude * sw.Value(m / rate - at);
        }
        foreach (var st in plan.Steps) { Add(st.StartFrame, plan.Reference); Add(st.StartFrame + plan.OffsetFrames, st.Test); }
        var x = new double[len];
        for (int s = 0; s < spk.Length; s++)
        {
            if (spk[s].Peak is { } p)
            {
                var c = BiquadCoefs.Peaking(micRate, p.Hz, p.Q, p.Db);
                var z = new double[2];
                for (int i = 0; i < len; i++) lanes[s][i] = BiquadCascade.Process(new[] { c }, z, lanes[s][i]);
            }
            for (int i = 0; i < len; i++) x[i] += lanes[s][i];
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

    private static CalibrationPlan Plan(int n, int repeats = 2, int reference = 0) =>
        new(48000, Enumerable.Range(0, n).Select(i => new CalibrationSpeaker($"s{i}", false)).ToList(), reference, repeats, -20);

    private static CalibrationResult AnalyzePhone(CalibrationPlan plan, float[] mic, int micRate, out ExternalAlignment.Alignment al)
    {
        al = ExternalAlignment.Find(plan, mic, mic.Length, micRate);
        return CalibrationAnalyzer.Analyze(plan, mic, mic.Length, micRate, "phone", null, null, default,
            new AnalysisOptions { Map = al.Map, MaxLatencySec = ExternalAlignment.WindowSec, Responses = true });
    }

    [Fact]
    public void Phone_RecoversRelativeArrivals_DespiteUnknownStartClockDriftAndBluetoothLatency()
    {
        const int micRate = 44100;
        var plan = Plan(4, repeats: 2);
        // s2 is a Bluetooth speaker ~330 ms late; s3 is earlier than the reference.
        var spk = new[] { new Spk(3.0, 0.5), new Spk(7.25, 0.3), new Spk(331.5, 0.6), new Spk(1.0, 0.8) };
        var mic = PhoneRecord(plan, spk, micRate, leadSec: 1.37, ppm: 85, noiseRms: 2e-4);
        var r = AnalyzePhone(plan, mic, micRate, out var al);
        output.WriteLine($"ppm {al.ClockPpm}, hits {al.ReferenceHits}/{al.Steps}");
        foreach (var x in r.Speakers) output.WriteLine($"{x.SpeakerId}: {x.ArrivalMs:0.0000} ms {x.LevelDb:0.00} dB snr {x.SnrDb} {x.Message}");

        Assert.InRange(al.ClockPpm, 75, 95);
        Assert.Equal(al.Steps, al.ReferenceHits);
        var s = r.Speakers;
        Assert.All(s, x => Assert.True(x.Ok, x.Message));
        Assert.InRange(s[1].ArrivalMs - 4.25, -0.05, 0.05);
        Assert.InRange(s[2].ArrivalMs - 328.5, -0.05, 0.05);
        Assert.InRange(s[3].ArrivalMs - (-2.0), -0.05, 0.05);
        Assert.InRange(s[1].LevelDb - 20 * Math.Log10(0.3 / 0.5), -0.5, 0.5);
    }

    [Fact]
    public void Phone_LoudTestSpeakers_DoNotFoolTheCoarseAlignment()
    {
        const int micRate = 48000;
        var plan = Plan(3, repeats: 2);
        // A quiet reference (-18 dB vs the others): the pattern must still lock onto the reference, not one offset later.
        var spk = new[] { new Spk(2.0, 0.08), new Spk(4.0, 0.64), new Spk(5.0, 0.64) };
        var mic = PhoneRecord(plan, spk, micRate, leadSec: 0.8, ppm: -40, noiseRms: 1e-4);
        var r = AnalyzePhone(plan, mic, micRate, out _);
        Assert.InRange(r.Speakers[1].ArrivalMs - 2.0, -0.05, 0.05);
        Assert.InRange(r.Speakers[2].ArrivalMs - 3.0, -0.05, 0.05);
    }

    [Fact]
    public void Phone_SilentRecording_Throws()
    {
        var plan = Plan(2);
        var mic = new float[(int)(plan.Seconds * 48000) + 48000];
        Assert.Throws<InvalidOperationException>(() => ExternalAlignment.Find(plan, mic, mic.Length, 48000));
    }

    [Fact]
    public void Responses_ShowTheColorationDifferenceBetweenSpeakers()
    {
        const int micRate = 48000;
        var plan = Plan(2, repeats: 2);
        var spk = new[] { new Spk(2.0, 0.5), new Spk(3.0, 0.5, (2000, 6, 1.4)) };
        var mic = PhoneRecord(plan, spk, micRate, leadSec: 0.5, ppm: 20, noiseRms: 1e-4);
        var r = AnalyzePhone(plan, mic, micRate, out _);
        Assert.NotNull(r.ResponseHz);
        Assert.Equal(ResponseGrid.Count, r.ResponseHz!.Length);
        var a = r.Speakers[0].ResponseDb!; var b = r.Speakers[1].ResponseDb!;
        int i2k = Array.FindIndex(r.ResponseHz, f => f >= 2000);
        int i300 = Array.FindIndex(r.ResponseHz, f => f >= 300);
        int i8k = Array.FindIndex(r.ResponseHz, f => f >= 8000);
        output.WriteLine($"diff 300 Hz {b[i300] - a[i300]:0.00}, 2 kHz {b[i2k] - a[i2k]:0.00}, 8 kHz {b[i8k] - a[i8k]:0.00}");
        Assert.InRange(b[i2k] - a[i2k], 4.5, 7.0);
        Assert.InRange(b[i300] - a[i300], -1.0, 1.0);
        Assert.InRange(b[i8k] - a[i8k], -1.0, 1.0);
    }

    [Fact]
    public void Verify_ConvertsBackToRawAndReportsResidual()
    {
        var cfg = SurroundConfig.Parse("""
        { "source": { "deviceId": "src", "mode": "loopback" },
          "outputs": [ { "deviceId": "dev", "bufferMs": 40 } ],
          "speakers": [
            { "id": "a", "name": "A", "outputDeviceId": "dev", "deviceChannel": 1, "source": { "FL": 1 }, "delayMs": 1, "gainDb": -1 },
            { "id": "b", "name": "B", "outputDeviceId": "dev", "deviceChannel": 2, "source": { "FR": 1 }, "delayMs": 3, "gainDb": -4,
              "roomEq": [ { "type": "peak", "freqHz": 1000, "gainDb": -6, "q": 2 } ] } ] }
        """);
        var sel = CalibrationRunner.Resolve(cfg, new CalibrationRequest("mic", new[] { "a", "b" }));
        var hz = ResponseGrid.Frequencies();
        var flat = hz.Select(_ => 0.0).ToArray();
        var measured = new CalibrationResult("a", "mic", -80, false, new[]
        {
            new SpeakerCalibration("a", true, 0, 0, 40, 0, false, null) { ResponseDb = flat },
            new SpeakerCalibration("b", true, 0.1, 0.2, 40, 0, false, null) { ResponseDb = flat },
        }) { ResponseHz = hz };
        var r = CalibrationRunner.WithoutCorrections(measured, cfg, sel.Targets, sel.Reference, 48000);
        Assert.True(r.Verified);
        var b = r.Speakers[1];
        Assert.Equal(0.1, b.ResidualArrivalMs);
        Assert.Equal(0.2, b.ResidualLevelDb);
        Assert.Equal(0.1 - 2.0, b.ArrivalMs, 3);  // played 2 ms later than a
        Assert.Equal(0.2 + 3.0, b.LevelDb, 2);    // played 3 dB quieter than a
        int i1k = Array.FindIndex(hz, f => f >= 1000);
        Assert.InRange(b.ResponseDb![i1k] - (6 + 4), -0.2, 0.2); // undo the -6 dB band and the -4 dB gain
        Assert.Null(r.Speakers[0].ResidualArrivalMs);
    }

    [Fact]
    public void RoomEq_IsAppliedAfterTheUserEq_AndValidated()
    {
        var bands = new List<PeqBand> { new() { Type = PeqBand.Peak, FreqHz = 1000, GainDb = -6, Q = 2 } };
        var st = EqDesign.TenBandWithPeq(48000, null, null, bands);
        Assert.Equal(EqDesign.StagesWithPeq, st.Length);
        Assert.InRange(FrequencyResponse.MagnitudeDb(st, 48000, 1000), -6.1, -5.9);

        var cfg = SurroundConfig.Parse("""
        { "source": { "deviceId": "src" }, "outputs": [ { "deviceId": "dev" } ],
          "speakers": [ { "name": "A", "outputDeviceId": "dev", "deviceChannel": 1, "source": { "FL": 1 },
            "roomEq": [ {"freqHz":100,"gainDb":1},{"freqHz":200,"gainDb":1},{"freqHz":300,"gainDb":1},{"freqHz":400,"gainDb":1},
                        {"freqHz":500,"gainDb":1},{"freqHz":600,"gainDb":1},{"freqHz":700,"gainDb":1},{"freqHz":800,"gainDb":1},
                        {"freqHz":900,"gainDb":1} ] } ] }
        """);
        Assert.Contains(ConfigValidator.Validate(cfg), e => e.Contains("roomEq") && e.Contains("8"));
        cfg.Speakers[0].RoomEq!.RemoveAt(8);
        Assert.DoesNotContain(ConfigValidator.Validate(cfg), e => e.Contains("roomEq"));
        // roomEq is live-updatable: it does not change the engine fingerprint.
        var fp = cfg.EngineFingerprint();
        cfg.Speakers[0].RoomEq = null;
        Assert.Equal(fp, cfg.EngineFingerprint());
    }
}
