using Surround.Engine.Config;
using Surround.Engine.Dsp;
using Xunit.Abstractions;

namespace Surround.Engine.Tests;

/// <summary>
/// Offline model of the engine's signal path for a stereo source (upmix → global processing → channel fold →
/// speaker rows), used to compare the built-in profiles by numbers: per-speaker level, the in-room sum (all speakers
/// at the same distance, coherent: what low frequencies and on-axis sound do) and the power sum (what a diffuse
/// room does at high frequencies), each in three bands. The profile values mirror ui/src/lib/profiles.ts.
/// </summary>
internal static class ModeChain
{
    public const int Fs = 48000;

    public sealed record Profile(string Name, string Mode, ProcessingConfig Processing, double CenterDb = 0, double Diffusion = 1);

    private static ProcessingConfig Gentle(double bass, double clarity, double dyn) => new()
    {
        Enabled = true, AutoPreamp = true, Limiter = true, BassBoostDb = bass, ClarityDb = clarity, DynamicBoost = dyn,
    };

    /// <summary>Built-in profiles as they were up to 0.6.x (BUILTIN_PROFILES_REV 2).</summary>
    public static readonly Profile[] OldProfiles =
    {
        new("Düz", UpmixOptions.Direct, new ProcessingConfig { Enabled = false, Limiter = true }),
        new("Müzik", UpmixOptions.Direct, Gentle(1.5, 1, 0)),
        new("Film", UpmixOptions.Film, Gentle(2, 1.5, 0.15), CenterDb: 1, Diffusion: 0.6),
        new("Oyun", UpmixOptions.Game, Gentle(1, 2, 0.2), Diffusion: 0.6),
    };

    /// <summary>Built-in profiles as they were in 0.7.0 (BUILTIN_PROFILES_REV 3): -1 dB preamp + compressor.</summary>
    public static readonly Profile[] Rev3Profiles =
    {
        OldProfiles[0],
        OldProfiles[1],
        new("Film", UpmixOptions.Film, Rev3Lively(3.5, 2.5), CenterDb: 1, Diffusion: 0.6),
        new("Oyun", UpmixOptions.Game, Rev3Lively(2.5, 3), Diffusion: 0.6),
    };

    private static ProcessingConfig Rev3Lively(double bassDb, double trebleDb) => new()
    {
        Enabled = true, AutoPreamp = false, PreampDb = -1, Limiter = true, DynamicBoost = 0.15, Peq = Shelves(bassDb, trebleDb),
    };

    /// <summary>Built-in profiles of 0.7.1 (BUILTIN_PROFILES_REV 4): mild shelves, no compressor.</summary>
    public static readonly Profile[] Rev4Profiles =
    {
        OldProfiles[0],
        new("Müzik", UpmixOptions.Direct, Rev4Music()),
        new("Film", UpmixOptions.Film, Lively(2.5, 2), CenterDb: 1, Diffusion: 0.6),
        new("Oyun", UpmixOptions.Game, Lively(2, 2.5), Diffusion: 0.6),
    };

    /// <summary>Built-in profiles now (BUILTIN_PROFILES_REV 5); keep in sync with ui/src/lib/profiles.ts.</summary>
    public static readonly Profile[] Profiles =
    {
        OldProfiles[0],
        new("Müzik", UpmixOptions.Direct, Music()),
        new("Film", UpmixOptions.Film, Film(), CenterDb: 1, Diffusion: 0.6),
        new("Oyun", UpmixOptions.Game, Game(), Diffusion: 0.6),
    };

    private static ProcessingConfig Chain(double ambience, params PeqBand[] bands) => new()
    {
        Enabled = true, AutoPreamp = false, PreampDb = 0, Limiter = true, DynamicBoost = 0, Ambience = ambience,
        Peq = bands.ToList(),
    };

    private static PeqBand Eq(string type, double hz, double db, double q) => new() { Type = type, FreqHz = hz, GainDb = db, Q = q };

    /// <summary>Film: bass +4 dB and dialog presence +3 dB (2 kHz), a touch wider.</summary>
    public static ProcessingConfig Film() => Chain(0.15,
        Eq("lowShelf", 90, 4, 0.7), Eq("peak", 2000, 3, 1));

