using System.Text.Json;
using System.Text.Json.Serialization;

namespace Surround.Engine.Config;

public sealed class SourceConfig
{
    public string DeviceId { get; set; } = "";
    /// <summary>Friendly name last seen for <see cref="DeviceId"/> (shown while the device is absent); the engine ignores it.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DeviceName { get; set; }
    /// <summary>"loopback" or "capture".</summary>
    public string Mode { get; set; } = "loopback";

    /// <summary>Unknown JSON members (UI-only data such as room layout) preserved across load/save; the engine ignores them.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class OutputConfig
{
    public string DeviceId { get; set; } = "";
    /// <summary>Friendly name last seen for <see cref="DeviceId"/> (shown while the device is absent); the engine ignores it.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DeviceName { get; set; }
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
    /// <summary>Mix row: logical channel name (FL, FR, FC, LFE, BL, BR, SL, SR, TFL, TFR, TBL, TBR) to linear gain.</summary>
    public Dictionary<string, double> Source { get; set; } = new();
    public double DelayMs { get; set; }
    public double GainDb { get; set; }
    public bool Mute { get; set; }

    /// <summary>Per-speaker 10-band EQ in dB (same bands as <see cref="ProcessingConfig.Eq"/>); null = flat. Live-updatable.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double[]? Eq { get; set; }
    /// <summary>UI label only; the engine ignores it.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? EqPreset { get; set; }
    /// <summary>Per-speaker parametric bands (max 6), applied after the 10-band EQ; null = none. Live-updatable.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<PeqBand>? Peq { get; set; }
    /// <summary>
    /// Automatic room/match correction from the microphone calibration (max <see cref="PeqBand.MaxRoomBands"/>), applied
    /// after <see cref="Peq"/>; kept apart from the user's own EQ. null = none. Live-updatable.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<PeqBand>? RoomEq { get; set; }
    /// <summary>0 = full range; 40..250 = LR4 high-pass, the cut bass goes to the bass receivers.</summary>
    public double HighPassHz { get; set; }
    /// <summary>Receives the bass cut from high-passed speakers (and LFE from a native multichannel source).</summary>
    public bool BassReceiver { get; set; }

    /// <summary>Unknown JSON members (UI-only data such as room layout) preserved across load/save; the engine ignores them.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

/// <summary>One parametric EQ band (RBJ biquad). Applied after the 10-band EQ; live-updatable.</summary>
public sealed class PeqBand
{
    public const int MaxBands = 6;
    /// <summary>Bands of a speaker's automatic correction (<see cref="SpeakerConfig.RoomEq"/>).</summary>
    public const int MaxRoomBands = 8;
    public const string Peak = "peak", LowShelf = "lowShelf", HighShelf = "highShelf";
    public const double MinFreqHz = 20, MaxFreqHz = 20000, MaxGainDb = 12, MinQ = 0.3, MaxQ = 10;

    /// <summary>"peak", "lowShelf" or "highShelf".</summary>
    public string Type { get; set; } = Peak;
    public double FreqHz { get; set; } = 1000;
    public double GainDb { get; set; }
    public double Q { get; set; } = 1;
    /// <summary>false = band is kept in the config but not applied.</summary>
    public bool Enabled { get; set; } = true;

    public static bool IsKnownType(string? t) => t is Peak or LowShelf or HighShelf;

    /// <summary>Unknown JSON members (UI-only data such as an id) preserved across load/save; the engine ignores them.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

/// <summary>Global sound processing on the logical channels, plus the per-output limiter switch. Live-updatable.</summary>
public sealed class ProcessingConfig
{
    public const int Bands = 10;
    /// <summary>Center frequencies of the 10 EQ bands (Hz). Ends are shelves, the rest peaking.</summary>
    public static readonly double[] BandHz = { 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };

    /// <summary>false skips the global processing (the limiter still runs).</summary>
    public bool Enabled { get; set; } = true;
    /// <summary>UI label only; the engine ignores it.</summary>
    public string Preset { get; set; } = "flat";
    public double PreampDb { get; set; }
    private double[] _eq = new double[Bands];
    public double[] Eq { get => _eq; set => _eq = value ?? new double[Bands]; }
    /// <summary>
    /// true: the effective preamp is -max(0, peak of the combined 10-band + bass + clarity + peq response, dB) instead of
    /// <see cref="PreampDb"/> (see <see cref="Dsp.FrequencyResponse.AutoPreampDb"/>). Absent in old configs = false.
    /// </summary>
    public bool AutoPreamp { get; set; }
    /// <summary>Parametric bands (max 6), applied after the 10-band EQ; null = none.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<PeqBand>? Peq { get; set; }
    public double BassBoostDb { get; set; }
    public double ClarityDb { get; set; }
    /// <summary>0..1: compression amount with automatic makeup gain.</summary>
    public double DynamicBoost { get; set; }
    /// <summary>0..1: M/S widening of the FL/FR, BL/BR, SL/SR, TFL/TFR and TBL/TBR pairs.</summary>
    public double Ambience { get; set; }
    /// <summary>Peak limiter (-1 dBFS ceiling) on every output device.</summary>
    public bool Limiter { get; set; } = true;

    /// <summary>Unknown JSON members preserved across load/save; the engine ignores them.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

/// <summary>
/// Stereo to 7.1 (plus height lanes) upmix settings (used when <see cref="SurroundConfig.Upmix"/> is on). The gains and the LFE switch are
/// live-updatable (the height level also applies to the heights derived from native multichannel content); a mode
/// change restarts the engine.
/// </summary>
public sealed class UpmixOptions
{
    public const string Game = "game", Film = "film", Direct = "direct";
    public const double MinDb = -12, MaxDb = 6;
    public const double MinHeightDb = -24, MaxHeightDb = 6, DefaultHeightDb = -3;

    /// <summary>
    /// "game" (time-domain matrix decoder, no added front latency), "film" (STFT, ~21 ms at 48 kHz) or "direct" (flat: plain
    /// copies of L/R and their mono sum, no processing; see <see cref="Dsp.DirectUpmixer"/>).
    /// </summary>
    public string Mode { get; set; } = Film;
    /// <summary>Level of the extracted center (dialog), dB.</summary>
    public double CenterDb { get; set; }
    /// <summary>Level of everything steered or spread to the side/back channels, dB.</summary>
    public double SurroundDb { get; set; }
    /// <summary>Derive LFE from the low-passed mid (heard only on speakers whose row maps LFE).</summary>
    public bool LfeEnabled { get; set; } = true;
    /// <summary>
    /// Level of the derived height lanes (TFL/TFR/TBL/TBR), dB. Additive: at 0 dB the height lanes of one side together
    /// carry as much power as that side's ambience. Only matters when some speaker maps a height lane.
    /// </summary>
    public double HeightDb { get; set; } = DefaultHeightDb;

    public const double DefaultSurroundDelayMs = 10, MaxSurroundDelayMs = 25;
    public const double MinHighCutHz = 3000, MaxHighCutHz = 16000;
    public const double DefaultDiffusion = 1;
    /// <summary>Extra delay of the side/back channels produced by the upmix (precedence), ms, 0..25. Live.</summary>
    public double SurroundDelayMs { get; set; } = DefaultSurroundDelayMs;
    /// <summary>0 = off, else 3000..16000 Hz: gentle 2nd-order low-pass on the side/back channels produced by the upmix. Live.</summary>
    public double SurroundHighCutHz { get; set; }
    /// <summary>0..1: how much of the side/back ambience is all-pass decorrelated (1 = original behaviour; 0 = dry, direct). Live.</summary>
    public double Diffusion { get; set; } = DefaultDiffusion;

    public bool IsGame => string.Equals(Mode?.Trim(), Game, StringComparison.OrdinalIgnoreCase);
    public bool IsDirect => string.Equals(Mode?.Trim(), Direct, StringComparison.OrdinalIgnoreCase);

    /// <summary>Unknown JSON members preserved across load/save; the engine ignores them.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class SurroundConfig
{
    public SourceConfig Source { get; set; } = new();
    /// <summary>On/off switch of the upmix; details in <see cref="UpmixOptions"/>.</summary>
    public bool Upmix { get; set; }
    private UpmixOptions _upmixOptions = new();
    public UpmixOptions UpmixOptions { get => _upmixOptions; set => _upmixOptions = value ?? new(); }
    private ProcessingConfig _processing = new();
    public ProcessingConfig Processing { get => _processing; set => _processing = value ?? new(); }
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
        // Lenient: "deviceChannel": "2" is read as 2 instead of discarding the whole file.
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    public static SurroundConfig Parse(string json)
    {
        var cfg = JsonSerializer.Deserialize<SurroundConfig>(json, Options)
            ?? throw new JsonException("Empty config.");
        cfg.NormalizeNulls();
        return cfg;
    }

    /// <summary>
    /// Valid-but-null JSON (<c>"speakers": null</c>, <c>[null]</c>, <c>"source": null</c> …) must not crash later code:
    /// null items are dropped, null objects/strings get their defaults.
    /// </summary>
    public void NormalizeNulls()
    {
        Source ??= new();
        Source.DeviceId ??= "";
        Source.Mode ??= "loopback";
        Outputs = (Outputs ?? new()).Where(o => o is not null).ToList();
        foreach (var o in Outputs) o.DeviceId ??= "";
        Speakers = (Speakers ?? new()).Where(s => s is not null).ToList();
        foreach (var s in Speakers)
        {
            s.Name ??= "";
            s.OutputDeviceId ??= "";
            s.Source ??= new();
            s.Peq = DropNullBands(s.Peq);
            s.RoomEq = DropNullBands(s.RoomEq);
        }
        Processing.Peq = DropNullBands(Processing.Peq);
        UpmixOptions.Mode ??= UpmixOptions.Film;
        Processing.Preset ??= "flat";
    }

    private static List<PeqBand>? DropNullBands(List<PeqBand>? l) => l?.Where(b => b is not null).ToList();

    public static SurroundConfig Load(string path) => Parse(File.ReadAllText(path));

    public string ToJson() => JsonSerializer.Serialize(this, Options);

    /// <summary>
    /// Canonical JSON of the engine-relevant fields only (extra/UI members dropped). Two configs with the same
    /// fingerprint produce an identical audio graph, so a running engine need not restart between them.
    /// Processing, per-speaker EQ, the upmix gains (center/surround/height)/LFE switch and the speakers' mix rows, gains and
    /// delays (and the outputs' latencies, which only shift those delays) are excluded: <see cref="SurroundEngine.UpdateLive"/>
    /// applies them in place, so dragging a speaker on the room map never restarts the engine. What the graph is built
    /// from stays: the set of logical channels the (unmuted, routed) speakers use (upmix layout, channel fold), which
    /// side/back channels are shared, and per speaker whether its row carries LFE (bass management). The upmix mode and
    /// which shared channels are silent (they depend on the row weights) are swapped live too (crossfade, see
    /// <see cref="Dsp.AdaptiveUpmix.SwapUpmixer"/>).
    /// </summary>
    public string EngineFingerprint()
    {
        var copy = Parse(ToJson());
        var used = new SortedSet<int>();
        foreach (var s in copy.ForRouting().Speakers.Where(s => !s.Mute))
            foreach (var (k, v) in s.Source)
            {
                int c = Channels.IndexOf(k);
                if (c >= 0 && (float)v != 0f) used.Add(c);
            }
        // Which side/back channels only share a speaker with a front decides how the decoders fill them (UpmixLayout.Shared).
        var rows = copy.ForRouting().Speakers.Where(s => !s.Mute).Select(s =>
        {
            var r = new float[Channels.Count];
            foreach (var (k, v) in s.Source) { int c = Channels.IndexOf(k); if (c >= 0) r[c] = (float)v; }
            return r;
        });
        var upLayout = Dsp.UpmixLayout.ForSpeakers(rows);
        var shared = Enumerable.Range(0, Channels.Count).Where(upLayout.Shared).Select(c => Channels.Names[c]).ToArray();
        copy.Extra = new()
        {
            ["usedChannels"] = JsonSerializer.SerializeToElement(used.Select(c => Channels.Names[c]).ToArray()),
            ["sharedChannels"] = JsonSerializer.SerializeToElement(shared),
        };
        copy.Processing = new();
        // The upmix mode is not part of it: SurroundEngine.UpdateLive swaps the upmixer with a crossfade.
        copy.UpmixOptions = new();
        copy.Source.Extra = null;
        copy.Source.DeviceName = null;
        foreach (var o in copy.Outputs) { o.Extra = null; o.DeviceName = null; o.LatencyMs = 0; }
        foreach (var s in copy.Speakers)
        {
            bool lfe = s.Source.Any(kv => Channels.IndexOf(kv.Key) == Channels.LFE && (float)kv.Value != 0f);
            s.Source = lfe ? new() { ["LFE"] = 1 } : new();
            s.DelayMs = 0; s.GainDb = 0;
            s.Extra = null; s.Name = ""; s.Eq = null; s.EqPreset = null; s.Peq = null; s.RoomEq = null;
        }
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

    /// <summary>
    /// Effective delay in ms for a speaker: alignment of the output's total delay (device latency + jitter buffer,
    /// both really heard) to the slowest output, plus the user delay. Changing an output's buffer therefore does not
    /// shift that speaker against the others.
    /// </summary>
    public double EffectiveDelayMs(SpeakerConfig speaker)
    {
        static double Total(OutputConfig o) => o.LatencyMs + (o.BufferMs > 0 ? o.BufferMs : 0);
        double max = Outputs.Count == 0 ? 0 : Outputs.Max(Total);
        var own = Outputs.FirstOrDefault(o => SameId(o.DeviceId, speaker.OutputDeviceId));
        return (max - (own is null ? 0 : Total(own))) + speaker.DelayMs;
    }

    public static bool SameId(string? a, string? b) =>
        string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
}
