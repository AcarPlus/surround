using System.Text.Json.Serialization;

namespace Surround.Engine.Calibration;

/// <param name="SpeakerIds">Speakers to measure (config speaker <c>id</c>; the CLI also accepts names).</param>
/// <param name="ReferenceSpeakerId">Timing/level reference; default the first of <paramref name="SpeakerIds"/>.</param>
/// <param name="MicLoopback">Test mode: the "microphone" is the loopback of a render device.</param>
/// <param name="LowBandSpeakerIds">Speakers analysed in the bass band; null = those whose mix row is LFE only.</param>
public sealed record CalibrationRequest(
    string MicDeviceId,
    IReadOnlyList<string> SpeakerIds,
    string? ReferenceSpeakerId = null,
    bool MicLoopback = false,
    int Repeats = 2,
    double LevelDb = -20,
    IReadOnlyList<string>? LowBandSpeakerIds = null)
{
    /// <summary><see cref="MicDeviceId"/> of the phone (external) microphone.</summary>
    public const string PhoneMic = "phone";

    /// <summary>Play with the speakers' delay, gain and roomEq (verify the corrections); results are still reported without them.</summary>
    public bool ApplyCorrections { get; init; }
    /// <summary>Also measure each speaker's frequency response.</summary>
    public bool Responses { get; init; }

    public bool IsPhone => string.Equals(MicDeviceId?.Trim(), PhoneMic, StringComparison.OrdinalIgnoreCase);
}

public static class CalibrationPhase
{
    public const string Preparing = "preparing", Noise = "noise", Measuring = "measuring", Analyzing = "analyzing", Done = "done";
}

/// <param name="Phase">One of <see cref="CalibrationPhase"/>.</param>
/// <param name="Index">Measuring/analyzing: 1-based current step; done: <paramref name="Total"/>; otherwise 0.</param>
/// <param name="Total">Number of measurement steps (repeats × measured speakers).</param>
public sealed record CalibrationProgress(
    string Phase,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? SpeakerId,
    int Index,
    int Total,
    string Message);

/// <param name="ArrivalMs">Relative to the reference (negative = earlier); measured without delayMs/latencyMs compensation.</param>
/// <param name="LevelDb">Relative to the reference; measured without gainDb.</param>
/// <param name="SpreadMs">Max − min of the relative arrival across repeats.</param>
public sealed record SpeakerCalibration(
    string SpeakerId,
    bool Ok,
    double ArrivalMs,
    double LevelDb,
    double SnrDb,
    double SpreadMs,
    bool LowBand,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Message)
{
    /// <summary>Smoothed response (dB, arbitrary common offset) on <see cref="CalibrationResult.ResponseHz"/>; without gainDb and roomEq.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double[]? ResponseDb { get; init; }
    /// <summary>Verification run (corrections applied): arrival relative to the reference as heard now (ms).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? ResidualArrivalMs { get; init; }
    /// <summary>Verification run: level relative to the reference as heard now (dB).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? ResidualLevelDb { get; init; }
}

public sealed record CalibrationResult(
    string ReferenceSpeakerId,
    string MicDeviceId,
    double NoiseFloorDb,
    bool MicClipped,
    IReadOnlyList<SpeakerCalibration> Speakers)
{
    /// <summary>Frequencies (Hz) of <see cref="SpeakerCalibration.ResponseDb"/>; null when responses were not measured.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double[]? ResponseHz { get; init; }
    /// <summary>The run played with the speakers' delay, gain and roomEq (verification).</summary>
    public bool Verified { get; init; }
    /// <summary>Notes about the recording itself (phone: sample rate, clock difference, browser processing).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Note { get; init; }
}

/// <summary>A mono recording made by an external microphone (the phone), in its own sample rate and clock.</summary>
/// <param name="Note">Something to tell the user about the recording (e.g. the browser kept a processing step on).</param>
public sealed record ExternalRecording(float[] Samples, int SampleRate, string? Note = null);

/// <summary>
/// A microphone on another device (see docs/kalibrasyon.md, "Telefonla"). The runner calls <see cref="Begin"/> before the
/// program starts (returns once the remote side records), <see cref="Finish"/> after it ended (returns the upload), or
/// <see cref="Abort"/> when the run failed in between.
/// </summary>
public interface IExternalMicrophone
{
    void Begin(CancellationToken ct);
    ExternalRecording Finish(CancellationToken ct);
    void Abort();
}
