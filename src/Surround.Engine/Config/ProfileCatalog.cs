using System.Text.Json;

namespace Surround.Engine.Config;

/// <summary>A sound profile as listed in the tray menu.</summary>
public sealed record ProfileEntry(string Id, string Name);

/// <summary>
/// Reads and applies the UI's sound profiles (config members <c>profiles</c> and <c>activeProfileId</c>, kept in
/// <see cref="SurroundConfig.Extra"/>). A profile carries <c>processing</c>, <c>upmix</c> and <c>upmixOptions</c>;
/// applying it copies those into the config, exactly like the UI's <c>selectProfile</c>.
/// </summary>
public static class ProfileCatalog
{
    private const int MaxName = 24;

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>Valid profiles in stored order (malformed entries and duplicate ids skipped).</summary>
    public static List<ProfileEntry> List(SurroundConfig cfg)
    {
        var list = new List<ProfileEntry>();
        var seen = new HashSet<string>();
        if (cfg.Extra is null || !cfg.Extra.TryGetValue("profiles", out var arr) || arr.ValueKind != JsonValueKind.Array) return list;
        foreach (var p in arr.EnumerateArray())
        {
            if (p.ValueKind != JsonValueKind.Object) continue;
            var id = Str(p, "id");
            var name = Str(p, "name")?.Trim();
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(name) || !seen.Add(id)) continue;
            if (name.Length > MaxName) name = name[..MaxName].Trim();
            list.Add(new ProfileEntry(id, name));
        }
        return list;
    }

    /// <summary>The selected profile's id, or null (none selected, or it no longer exists).</summary>
    public static string? ActiveId(SurroundConfig cfg)
    {
        if (cfg.Extra is null || !cfg.Extra.TryGetValue("activeProfileId", out var v) || v.ValueKind != JsonValueKind.String) return null;
        var id = v.GetString();
        return List(cfg).Any(p => p.Id == id) ? id : null;
    }

    /// <summary>
    /// Copies the profile's settings into <paramref name="cfg"/> and marks it active. Members the profile lacks keep
    /// their current value. Returns false (config untouched) when the id is unknown.
    /// </summary>
    public static bool Apply(SurroundConfig cfg, string id)
    {
        if (cfg.Extra is null || !cfg.Extra.TryGetValue("profiles", out var arr) || arr.ValueKind != JsonValueKind.Array) return false;
        JsonElement? found = null;
        foreach (var p in arr.EnumerateArray())
            if (p.ValueKind == JsonValueKind.Object && Str(p, "id") == id && !string.IsNullOrWhiteSpace(Str(p, "name"))) { found = p; break; }
        if (found is not { } prof) return false;

        ProcessingConfig? processing = null;
        UpmixOptions? upmixOptions = null;
        try
        {
            if (prof.TryGetProperty("processing", out var pr) && pr.ValueKind == JsonValueKind.Object)
                processing = pr.Deserialize<ProcessingConfig>(Options);
            if (prof.TryGetProperty("upmixOptions", out var uo) && uo.ValueKind == JsonValueKind.Object)
                upmixOptions = uo.Deserialize<UpmixOptions>(Options);
        }
        catch (JsonException) { return false; } // a broken profile is not applied half-way

        if (processing is not null)
        {
            var eq = new double[ProcessingConfig.Bands];
            for (int i = 0; i < eq.Length && i < processing.Eq.Length; i++) eq[i] = processing.Eq[i];
            processing.Eq = eq;
            cfg.Processing = processing;
        }
        if (upmixOptions is not null) cfg.UpmixOptions = upmixOptions;
        if (prof.TryGetProperty("upmix", out var up) && up.ValueKind is JsonValueKind.True or JsonValueKind.False) cfg.Upmix = up.GetBoolean();
        cfg.Extra["activeProfileId"] = JsonSerializer.SerializeToElement(id);
        return true;
    }

    private static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