    /// <summary>Game: footsteps and positional cues +4 dB (2-5 kHz), rumble -2 dB, wide stage.</summary>
    public static ProcessingConfig Game() => Chain(0.4,
        Eq("lowShelf", 80, -2, 0.7), Eq("peak", 3200, 4, 0.7));

    /// <summary>Music: "V" (bass +4, air +3, a small low-mid dip that also frees headroom) and a wide stage.</summary>
    public static ProcessingConfig Music() => Chain(0.35,
        Eq("lowShelf", 90, 4, 0.7), Eq("peak", 350, -1.5, 1), Eq("highShelf", 6000, 3, 0.7));

    /// <summary>
    /// Film and game profiles: a bass and a treble shelf at unity preamp, no compressor. The 0.7.0 compressor
    /// (threshold -9.6 dB, 5 ms / 150 ms) sat on every hot master and pumped ("choppy"), and the -1 dB preamp made
    /// the mids quieter than flat; the device limiter alone catches the rare peak the shelves push over -1 dBFS.
    /// </summary>
    public static ProcessingConfig Lively(double bassDb, double trebleDb) => new()
    {
        Enabled = true, AutoPreamp = false, PreampDb = 0, Limiter = true, DynamicBoost = 0, Peq = Shelves(bassDb, trebleDb),
    };

    /// <summary>
    /// Music: the flat profile's direct distribution with its own character: a "V" (bass and air shelves, a small
    /// low-mid dip that also frees headroom) and a wider stereo image; unity preamp, no compressor.
    /// </summary>
    public static ProcessingConfig Rev4Music() => new()
    {
        Enabled = true, AutoPreamp = false, PreampDb = 0, Limiter = true, DynamicBoost = 0, Ambience = 0.25,
        Peq = new List<PeqBand>
        {
            new PeqBand { Type = "lowShelf", FreqHz = 100, GainDb = 3, Q = 0.7 },
            new PeqBand { Type = "peak", FreqHz = 350, GainDb = -1.5, Q = 1 },
            new PeqBand { Type = "highShelf", FreqHz = 8000, GainDb = 2.5, Q = 0.7 },
        },
    };

    /// <summary>The "liveliness" of the film and game profiles: a gentle bass and a gentle treble shelf.</summary>
    public static List<PeqBand> Shelves(double bassDb, double trebleDb) => new()
    {
        new PeqBand { Type = "lowShelf", FreqHz = 120, GainDb = bassDb, Q = 0.7 },
        new PeqBand { Type = "highShelf", FreqHz = 5000, GainDb = trebleDb, Q = 0.7 },
    };

    /// <summary>Speaker rows of a layout (FL..TBR).</summary>
    public sealed record Layout(string Name, float[][] Rows, string[] Names, double[]? GainsDb = null);

    private static float[] Row(params (int Ch, float V)[] v)
    {
        var r = new float[Channels.Count];
        foreach (var (c, g) in v) r[c] = g;
        return r;
    }

    /// <summary>Front left, front right and center by role (what the setup wizard makes).</summary>
    public static readonly Layout Lcr = new("L+R+C (rol)",
        new[] { Row((Channels.FL, 1)), Row((Channels.FR, 1)), Row((Channels.FC, 1)) }, new[] { "Sol", "Sağ", "Orta" });

    /// <summary>The same three speakers with "distribute by position": the side/back channels land on the fronts.</summary>
    public static readonly Layout LcrPositional = new("L+R+C (konuma göre)",
        new[]
        {
            Row((Channels.FL, 1), (Channels.SL, 1), (Channels.BL, 1)),
            Row((Channels.FR, 1), (Channels.SR, 1), (Channels.BR, 1)),
            Row((Channels.FC, 1)),
        },
        new[] { "Sol", "Sağ", "Orta" });

