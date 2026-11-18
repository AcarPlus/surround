namespace Surround.Engine.Calibration;

/// <param name="Id">Speaker id as reported in the result.</param>
/// <param name="LowBand">Analysed in the bass band (subwoofer).</param>
/// <param name="Sink">Index of the output sink that plays it (for fill compensation); -1 when unknown.</param>
public sealed record CalibrationSpeaker(string Id, bool LowBand, int Sink = -1);

/// <summary>One measurement: the reference sweep at <see cref="StartFrame"/>, the test speaker's sweep one offset later.</summary>
public sealed record CalibrationStep(int Test, int Repeat, long StartFrame);

/// <summary>
/// The test program, in program-rate frames: warm-up, a silent noise window, then one step per (repeat, test speaker).
/// Each step plays the reference speaker's sweep and, <see cref="OffsetFrames"/> later, the test speaker's sweep, so
/// the analysis only uses arrival differences within a step (start-time uncertainty and slow drift cancel).
/// Speaker i plays on logical lane i (see <see cref="Render"/>).
/// </summary>
public sealed class CalibrationPlan
{
    public const double WarmupSec = 1.0, NoiseSec = 1.2, OffsetSec = 1.0, StepSec = 2.4, TailSec = 0.4;
    /// <summary>Largest output + capture latency an arrival may have after its sweep was pushed.</summary>
    public const double MaxLatencySec = 0.6;
    public const int MaxSpeakers = Channels.Count;

    private readonly float[] _sweep;

    /// <param name="closingReference">
    /// Play the reference once more after the last step (external microphone): every step is then framed by two reference
    /// sweeps, so a gap in the recording inside a step shows up as a wrong spacing between them (<see cref="ExternalAlignment"/>).
    /// </param>
    public CalibrationPlan(int rate, IReadOnlyList<CalibrationSpeaker> speakers, int reference, int repeats, double levelDb,
        bool closingReference = false)
    {
        if (speakers.Count == 0) throw new ArgumentException("No speakers.", nameof(speakers));
        if (speakers.Count > MaxSpeakers) throw new ArgumentException($"At most {MaxSpeakers} speakers.", nameof(speakers));
        if (reference < 0 || reference >= speakers.Count) throw new ArgumentOutOfRangeException(nameof(reference));
        Rate = rate;
        Speakers = speakers;
        Reference = reference;
        Repeats = Math.Max(1, repeats);
        Amplitude = Math.Pow(10, levelDb / 20);
        Sweep = SweepSignal.ForRate(rate);
        _sweep = Sweep.Render(rate, Amplitude);

        NoiseStartFrame = Frames(WarmupSec);
        NoiseFrames = Frames(NoiseSec);
        OffsetFrames = Frames(OffsetSec);
        long stepFrames = Frames(StepSec);
        var tests = Enumerable.Range(0, speakers.Count).Where(i => i != reference).ToList();
        if (tests.Count == 0) tests.Add(reference); // only the reference: measure it against itself (SNR check)
        var steps = new List<CalibrationStep>();
        long t = NoiseStartFrame + NoiseFrames;
        // Repeat-major order spreads each speaker's repeats over the run (slow changes show up as spread).
        for (int r = 0; r < Repeats; r++)
            foreach (int s in tests) { steps.Add(new CalibrationStep(s, r, t)); t += stepFrames; }
        Steps = steps;
        if (closingReference) { ClosingFrame = t; t += OffsetFrames; }
        TotalFrames = t + Frames(TailSec);
    }

    public int Rate { get; }
    public IReadOnlyList<CalibrationSpeaker> Speakers { get; }
    public int Reference { get; }
    public int Repeats { get; }
    public double Amplitude { get; }
    public SweepSignal Sweep { get; }
    public IReadOnlyList<CalibrationStep> Steps { get; }
    public long NoiseStartFrame { get; }
    public long NoiseFrames { get; }
    public long OffsetFrames { get; }
    /// <summary>Start of the closing reference sweep after the last step; null when the plan has none.</summary>
    public long? ClosingFrame { get; }
    public long TotalFrames { get; }

    public double Seconds => TotalFrames / (double)Rate;

    private long Frames(double sec) => (long)Math.Round(sec * Rate);

    /// <summary>
    /// Adds the program for frames [<paramref name="start"/>, start + <paramref name="frames"/>) into
    /// <paramref name="dest"/> (interleaved, <paramref name="stride"/> lanes per frame, speaker i on lane i). The caller
    /// clears <paramref name="dest"/>.
    /// </summary>
    public void Render(long start, int frames, Span<float> dest, int stride)
    {
        long end = start + frames;
        foreach (var st in Steps)
        {
            AddSweep(st.StartFrame, Reference, start, end, dest, stride);
            AddSweep(st.StartFrame + OffsetFrames, st.Test, start, end, dest, stride);
        }
        if (ClosingFrame is { } c) AddSweep(c, Reference, start, end, dest, stride);
    }

    private void AddSweep(long at, int lane, long start, long end, Span<float> dest, int stride)
    {
        long from = Math.Max(at, start), to = Math.Min(at + _sweep.Length, end);
        for (long p = from; p < to; p++) dest[(int)(p - start) * stride + lane] += _sweep[p - at];
    }
}
