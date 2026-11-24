using Surround.Desktop.Bridge;
using Surround.Engine.Config;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

/// <summary>
/// Moving a speaker on the room map changes its mix row, gain and delay. These are applied to the running mixer in place
/// (no engine restart): without clicks, without allocating or locking on the audio thread.
/// </summary>
public class LiveMixTests
{
    private const int Fs = 48000;
    private const int Block = 256;
    private static readonly int RampFrames = (int)Math.Round(SinkMixer.RampMs * Fs / 1000.0);
    private static readonly int FadeFrames = (int)Math.Round(SinkMixer.DelayFadeMs * Fs / 1000.0);

    private static float[] Row(params (int ch, float v)[] vals)
    {
        var r = new float[Channels.Count];
        foreach (var (c, v) in vals) r[c] = v;
        return r;
    }

    private static SpeakerRoute Route(float[] row, double gainDb = 0, int delay = 0, int devCh = 0) =>
        new("a", devCh, row, gainDb, false, delay);

    /// <summary>Feeds <paramref name="blocks"/> blocks of logical frames from <paramref name="signal"/>(frameIndex, channel) and returns device channel 0.</summary>
    private sealed class Rig
    {
        public readonly SinkMixer Mixer;
        private readonly RingBuffer _ring = new(8 * Block, 1);
        private readonly float[] _logical = new float[Channels.Count * Block];
        private readonly float[] _out = new float[Block];
        private readonly Func<long, int, float> _signal;
        private long _n;
        public readonly List<float> Output = new();

        public Rig(SpeakerRoute route, Func<long, int, float> signal)
        {
            Mixer = new SinkMixer(1, new[] { route }, Fs);
            _signal = signal;
        }

        public void Run(int blocks, int frames = Block)
        {
            for (int b = 0; b < blocks; b++)
            {
                Fill(frames);
                Mixer.Process(_logical, frames, _ring);
                int got = _ring.Read(_out.AsSpan(0, frames));
                for (int i = 0; i < got; i++) Output.Add(_out[i]);
            }
        }

        /// <summary>Same as <see cref="Run"/> but keeps nothing (no allocation in the loop).</summary>
        public void RunQuiet(int blocks)
        {
            for (int b = 0; b < blocks; b++)
            {
                Fill(Block);
                Mixer.Process(_logical, Block, _ring);
                _ring.Read(_out);
            }
        }

        private void Fill(int frames)
        {
            for (int f = 0; f < frames; f++, _n++)
                for (int c = 0; c < Channels.Count; c++)
                    _logical[f * Channels.Count + c] = _signal(_n, c);
        }
    }

    private static float MaxStep(IReadOnlyList<float> y, int from = 1)
    {
        float m = 0;
        for (int i = Math.Max(1, from); i < y.Count; i++) m = Math.Max(m, Math.Abs(y[i] - y[i - 1]));
        return m;
    }