    /// <summary>
    /// A real three-speaker room with "distribute by position": two wide fronts (each also takes its side's side/back
    /// channels and most of its front channel) and a center that shares the fronts; the center speaker is much louder
    /// than the others and calibrated down by 16 dB.
    /// </summary>
    public static readonly Layout WidePositional = new("geniş sol/sağ + orta (konuma göre, ölçülü)",
        new[]
        {
            Row((Channels.FL, 0.8f), (Channels.SL, 1), (Channels.BL, 1)),
            Row((Channels.FR, 0.789f), (Channels.SR, 1), (Channels.BR, 1)),
            Row((Channels.FL, 0.601f), (Channels.FC, 1), (Channels.FR, 0.614f)),
        },
        new[] { "G.sol", "G.sağ", "Orta" }, new[] { -2.7, 0, -16 });

    /// <summary>The center (Bluetooth) is off: the engine runs on the fronts only.</summary>
    public static readonly Layout Lr = new("L+R (orta kapalı)",
        new[] { Row((Channels.FL, 1)), Row((Channels.FR, 1)) }, new[] { "Sol", "Sağ" });

    /// <summary>Runs <paramref name="stereo"/> (interleaved L/R) through the chain; returns one signal per speaker.</summary>
    public static float[][] Run(Profile p, Layout layout, float[] stereo, bool limit = true)
    {
        int frames = stereo.Length / 2;
        var gains = layout.Rows.Select((_, k) => (float)Math.Pow(10, (layout.GainsDb?[k] ?? 0) / 20)).ToArray();
        var used = ChannelFold.UsedChannels(layout.Rows.Select(r => (r, false)));
        var upLayout = UpmixLayout.ForSpeakers(layout.Rows);
        IStereoUpmixer up = p.Mode == UpmixOptions.Direct ? new DirectUpmixer(upLayout)
            : p.Mode == UpmixOptions.Game ? new GameUpmixer(Fs, upLayout) : new FilmUpmixer(Fs, upLayout);
        up.Update(UpmixSettings.Build(new UpmixOptions { Mode = p.Mode, CenterDb = p.CenterDb, Diffusion = p.Diffusion }));
        var proc = new GlobalProcessor(Fs, used);
        proc.Update(ProcessingSettings.Build(p.Processing, Fs));
        var fold = ChannelFold.Plan(used);

        var outs = layout.Rows.Select(_ => new float[frames]).ToArray();
        const int block = 480;
        var inBuf = new float[block * Channels.Count];
        var buf = new float[block * Channels.Count];
        for (int start = 0; start < frames; start += block)
        {
            int n = Math.Min(block, frames - start);
            Array.Clear(inBuf);
            for (int f = 0; f < n; f++)
            {
                inBuf[f * Channels.Count + Channels.FL] = stereo[2 * (start + f)];
                inBuf[f * Channels.Count + Channels.FR] = stereo[2 * (start + f) + 1];
            }
            up.Process(inBuf, buf, n);
            var span = buf.AsSpan(0, n * Channels.Count);
            proc.Process(span, n);
            fold?.Process(span, n);
            for (int k = 0; k < layout.Rows.Length; k++)
            {
                var row = layout.Rows[k];
                for (int f = 0; f < n; f++)
                {
                    float acc = 0;
                    for (int c = 0; c < Channels.Count; c++) acc += row[c] * span[f * Channels.Count + c];
                    outs[k][start + f] = acc * gains[k];
                }
            }
        }
        // Each device's safety limiter (on in every built-in profile), here one per speaker.
        if (limit)
            foreach (var o in outs) new PeakLimiter(1, Fs).Process(o, o.Length);
        // The film mode delays everything by its frame; drop the start-up so all chains are compared settled.
        int skip = Fs / 2;
        return outs.Select(o => o[skip..]).ToArray();
    }

    // ---- test signals (deterministic) ----

    /// <summary>Pink noise (Paul Kellet's refined filter), RMS normalised to <paramref name="rmsDb"/>.</summary>
    public static float[] Pink(int frames, int seed, double rmsDb = -20)
    {
        var rnd = new Random(seed);
        double b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        var y = new float[frames];
        for (int i = 0; i < frames; i++)
        {
            double w = rnd.NextDouble() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
            b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
            y[i] = (float)(b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362);
            b6 = w * 0.115926;
        }
        return Scale(y, rmsDb);
    }

