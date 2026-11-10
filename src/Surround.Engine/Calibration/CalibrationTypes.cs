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
    IReadOnlyList<string>? LowBandSpeakerIds = null);

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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Message);

public sealed record CalibrationResult(
    string ReferenceSpeakerId,
    string MicDeviceId,
    double NoiseFloorDb,
    bool MicClipped,
    IReadOnlyList<SpeakerCalibration> Speakers);
