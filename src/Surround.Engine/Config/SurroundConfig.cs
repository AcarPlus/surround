using System.Text.Json;
using System.Text.Json.Serialization;

namespace Surround.Engine.Config;

public sealed class SourceConfig
{
    public string DeviceId { get; set; } = "";
    /// <summary>"loopback" or "capture".</summary>
    public string Mode { get; set; } = "loopback";

    /// <summary>Unknown JSON members (UI-only data such as room layout) preserved across load/save; the engine ignores them.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class OutputConfig
{
    public string DeviceId { get; set; } = "";
    public double LatencyMs { get; set; }
    public double BufferMs { get; set; } = 40;

    /// <summary>Unknown JSON members (UI-only data such as room layout) preserved across load/save; the engine ignores them.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class SpeakerConfig
{
    public string Name { get; set; } = "";
    public string OutputDeviceId { get; set; } = "";
    /// <summary>1-based channel index on the output device.</summary>
    public int DeviceChannel { get; set; } = 1;
    /// <summary>Mix row: logical channel name (FL, FR, FC, LFE, BL, BR, SL, SR) to linear gain.</summary>
    public Dictionary<string, double> Source { get; set; } = new();
    public double DelayMs { get; set; }
    public double GainDb { get; set; }
    public bool Mute { get; set; }

    /// <summary>Unknown JSON members (UI-only data such as room layout) preserved across load/save; the engine ignores them.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class SurroundConfig
{
    public SourceConfig Source { get; set; } = new();
    public bool Upmix { get; set; }
    public List<OutputConfig> Outputs { get; set; } = new();
    public List<SpeakerConfig> Speakers { get; set; } = new();

    /// <summary>Unknown JSON members (UI-only data such as room layout) preserved across load/save; the engine ignores them.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static SurroundConfig Parse(string json) =>
        JsonSerializer.Deserialize<SurroundConfig>(json, Options)
        ?? throw new JsonException("Empty config.");

    public static SurroundConfig Load(string path) => Parse(File.ReadAllText(path));

    public string ToJson() => JsonSerializer.Serialize(this, Options);

    /// <summary>
    /// Canonical JSON of the engine-relevant fields only (extra/UI members dropped). Two configs with the same
    /// fingerprint produce an identical audio graph, so a running engine need not restart between them.
    /// </summary>
    public string EngineFingerprint()
    {
        var copy = Parse(ToJson());
        copy.Extra = null;
        copy.Source.Extra = null;
        foreach (var o in copy.Outputs) o.Extra = null;
        foreach (var s in copy.Speakers) { s.Extra = null; s.Name = ""; }
        return copy.ToJson();
    }

    /// <summary>
    /// Copy the engine actually routes: in loopback mode speakers on the source device are dropped (Windows already
    /// plays them directly), and outputs no remaining speaker uses are dropped (stale entries left by the UI).
    /// </summary>
    public SurroundConfig ForRouting(Action<string>? log = null)
    {
        var copy = Parse(ToJson());
        if (string.Equals(copy.Source.Mode?.Trim(), "loopback", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var s in copy.Speakers.Where(s => SameId(s.OutputDeviceId, copy.Source.DeviceId)))
                log?.Invoke($"'{s.Name}': kaynak cihazda, Windows doğrudan çalıyor; yönlendirilmedi.");
            copy.Speakers.RemoveAll(s => SameId(s.OutputDeviceId, copy.Source.DeviceId));
        }
        copy.Outputs.RemoveAll(o => !copy.Speakers.Any(s => SameId(s.OutputDeviceId, o.DeviceId)));
        return copy;
    }

    /// <summary>Effective delay in ms for a speaker: output latency compensation + user delay.</summary>
    public double EffectiveDelayMs(SpeakerConfig speaker)
    {
        double maxLatency = Outputs.Count == 0 ? 0 : Outputs.Max(o => o.LatencyMs);
        var own = Outputs.FirstOrDefault(o => SameId(o.DeviceId, speaker.OutputDeviceId));
        return (maxLatency - (own?.LatencyMs ?? 0)) + speaker.DelayMs;
    }

    public static bool SameId(string? a, string? b) =>
        string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
}