    [Fact]
    public void GainChangeGlidesInsteadOfStepping()
    {
        // DC on FL: any step in the gain would show up as a jump of the output.
        var rig = new Rig(Route(Row((Channels.FL, 1f))), (_, c) => c == Channels.FL ? 1f : 0f);
        rig.Run(4);
        Assert.True(rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), gainDb: -20) }));
        rig.Run(8);

        Assert.Equal(1f, rig.Output[4 * Block - 1], 5);
        Assert.Equal(0.1f, rig.Output[^1], 4);
        // Linear glide over RampFrames: each step is (1 - 0.1) / RampFrames, far below the 0.9 jump of a hard switch.
        Assert.True(MaxStep(rig.Output) <= 0.9f / RampFrames * 1.01f, $"max step {MaxStep(rig.Output)}");
        // The glide really takes RampFrames (not a single block).
        int start = 4 * Block;
        Assert.InRange(rig.Output[start + RampFrames / 2], 0.5f, 0.6f);
    }

    [Fact]
    public void MovingAChannelToAnotherSpeakerRowGlides()
    {
        // Positional mix: the speaker's row changes from FL to FR (different signals on the two channels).
        var rig = new Rig(Route(Row((Channels.FL, 1f))), (_, c) => c == Channels.FL ? 0.8f : c == Channels.FR ? -0.6f : 0f);
        rig.Run(2);
        Assert.True(rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FR, 0.707f), (Channels.FC, 0.707f))) }));
        rig.Run(6);
        Assert.Equal(-0.6f * 0.707f, rig.Output[^1], 4);
        Assert.True(MaxStep(rig.Output) <= (0.8f + 0.6f * 0.707f) / RampFrames * 1.02f, $"max step {MaxStep(rig.Output)}");
    }

    [Fact]
    public void ANewTargetMidGlideContinuesFromTheCurrentLevel()
    {
        var rig = new Rig(Route(Row((Channels.FL, 1f))), (_, c) => c == Channels.FL ? 1f : 0f);
        rig.Run(2);
        Assert.True(rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), gainDb: -40) }));
        rig.Run(1, 100); // part of the way down
        Assert.True(rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), gainDb: 0) })); // and back up
        rig.Run(6);
        Assert.Equal(1f, rig.Output[^1], 4);
        Assert.True(MaxStep(rig.Output) <= 1f / RampFrames * 1.05f, $"max step {MaxStep(rig.Output)}");
    }

    [Fact]
    public void DelayChangeCrossFadesBetweenTaps()
    {
        // 200 Hz sine; the new delay (2.5 ms) is half a period: a hard switch would jump by up to twice the amplitude.
        const double hz = 200, amp = 0.5;
        int newDelay = (int)(Fs / hz / 2);
        float Sig(long n) => (float)(amp * Math.Sin(2 * Math.PI * hz * n / Fs));
        var rig = new Rig(Route(Row((Channels.FL, 1f))), (n, c) => c == Channels.FL ? Sig(n) : 0f);
        rig.Run(4);
        Assert.True(rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), delay: newDelay) }));
        rig.Run(10);

        double slope = amp * 2 * Math.PI * hz / Fs; // the sine's own largest step
        float maxStep = MaxStep(rig.Output);
        Assert.True(maxStep <= slope + 2 * amp / FadeFrames * 1.05, $"max step {maxStep}, sine slope {slope}");
        // After the fade the output is the input delayed by exactly the new delay.
        for (int i = rig.Output.Count - 200; i < rig.Output.Count; i++)
            Assert.Equal(Sig(i - newDelay), rig.Output[i], 5);
    }

    [Fact]
    public void DelayChangesArrivingDuringAFadeEndOnTheLatest()
    {
        float Sig(long n) => (float)Math.Sin(2 * Math.PI * 300 * n / Fs) * 0.5f;
        var rig = new Rig(Route(Row((Channels.FL, 1f)), delay: 10), (n, c) => c == Channels.FL ? Sig(n) : 0f);
        rig.Run(2);
        Assert.True(rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), delay: 200) }));
        rig.Run(1, 64);
        Assert.True(rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), delay: 400) }));
        rig.Run(1, 64);
        Assert.True(rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), delay: 333) }));
        rig.Run(12);
        for (int i = rig.Output.Count - 100; i < rig.Output.Count; i++)
            Assert.Equal(Sig(i - 333), rig.Output[i], 5);
    }

    [Fact]
    public void AudioThreadDoesNotAllocateDuringALiveChange()
    {
        var rig = new Rig(Route(Row((Channels.FL, 1f)), delay: 5), (n, c) => c == Channels.FL ? (n % 7) * 0.1f : c == Channels.FR ? 0.3f : 0f);
        // Warm up both paths (JIT) with one change first.
        rig.RunQuiet(4);
        Assert.True(rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FR, 1f)), gainDb: -6, delay: 50) }));
        rig.RunQuiet(8);

        // The change is built on this (caller) thread before measuring; Process must then not allocate at all.
        var routes = new[] { Route(Row((Channels.FL, 0.5f), (Channels.FR, 0.5f)), gainDb: 3, delay: 120) };
        Assert.True(rig.Mixer.SetRoutes(routes));
        long before = GC.GetAllocatedBytesForCurrentThread();
        rig.RunQuiet(12); // glide + cross-fade + steady state
        long after = GC.GetAllocatedBytesForCurrentThread();
        Assert.Equal(0, after - before);
    }

    [Fact]
    public async Task ConcurrentLiveChangesNeverBlockOrBreakTheAudioThread()
    {
        var rig = new Rig(Route(Row((Channels.FL, 1f))), (n, c) => c == Channels.FL ? 0.5f : 0f);
        using var stop = new CancellationTokenSource();
        var writer = Task.Run(() =>
        {
            int i = 0;
            while (!stop.IsCancellationRequested)
            {
                double g = -(i++ % 30);
                rig.Mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), gainDb: g, delay: i % 200) });
            }
        });
        var sw = System.Diagnostics.Stopwatch.StartNew();
        rig.Run(400);
        stop.Cancel();
        await writer;
        Assert.All(rig.Output, v => Assert.True(float.IsFinite(v) && Math.Abs(v) <= 0.5001f));
        Assert.True(sw.ElapsedMilliseconds < 5000);
    }

    [Fact]
    public void ChangesTheGraphCannotTakeAreRefused()
    {
        var mixer = new SinkMixer(2, new[] { Route(Row((Channels.FL, 1f))), Route(Row((Channels.FR, 1f)), devCh: 1) }, Fs);
        // Different speaker count, mute, device channel: a rebuild is needed.
        Assert.False(mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f))) }));
        Assert.False(mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f))), Route(Row((Channels.FR, 1f)), devCh: 0) }));
        Assert.False(mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f))), new SpeakerRoute("b", 1, Row((Channels.FR, 1f)), 0, true, 0) }));
        // A delay beyond the line's headroom.
        int tooLong = (int)(SinkMixer.DelayHeadroomMs * Fs / 1000) + 10;
        Assert.False(mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), delay: tooLong), Route(Row((Channels.FR, 1f)), devCh: 1) }));
        // Within the headroom: fine.
        Assert.True(mixer.SetRoutes(new[] { Route(Row((Channels.FL, 1f)), delay: tooLong - 20), Route(Row((Channels.FR, 1f)), devCh: 1) }));
    }

    [Fact]
    public void BassBusTakesNewRowsAndRefusesAStructureChange()
    {
        var bm = new BassManager(Fs, new[] { new BassSource(Row((Channels.FL, 1f)), 0, 80) });
        var logical = new float[Channels.Count * 4800];
        for (int f = 0; f < 4800; f++) logical[f * Channels.Count + Channels.FR] = 1f; // DC on FR only
        var bass = new float[4800];
        bm.Process(logical, bass, 4800);
        Assert.Equal(0f, bass[^1]);

        Assert.False(bm.SetSources(new[] { new BassSource(Row((Channels.FR, 1f)), 0, 100) })); // other crossover
        Assert.False(bm.SetSources(Array.Empty<BassSource>()));
        Assert.True(bm.SetSources(new[] { new BassSource(Row((Channels.FR, 1f)), -6.0206, 80) }));
        bm.Process(logical, bass, 4800);
        Assert.Equal(0.5f, bass[^1], 2); // low-passed DC settles at row × gain
    }

    // ---- what restarts the engine ----

    private const string Positional = """
    {
      "source": { "deviceId": "SRC", "mode": "loopback" },
      "upmix": true,
      "outputs": [ { "deviceId": "A", "latencyMs": 0, "bufferMs": 40 }, { "deviceId": "B", "latencyMs": 120, "bufferMs": 60 } ],
      "speakers": [
        { "name": "Sol", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 1, "SL": 0.7 }, "x": 1, "y": 1 },
        { "name": "Sag", "outputDeviceId": "A", "deviceChannel": 2, "source": { "FR": 1, "FC": 0.7 }, "x": 4, "y": 1 },
        { "name": "Arka", "outputDeviceId": "B", "deviceChannel": 1, "source": { "BL": 1, "BR": 1, "SR": 0.7, "FC": 0.7 } },
        { "name": "Bas", "outputDeviceId": "B", "deviceChannel": 2, "source": { "LFE": 1 }, "bassReceiver": true }
      ]
    }
    """;

    [Fact]
    public void MovingASpeakerKeepsTheEngineFingerprint()
    {
        var a = SurroundConfig.Parse(Positional);
        var b = SurroundConfig.Parse(Positional);
        // The UI recomputes rows (positional mix), automatic delay and gain, and stores the new position.
        b.Speakers[0].Source = new() { ["FL"] = 0.5, ["FC"] = 0.4, ["SL"] = 1 };
        b.Speakers[1].Source = new() { ["FR"] = 0.9, ["SR"] = 0.2 };
        b.Speakers[2].Source = new() { ["BL"] = 1, ["BR"] = 1, ["FC"] = 0.1 };
        b.Speakers[0].DelayMs = 3.4; b.Speakers[0].GainDb = -1.5;
        b.Speakers[2].DelayMs = 7; b.Speakers[2].GainDb = 2;
        b.Outputs[1].LatencyMs = 150;
        b.Speakers[0].Extra!["x"] = System.Text.Json.JsonSerializer.SerializeToElement(2.2);
        Assert.Equal(a.EngineFingerprint(), b.EngineFingerprint());
    }

    [Fact]
    public void MovingASpeakerWhileADeviceIsAbsentKeepsTheReducedFingerprint()
    {
        // Started without device B (e.g. the Bluetooth speaker is off): edits of the remaining speakers stay live.
        var absent = new[] { new Surround.Engine.Audio.DeviceProbe("B", null, false) };
        var a = Surround.Engine.Audio.DeviceRecovery.WithoutMissing(SurroundConfig.Parse(Positional), absent, out _)!;
        var edited = SurroundConfig.Parse(Positional);
        edited.Speakers[0].Source = new() { ["FL"] = 0.6, ["SL"] = 1 };
        edited.Speakers[0].DelayMs = 2;
        edited.Speakers[2].DelayMs = 9; // a speaker on the absent device
        var b = Surround.Engine.Audio.DeviceRecovery.WithoutMissing(edited, absent, out _)!;
        Assert.Equal(a.EngineFingerprint(), b.EngineFingerprint());
    }

    [Fact]
    public void ChangesOfTheGraphStillRestart()
    {
        string fp = SurroundConfig.Parse(Positional).EngineFingerprint();
        static SurroundConfig With(Action<SurroundConfig> edit)
        {
            var c = SurroundConfig.Parse(Positional);
            edit(c);
            return c;
        }
        // A logical channel no speaker played before (upmix layout / channel fold change).
        Assert.NotEqual(fp, With(c => c.Speakers[0].Source["TFL"] = 0.5).EngineFingerprint());
        // A channel that is no longer played by anyone.
        Assert.NotEqual(fp, With(c => c.Speakers[2].Source.Remove("SR")).EngineFingerprint());
        // LFE in a bass receiver's row (bass management).
        Assert.NotEqual(fp, With(c => c.Speakers[3].Source = new() { ["FL"] = 0.1 }).EngineFingerprint());
        Assert.NotEqual(fp, With(c => c.Speakers[1].Mute = true).EngineFingerprint());
        Assert.NotEqual(fp, With(c => c.Speakers[1].DeviceChannel = 3).EngineFingerprint());
        Assert.NotEqual(fp, With(c => c.Outputs[0].BufferMs = 50).EngineFingerprint());
        Assert.NotEqual(fp, With(c => c.Speakers[0].HighPassHz = 80).EngineFingerprint());
    }

    // ---- saving while dragging ----

    [Fact]
    public void ContinuousSavesReachTheFileOnceTheEditsPause()
    {
        string path = Path.Combine(Path.GetTempPath(), "surround-test-" + Guid.NewGuid().ToString("N"), "config.json");
        try
        {
            var store = new ConfigStore(path);
            var cfg = SurroundConfig.Parse(Positional);
            store.Save(cfg);
            string saved = File.ReadAllText(path);

            cfg.Speakers[0].GainDb = -7;
            store.SaveSoon(cfg, delayMs: 60_000);
            Assert.True(store.HasPending);
            Assert.Equal(saved, File.ReadAllText(path)); // not written yet
            Assert.Equal(-7, store.Load().Speakers[0].GainDb); // but every reader sees it

            store.Flush();
            Assert.False(store.HasPending);
            Assert.Equal(-7, SurroundConfig.Load(path).Speakers[0].GainDb);

            // A normal save supersedes a pending one.
            cfg.Speakers[0].GainDb = -9;
            store.SaveSoon(cfg, delayMs: 60_000);
            cfg.Speakers[0].GainDb = -2;
            store.Save(cfg);
            store.Flush();
            Assert.Equal(-2, SurroundConfig.Load(path).Speakers[0].GainDb);

            // And the timer writes it on its own.
            cfg.Speakers[0].GainDb = -4;
            store.SaveSoon(cfg, delayMs: 10);
            var sw = System.Diagnostics.Stopwatch.StartNew();
            while (store.HasPending && sw.ElapsedMilliseconds < 5000) Thread.Sleep(5);
            Assert.Equal(-4, SurroundConfig.Load(path).Speakers[0].GainDb);
        }
        finally
        {
            try { Directory.Delete(Path.GetDirectoryName(path)!, true); } catch { }
        }
    }
}
