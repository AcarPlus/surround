using Surround.Engine;
using Surround.Engine.Dsp;

namespace Surround.Engine.Tests;

public class RingBufferTests
{
    [Fact]
    public void WrapsAroundAndKeepsOrder()
    {
        var rb = new RingBuffer(8);
        var buf = new float[8];
        float next = 0, expect = 0;
        for (int round = 0; round < 50; round++)
        {
            var w = Enumerable.Range(0, 5).Select(_ => next++).ToArray();
            Assert.Equal(5, rb.Write(w));
            Assert.Equal(5, rb.Read(buf.AsSpan(0, 5)));
            for (int i = 0; i < 5; i++) Assert.Equal(expect++, buf[i]);
        }
        Assert.Equal(0, rb.Count);
    }

    [Fact]
    public void FillLimitsWritesAndReportsCount()
    {
        var rb = new RingBuffer(10);
        Assert.Equal(10, rb.Write(new float[15]));
        Assert.Equal(10, rb.Count);
        Assert.Equal(0, rb.Free);
        Assert.Equal(0, rb.Write(new float[1]));
        Assert.Equal(4, rb.Skip(4));
        Assert.Equal(6, rb.Count);
        Assert.Equal(4, rb.Write(new float[10]));
    }

    [Fact]
    public void GranularityKeepsWholeFrames()
    {
        var rb = new RingBuffer(10, 4);
        Assert.Equal(8, rb.Write(new float[10]));
        Assert.Equal(4, rb.Skip(7));
    }

    [Fact]
    public void PeekDoesNotConsume()
    {
        var rb = new RingBuffer(8);
        rb.Write(new float[] { 1, 2, 3 });
        var d = new float[3];
        Assert.Equal(3, rb.Peek(d));
        Assert.Equal(3, rb.Count);
        Assert.Equal(new float[] { 1, 2, 3 }, d);
    }

    [Fact]
    public async Task ConcurrentProducerConsumerKeepsSequence()
    {
        var rb = new RingBuffer(256);
        const int total = 200_000;
        var producer = Task.Run(() =>
        {
            int i = 0;
            var chunk = new float[17];
            while (i < total)
            {
                int n = Math.Min(chunk.Length, total - i);
                for (int k = 0; k < n; k++) chunk[k] = i + k;
                i += rb.Write(chunk.AsSpan(0, n));
            }
        });
        int expect = 0;
        var buf = new float[32];
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (expect < total && sw.Elapsed.TotalSeconds < 20)
        {
            int r = rb.Read(buf);
            for (int k = 0; k < r; k++) Assert.Equal(expect++, buf[k]);
        }
        await producer;
        Assert.Equal(total, expect);
    }
}

public class DelayLineTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(7)]
    [InlineData(100)]
    public void DelaysByExactSampleCount(int d)
    {
        var dl = new DelayLine(d);
        for (int n = 0; n < 300; n++)
        {
            float x = n + 1;
            float y = dl.Process(x);
            Assert.Equal(n - d >= 0 ? (n - d) + 1 : 0f, y);
        }
    }
}

public class SinkMixerTests
{
    private static float[] Frame(params (int ch, float v)[] vals)
    {
        var f = new float[Channels.Count];
        foreach (var (c, v) in vals) f[c] = v;
        return f;
    }

    private static float[] Row(params (int ch, float v)[] vals) => Frame(vals);

    [Fact]
    public void RoutesMixRowsToDeviceChannelsWithGain()
    {
        var routes = new[]
        {
            new SpeakerRoute("L", 0, Row((Channels.FL, 1f)), 0, false, 0),
            new SpeakerRoute("C+LFE", 3, Row((Channels.FC, 1f), (Channels.LFE, 0.5f)), -6.0206, false, 0),
            new SpeakerRoute("Muted", 1, Row((Channels.FR, 1f)), 0, true, 0),
        };
        var mixer = new SinkMixer(4, routes);
        var ring = new RingBuffer(4 * 16, 4);
        var logical = Frame((Channels.FL, 0.8f), (Channels.FR, 0.9f), (Channels.FC, 0.4f), (Channels.LFE, 0.2f));
        Assert.Equal(0, mixer.Process(logical, 1, ring));

        var o = new float[4];
        Assert.Equal(4, ring.Read(o));
        Assert.Equal(0.8f, o[0], 5);
        Assert.Equal(0f, o[1]);
        Assert.Equal(0f, o[2]);
        Assert.Equal((0.4f + 0.1f) * 0.5f, o[3], 4);
    }