    public static float[] Scale(float[] y, double rmsDb)
    {
        double k = Math.Pow(10, rmsDb / 20) / Rms(y);
        return y.Select(v => (float)(v * k)).ToArray();
    }

    public static double Rms(ReadOnlySpan<float> y)
    {
        double s = 0;
        foreach (var v in y) s += (double)v * v;
        return Math.Sqrt(s / Math.Max(1, y.Length));
    }

    public static double Db(double rms) => 20 * Math.Log10(Math.Max(rms, 1e-12));

    public static float[] Interleave(float[] l, float[] r)
    {
        var s = new float[l.Length * 2];
        for (int i = 0; i < l.Length; i++) { s[2 * i] = l[i]; s[2 * i + 1] = r[i]; }
        return s;
    }

    /// <summary>Same pink noise in both channels: a centered voice / mono bass.</summary>
    public static float[] Centered(int frames) { var m = Pink(frames, 1); return Interleave(m, m); }

    /// <summary>Independent pink noise in L and R: ambience, reverb, wide stereo.</summary>
    public static float[] Wide(int frames) => Interleave(Pink(frames, 2), Pink(frames, 3));

    /// <summary>
    /// "Program": a mono center (voice, bass), partly correlated stereo (instruments panned at about 30 %), and an
    /// uncorrelated ambience, at levels typical of a film or game mix (-20 dBFS RMS per channel).
    /// </summary>
    public static float[] Program(int frames) => Program(frames, 0);

    public static float[] Program(int frames, double gainDb)
    {
        var c = Pink(frames, 11, -23); var a = Pink(frames, 12, -26); var b = Pink(frames, 13, -26);
        var l = Pink(frames, 14, -28); var r = Pink(frames, 15, -28);
        var left = new float[frames]; var right = new float[frames];
        for (int i = 0; i < frames; i++)
        {
            left[i] = c[i] + 0.8f * a[i] + 0.45f * b[i] + l[i];
            right[i] = c[i] + 0.45f * a[i] + 0.8f * b[i] + r[i];
        }
        if (gainDb != 0)
        {
            float g = (float)Math.Pow(10, gainDb / 20);
            for (int i = 0; i < frames; i++) { left[i] *= g; right[i] *= g; }
        }
        return Interleave(left, right);
    }

    // ---- analysis ----

    public enum Band { Low, Mid, High, All, Presence }

    /// <summary>LR4 band split: low &lt; 150 Hz, mid 150 Hz .. 4 kHz, high &gt; 4 kHz; presence 2 .. 5 kHz (cue band).</summary>
    public static float[] Filter(float[] x, Band band)
    {
        if (band == Band.All) return x;
        var y = (float[])x.Clone();
        void Apply(LinkwitzRiley f) { for (int i = 0; i < y.Length; i++) y[i] = f.Process(y[i]); }
        if (band == Band.Low) Apply(LinkwitzRiley.LowPass(Fs, 150));
        if (band == Band.Mid) { Apply(LinkwitzRiley.HighPass(Fs, 150)); Apply(LinkwitzRiley.LowPass(Fs, 4000)); }
        if (band == Band.High) Apply(LinkwitzRiley.HighPass(Fs, 4000));
        if (band == Band.Presence) { Apply(LinkwitzRiley.HighPass(Fs, 2000)); Apply(LinkwitzRiley.LowPass(Fs, 5000)); }
        return y;
    }

    public sealed record Metrics(double[] SpeakerDb, double[] SpeakerPeakDb, double SumDb, double PowerDb,
        Dictionary<Band, (double Sum, double Power)> Bands);

