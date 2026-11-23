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

public class SincResamplerTests
{
    private static float[] Sine(int n, double f, double fs = 48000, float amp = 0.5f)
    {
        var x = new float[n];
        for (int i = 0; i < n; i++) x[i] = amp * (float)Math.Sin(2 * Math.PI * f * i / fs);
        return x;
    }

    [Fact]
    public void RatioOneIsExactPassThroughWithHalfLengthLatency()
    {
        const int n = 2000;
        var input = Sine(n, 1000);
        var res = new SincResampler(1);
        var output = new float[n];
        int produced = res.Process(input, n, output, n, 1.0, out _);
        Assert.True(produced >= n - 1);
        int lat = SincResampler.Taps / 2;
        for (int i = lat; i < produced; i++) Assert.Equal(input[i - lat], output[i]);
    }

    [Theory]
    [InlineData(1000)]
    [InlineData(10000)]
    [InlineData(16000)]
    [InlineData(18000)]
    [InlineData(20000)]
    public void TrebleStaysFlatWhileThePhaseDrifts(double f)
    {
        // 300 ppm: the fractional phase sweeps 0..1 every ~70 ms, as under the drift controller.
        const int n = 48000;
        var input = Sine(n, f);
        var res = new SincResampler(1);
        var output = new float[n];
        int produced = res.Process(input, n, output, n, 1 + 300e-6, out _);
        // Amplitude per 10 ms block by projecting onto the (resampled) frequency; over a full phase sweep it must stay
        // within ±0.05 dB of the input (Hermite: down to -5 dB at 18 kHz).
        double w = 2 * Math.PI * f * (1 + 300e-6) / 48000;
        const int block = 480;
        for (int b = 1000; b + block < produced - 100; b += block)
        {
            double re = 0, im = 0;
            for (int i = b; i < b + block; i++) { re += output[i] * Math.Cos(w * i); im += output[i] * Math.Sin(w * i); }
            double amp = 2 * Math.Sqrt(re * re + im * im) / block;
            double db = 20 * Math.Log10(amp / 0.5);
            Assert.InRange(db, -0.05, 0.05);
        }
    }

    [Fact]
    public void ResampleKeepsSineFrequency()
    {
        const double fsIn = 44100, fsOut = 48000, f = 1000;
        int nIn = (int)fsIn * 2;
        var input = Sine(nIn, f, fsIn);
        var res = new SincResampler(1, fsIn / fsOut);
        var output = new float[(int)(fsOut * 2)];
        int produced = res.Process(input, nIn, output, output.Length, fsIn / fsOut, out _);
        Assert.True(produced > fsOut * 1.9);
        int crossings = 0;
        for (int i = 1; i < produced; i++) if (output[i - 1] < 0 && output[i] >= 0) crossings++;
        Assert.InRange(crossings / (produced / fsOut), f * 0.99, f * 1.01);
    }

    [Fact]
    public void DownsamplingRejectsContentAboveTheOutputNyquist()
    {
        // 48 kHz -> 32 kHz: a 20 kHz tone cannot exist at the output and must not fold back to 12 kHz.
        const int n = 48000;
        var input = Sine(n, 20000);
        var res = new SincResampler(1, 1.5);
        var output = new float[n];
        int produced = res.Process(input, n, output, output.Length, 1.5, out _);
        double sum = 0;
        for (int i = 200; i < produced; i++) sum += output[i] * output[i];
        double rmsDb = 10 * Math.Log10(sum / (produced - 200) / 0.125);
        Assert.True(rmsDb < -40, $"alias {rmsDb:0.0} dB");
    }

    [Fact]
    public void KeepsStateAcrossCalls()
    {
        const int n = 1000;
        var input = new float[n];
        for (int i = 0; i < n; i++) input[i] = (float)Math.Sin(0.05 * i);
        var a = new SincResampler(1);
        var whole = new float[n];
        a.Process(input, n, whole, n, 0.9, out _);

        var b = new SincResampler(1);
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

    [Fact]
    public void MultichannelKeepsChannelsApart()
    {
        const int n = 1000;
        var input = new float[n * 2];
        for (int i = 0; i < n; i++) { input[2 * i] = 0.3f; input[2 * i + 1] = -0.7f; }
        var res = new SincResampler(2);
        var output = new float[n * 2];
        int produced = res.Process(input, n, output, n, 1.0002, out _);
        for (int i = 100; i < produced; i++)
        {
            Assert.Equal(0.3f, output[2 * i], 4);
            Assert.Equal(-0.7f, output[2 * i + 1], 4);
        }
    }
}