    [Fact]
    public void SpeakersSharingAChannelAreSummed()
    {
        var routes = new[]
        {
            new SpeakerRoute("a", 0, Row((Channels.FL, 1f)), 0, false, 0),
            new SpeakerRoute("b", 0, Row((Channels.FR, 1f)), 0, false, 0),
        };
        var mixer = new SinkMixer(2, routes);
        var ring = new RingBuffer(2 * 4, 2);
        mixer.Process(Frame((Channels.FL, 0.25f), (Channels.FR, 0.5f)), 1, ring);
        var o = new float[2];
        ring.Read(o);
        Assert.Equal(0.75f, o[0], 5);
        Assert.Equal(0f, o[1]);
    }

    [Fact]
    public void AppliesPerSpeakerDelay()
    {
        var routes = new[]
        {
            new SpeakerRoute("a", 0, Row((Channels.FL, 1f)), 0, false, 0),
            new SpeakerRoute("b", 1, Row((Channels.FL, 1f)), 0, false, 3),
        };
        var mixer = new SinkMixer(2, routes);
        var ring = new RingBuffer(2 * 32, 2);
        var logical = new float[Channels.Count * 6];
        for (int f = 0; f < 6; f++) logical[f * Channels.Count] = f + 1;
        mixer.Process(logical, 6, ring);
        var o = new float[12];
        Assert.Equal(12, ring.Read(o));
        for (int f = 0; f < 6; f++)
        {
            Assert.Equal(f + 1, o[f * 2]);
            Assert.Equal(f - 3 >= 0 ? f - 3 + 1 : 0f, o[f * 2 + 1]);
        }
    }

    [Fact]
    public void ReportsDroppedFramesWhenRingIsFull()
    {
        var mixer = new SinkMixer(2, new[] { new SpeakerRoute("a", 0, Row((Channels.FL, 1f)), 0, false, 0) });
        var ring = new RingBuffer(2 * 4, 2);
        Assert.Equal(6, mixer.Process(new float[Channels.Count * 10], 10, ring));
    }

    [Fact]
    public void RejectsChannelOutOfRange()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new SinkMixer(2, new[] { new SpeakerRoute("x", 2, Row((Channels.FL, 1f)), 0, false, 0) }));
    }
}

public class HermiteResamplerTests
{
    [Fact]
    public void RatioOneIsIdentityWithTwoSampleLatency()
    {
        const int n = 2000;
        var input = new float[n];
        for (int i = 0; i < n; i++) input[i] = (float)Math.Sin(2 * Math.PI * 1000 * i / 48000.0);
        var res = new HermiteResampler(1);
        var output = new float[n];
        int produced = res.Process(input, n, output, n, 1.0, out int consumed);
        Assert.True(produced >= n - 3);
        Assert.True(consumed >= n - 3);
        for (int i = 2; i < produced; i++) Assert.Equal(input[i - 2], output[i], 4);
    }

    [Fact]
    public void ResampleKeepsSineFrequency()
    {
        const double fsIn = 44100, fsOut = 48000, f = 1000;
        int nIn = (int)fsIn * 2;
        var input = new float[nIn];
        for (int i = 0; i < nIn; i++) input[i] = (float)Math.Sin(2 * Math.PI * f * i / fsIn);
        var res = new HermiteResampler(1);
        var output = new float[(int)(fsOut * 2)];
        int produced = res.Process(input, nIn, output, output.Length, fsIn / fsOut, out _);
        Assert.True(produced > fsOut * 1.9);

        int crossings = 0;
        for (int i = 1; i < produced; i++) if (output[i - 1] < 0 && output[i] >= 0) crossings++;
        double measured = crossings / (produced / fsOut);
        Assert.InRange(measured, f * 0.99, f * 1.01);
    }