    public static Metrics Measure(float[][] outs)
    {
        var bands = new Dictionary<Band, (double, double)>();
        foreach (Band band in Enum.GetValues<Band>())
        {
            var f = outs.Select(o => Filter(o, band)).ToArray();
            var sum = new float[f[0].Length];
            foreach (var o in f) for (int i = 0; i < sum.Length; i++) sum[i] += o[i];
            double power = f.Sum(o => { double r = Rms(o); return r * r; });
            bands[band] = (Db(Rms(sum)), 10 * Math.Log10(Math.Max(power, 1e-24)));
        }
        return new Metrics(
            outs.Select(o => Db(Rms(o))).ToArray(),
            outs.Select(o => Db(o.Max(v => Math.Abs(v)))).ToArray(),
            bands[Band.All].Item1, bands[Band.All].Item2, bands);
    }
}

public class ModeLoudnessTests
{
    private readonly ITestOutputHelper _out;
    public ModeLoudnessTests(ITestOutputHelper output) => _out = output;

    private const int Frames = ModeChain.Fs * 4;

    private static readonly (string Name, Func<int, float[]> Make)[] Signals =
    {
        ("orta (mono)", ModeChain.Centered),
        ("geniş (ilintisiz)", ModeChain.Wide),
        ("program", ModeChain.Program),
    };

    private static readonly ModeChain.Layout[] Layouts =
        { ModeChain.Lcr, ModeChain.LcrPositional, ModeChain.WidePositional, ModeChain.Lr };

    private void Table(ModeChain.Profile[] profiles, string title)
    {
        _out.WriteLine($"=== {title} ===");
        foreach (var layout in Layouts)
            foreach (var (sigName, make) in Signals)
            {
                var input = make(Frames);
                _out.WriteLine($"-- {layout.Name}, sinyal: {sigName}");
                _out.WriteLine($"{"profil",-6} | {string.Join(" | ", layout.Names.Select(n => $"{n,6}"))} | toplam(koh) | güç | bas koh/güç | orta koh/güç | tiz koh/güç | tepe");
                foreach (var p in profiles)
                {
                    var m = ModeChain.Measure(ModeChain.Run(p, layout, input));
                    string B(ModeChain.Band b) => $"{m.Bands[b].Sum,6:0.0}/{m.Bands[b].Power,6:0.0}";
                    _out.WriteLine($"{p.Name,-6} | {string.Join(" | ", m.SpeakerDb.Select(d => $"{d,6:0.0}"))} | {m.SumDb,11:0.0} | {m.PowerDb,5:0.0} | {B(ModeChain.Band.Low)} | {B(ModeChain.Band.Mid)} | {B(ModeChain.Band.High)} | {m.SpeakerPeakDb.Max(),5:0.0}");
                }
            }
    }

    /// <summary>
    /// Every built-in mode at least as loud as the flat profile with its own character (REV 5: film and music a clear bass
    /// lift, game the cue band up and the rumble down, music the air too), in every layout, on a film/game-like program
    /// at -20 dBFS RMS (after the device limiters). Measured before 0.7.0 (0.6.x
    /// upmix and profiles; power sum, dB relative to the flat profile):
    /// <code>
    /// layout                         Film    Oyun
    /// L+R+C (rol)                    -0.2    -0.9   (centered sound moved out of the fronts: coherent sum -2.0 / -2.7)
    /// L+R+C (konuma göre)            -7.4    -8.2
    /// geniş sol/sağ + orta (ölçülü)  -14.7   -15.3  (the center speaker is calibrated -16 dB: the dialog vanished)
    /// L+R (orta kapalı)              +1.4    +0.7
    /// </code>
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void FilmAndGameAreAtLeastAsFullAsFlat(int layoutIndex)
    {
        var layout = Layouts[layoutIndex];
        var input = ModeChain.Program(Frames);
        var flat = ModeChain.Measure(ModeChain.Run(ModeChain.Profiles[0], layout, input));
        foreach (var p in ModeChain.Profiles.Skip(1))
        {
            var m = ModeChain.Measure(ModeChain.Run(p, layout, input));
            string who = $"{p.Name}, {layout.Name}";
            double D(ModeChain.Band b) => m.Bands[b].Power - flat.Bands[b].Power;
            // Each mode has its own audible character (REV 5), never quieter than flat overall.
            Assert.True(m.PowerDb >= flat.PowerDb + (p.Name == "Oyun" ? 0 : 0.5), $"{who}: {m.PowerDb - flat.PowerDb:+0.0;-0.0} dB vs flat");
            Assert.True(m.SumDb >= flat.SumDb - 0.5, $"{who}: in-room sum {m.SumDb - flat.SumDb:+0.0;-0.0} dB vs flat");
            if (p.Name == "Oyun")
            {
                Assert.True(D(ModeChain.Band.Low) <= -0.5, $"{who}: rumble {D(ModeChain.Band.Low):+0.0;-0.0} dB");
                Assert.True(D(ModeChain.Band.Presence) >= 2.5, $"{who}: cues {D(ModeChain.Band.Presence):+0.0;-0.0} dB");
            }
            else
            {
                Assert.True(D(ModeChain.Band.Low) >= 2.0, $"{who}: bass {D(ModeChain.Band.Low):+0.0;-0.0} dB");
                Assert.True(D(ModeChain.Band.Mid) >= -0.5, $"{who}: mids {D(ModeChain.Band.Mid):+0.0;-0.0} dB");
            }
            if (p.Name == "Müzik") Assert.True(D(ModeChain.Band.High) >= 2.0, $"{who}: air {D(ModeChain.Band.High):+0.0;-0.0} dB");
            // Every speaker still plays (none emptied into another one), and no peak beyond the limiter's ceiling.
            for (int k = 0; k < m.SpeakerDb.Length; k++)
                Assert.True(m.SpeakerDb[k] >= flat.SpeakerDb[k] - 1.5, $"{who}: {layout.Names[k]} {m.SpeakerDb[k] - flat.SpeakerDb[k]:+0.0;-0.0} dB");
            Assert.True(m.SpeakerPeakDb.Max() <= -0.09, $"{who}: peak {m.SpeakerPeakDb.Max():0.00} dBFS");
        }
    }

    /// <summary>
    /// No clipping, and on hot masters the boosts cost only a little extra limiting (the program-dependent release keeps it
    /// a steady gain rather than pumping).
    /// </summary>
    [Fact]
    public void LoudInputIsNotLimitedMuchMoreThanFlat()
    {
        foreach (var layout in new[] { ModeChain.Lcr, ModeChain.Lr })
        {
            var input = ModeChain.Program(Frames, 8); // -12 dBFS RMS per channel, peaks near 0 dBFS
            double Loss(ModeChain.Profile p) =>
                ModeChain.Measure(ModeChain.Run(p, layout, input, limit: false)).PowerDb - ModeChain.Measure(ModeChain.Run(p, layout, input)).PowerDb;
            double flat = Loss(ModeChain.Profiles[0]);
            foreach (var p in ModeChain.Profiles.Skip(1))
            {
                double loss = Loss(p);
                Assert.True(loss <= flat + 2.5, $"{p.Name}, {layout.Name}: limiter takes {loss:0.0} dB, flat {flat:0.0} dB");
            }
        }
    }

    /// <summary>
    /// Music sounded the same as flat (0.7.0: +1.5 dB bass, +1 dB clarity, then the automatic preamp took most of it
    /// back). Now it must be audibly its own: a clear bass and air lift and a wider image than flat.
    /// </summary>
    [Fact]
    public void MusicIsAudiblyDifferentFromFlat()
    {
        var input = ModeChain.Program(Frames);
        var layout = ModeChain.Lr;
        var flatOut = ModeChain.Run(ModeChain.Profiles[0], layout, input);
        var musicOut = ModeChain.Run(ModeChain.Profiles[1], layout, input);
        var flat = ModeChain.Measure(flatOut);
        var music = ModeChain.Measure(musicOut);
        Assert.True(music.Bands[ModeChain.Band.Low].Power >= flat.Bands[ModeChain.Band.Low].Power + 2.0, "music bass");
        Assert.True(music.Bands[ModeChain.Band.High].Power >= flat.Bands[ModeChain.Band.High].Power + 1.5, "music treble");
        static double Corr(float[] l, float[] r)
        {
            double lr = 0, ll = 0, rr = 0;
            for (int i = 0; i < l.Length; i++) { lr += l[i] * r[i]; ll += l[i] * l[i]; rr += r[i] * r[i]; }
            return lr / Math.Sqrt(ll * rr);
        }
        double cf = Corr(flatOut[0], flatOut[1]), cm = Corr(musicOut[0], musicOut[1]);
        _out.WriteLine($"L/R ilinti: Düz {cf:0.00}, Müzik {cm:0.00}");
        Assert.True(cm <= cf - 0.1, $"music not wider: {cm:0.00} vs flat {cf:0.00}");
    }