    [Fact]
    public void KeepsStateAcrossCalls()
    {
        const int n = 1000;
        var input = new float[n];
        for (int i = 0; i < n; i++) input[i] = (float)Math.Sin(0.05 * i);
        var a = new HermiteResampler(1);
        var whole = new float[n];
        a.Process(input, n, whole, n, 0.9, out _);

        var b = new HermiteResampler(1);
        var split = new List<float>();
        int pos = 0;
        var tmp = new float[100];
        while (pos < n)
        {
            int chunk = Math.Min(37, n - pos);
            int p = b.Process(input.AsSpan(pos), chunk, tmp, tmp.Length, 0.9, out int c);
            split.AddRange(tmp.Take(p));
            pos += c;
            if (c == 0 && p == 0) break;
        }
        for (int i = 0; i < Math.Min(split.Count, 900); i++) Assert.Equal(whole[i], split[i], 5);
    }
}

public class UpmixerTests
{
    [Fact]
    public void MonoInputGivesNoSurround()
    {
        var up = new Upmixer(48000);
        const int n = 4800;
        var st = new float[n * 2];
        var rnd = new Random(1);
        for (int i = 0; i < n; i++) st[i * 2] = st[i * 2 + 1] = (float)(rnd.NextDouble() * 2 - 1);
        var lg = new float[n * Channels.Count];
        up.Process(st, lg, n);
        float maxSur = 0, maxFc = 0;
        for (int i = 0; i < n; i++)
        {
            foreach (int c in new[] { Channels.BL, Channels.BR, Channels.SL, Channels.SR })
                maxSur = Math.Max(maxSur, Math.Abs(lg[i * 8 + c]));
            maxFc = Math.Max(maxFc, Math.Abs(lg[i * 8 + Channels.FC]));
            Assert.Equal(st[i * 2], lg[i * 8 + Channels.FL]);
            Assert.Equal(st[i * 2], lg[i * 8 + Channels.FC], 5);
        }
        Assert.True(maxSur < 1e-6f);
        Assert.True(maxFc > 0.5f);
    }

    [Fact]
    public void SideSignalAppearsDelayedWithInvertedRightSurround()
    {
        var up = new Upmixer(48000);
        const int n = 2400;
        var st = new float[n * 2];
        for (int i = 0; i < n; i++) { st[i * 2] = 0.5f; st[i * 2 + 1] = -0.5f; } // pure side
        var lg = new float[n * 8];
        up.Process(st, lg, n);
        int delay = (int)Math.Round(0.012 * 48000);
        Assert.Equal(0f, lg[(delay - 1) * 8 + Channels.BL]);
        Assert.True(lg[(n - 1) * 8 + Channels.BL] > 0.4f);
        Assert.Equal(lg[(n - 1) * 8 + Channels.BL], -lg[(n - 1) * 8 + Channels.BR], 5);
        Assert.Equal(0f, lg[(n - 1) * 8 + Channels.FC], 5);
    }

    [Fact]
    public void LfeIsLowpassed()
    {
        float Rms(double hz)
        {
            var up = new Upmixer(48000);
            const int n = 48000;
            var st = new float[n * 2];
            for (int i = 0; i < n; i++) st[i * 2] = st[i * 2 + 1] = (float)Math.Sin(2 * Math.PI * hz * i / 48000);
            var lg = new float[n * 8];
            up.Process(st, lg, n);
            double s = 0;
            for (int i = 24000; i < n; i++) s += lg[i * 8 + Channels.LFE] * lg[i * 8 + Channels.LFE];
            return (float)Math.Sqrt(s / 24000);
        }
        Assert.True(Rms(50) > 0.3f);
        Assert.True(Rms(2000) < 0.01f);
    }
}