    /// <summary>
    /// The modes sounded alike (0.7.1: ±2-3 dB shelves). Every pair of built-in profiles now differs by at least 2.5 dB in
    /// some band (low &lt; 150 Hz, mid, presence 2-5 kHz, high &gt; 4 kHz) on the two-speaker layout, where no mode has surrounds to spread into.
    /// </summary>
    [Fact]
    public void ModesAreAudiblyDistinct()
    {
        var input = ModeChain.Program(Frames);
        var ms = ModeChain.Profiles.Select(p => (p.Name, M: ModeChain.Measure(ModeChain.Run(p, ModeChain.Lr, input)))).ToArray();
        var bands = new[] { ModeChain.Band.Low, ModeChain.Band.Mid, ModeChain.Band.Presence, ModeChain.Band.High };
        for (int i = 0; i < ms.Length; i++)
            for (int j = i + 1; j < ms.Length; j++)
            {
                double d = bands.Max(b => Math.Abs(ms[i].M.Bands[b].Power - ms[j].M.Bands[b].Power));
                _out.WriteLine($"{ms[i].Name} / {ms[j].Name}: en büyük bant farkı {d:0.0} dB");
                Assert.True(d >= 2.5, $"{ms[i].Name} vs {ms[j].Name}: only {d:0.0} dB apart");
            }
    }

    /// <summary>No built-in profile runs the compressor: on hot masters it pumped ("choppy" sound).</summary>
    [Fact]
    public void BuiltinsDoNotCompress()
    {
        foreach (var p in ModeChain.Profiles)
            Assert.True(p.Processing.DynamicBoost == 0, p.Name);
    }

    /// <summary>Program at several levels (input RMS per channel): mid-band power and the loudest speaker peak, vs flat.</summary>
    [Fact]
    public void LevelSweep()
    {
        foreach (var layout in Layouts)
        {
            _out.WriteLine($"-- {layout.Name}: program, fark Düz'e göre (orta bant güç dB / bas / tiz) ve tepe dBFS");
            foreach (double level in new[] { -35.0, -25, -20, -15, -12 })
            {
                var input = ModeChain.Program(Frames, level + 20);
                var flat = ModeChain.Measure(ModeChain.Run(ModeChain.Profiles[0], layout, input));
                var cells = ModeChain.Profiles.Skip(1).Select(p =>
                {
                    var m = ModeChain.Measure(ModeChain.Run(p, layout, input));
                    double D(ModeChain.Band b) => m.Bands[b].Power - flat.Bands[b].Power;
                    return $"{p.Name} {D(ModeChain.Band.Mid),5:+0.0;-0.0} {D(ModeChain.Band.Low),5:+0.0;-0.0} {D(ModeChain.Band.High),5:+0.0;-0.0} tepe {m.SpeakerPeakDb.Max(),5:0.0}";
                });
                _out.WriteLine($"{level,4} dBFS | Düz tepe {flat.SpeakerPeakDb.Max(),5:0.0} | {string.Join(" | ", cells)}");
            }
        }
    }

    /// <summary>Prints the before/after tables (dotnet test --logger "console;verbosity=detailed").</summary>
    [Fact]
    public void Report()
    {
        Table(ModeChain.OldProfiles, "ESKİ PROFİL DEĞERLERİ, YENİ UPMIX");
        Table(ModeChain.Rev3Profiles, "0.7.0 (REV 3)");
        Table(ModeChain.Rev4Profiles, "0.7.1 (REV 4)");
        Table(ModeChain.Profiles, "SONRA");
    }
}
