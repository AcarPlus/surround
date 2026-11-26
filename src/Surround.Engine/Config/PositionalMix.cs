using System.Text.Json;

namespace Surround.Engine.Config;

/// <summary>
/// "Konuma göre dağıt" on the engine side: the same rows the page computes (ui/src/lib/positional.ts), for a speaker set
/// the page never sees — the one left when a device is missing (<see cref="Audio.DeviceRecovery.WithoutMissing"/>). Each
/// content channel plays at its standard angle (FL −30°, SR 90° …) and is shared at constant power (sin/cos) between the
/// two nearest real speakers; neighbours more than <see cref="MaxPairSpan"/> apart build no phantom between them. Subs,
/// muted speakers and speakers on the listener keep their own row. Keep in step with positional.ts.
/// </summary>
public static class PositionalMix
{
    public const double MaxPairSpan = 120;
    private const double SameDir = 1;
    private const double MinDistanceM = 0.05;

    private static readonly (string Ch, double Deg)[] FloorNominal =
    {
        ("BL", -150), ("SL", -90), ("FL", -30), ("FC", 0), ("FR", 30), ("SR", 90), ("BR", 150),
    };

    private static readonly (string Ch, double Deg)[] HeightNominal =
    {
        ("TBL", -135), ("TFL", -45), ("TFR", 45), ("TBR", 135),
    };

    /// <summary>True when the page saved the config with "Konuma göre dağıt" on.</summary>
    public static bool IsOn(SurroundConfig cfg) =>
        cfg.Extra is { } x && x.TryGetValue("positionalMix", out var v) && v.ValueKind == JsonValueKind.True;

    /// <summary>
    /// Recomputes the rows of <paramref name="speakers"/> in place from their room positions. False (nothing changed) when
    /// the listener or a taking-part speaker's position is unknown: the caller then keeps its own fallback.
    /// </summary>
    public static bool Apply(SurroundConfig cfg, IList<SpeakerConfig> speakers)
    {
        if (!TryListener(cfg, out var lx, out var ly)) return false;
        var eligible = new List<(SpeakerConfig S, double Deg, bool Elevated)>();
        foreach (var s in speakers)
        {
            if (s.Mute || IsSub(s)) continue;
            if (!TryNumber(s.Extra, "x", out var x) || !TryNumber(s.Extra, "y", out var y)) return false;
            if (Math.Sqrt((x - lx) * (x - lx) + (y - ly) * (y - ly)) < MinDistanceM) continue;
            bool elevated = s.Extra!.TryGetValue("elevated", out var e) && e.ValueKind == JsonValueKind.True;
            eligible.Add((s, Angle(x - lx, y - ly), elevated));
        }
        var rows = eligible.ToDictionary(e => e.S, _ => new Dictionary<string, double>());
        Ring(Directions(eligible.Where(e => !e.Elevated)), FloorNominal, rows);
        Ring(Directions(eligible.Where(e => e.Elevated)), HeightNominal, rows);
        // A speaker no channel falls on (squeezed between two others) keeps its row: the engine rejects an empty one.
        foreach (var (s, row) in rows)
            if (row.Count > 0) s.Source = row;
        return true;
    }

    private static bool IsSub(SpeakerConfig s)
    {
        if (s.Extra is { } x && x.TryGetValue("role", out var r) && r.ValueKind == JsonValueKind.String)
            return r.GetString() == "sub";
        return s.Source.Count == 1 && s.Source.TryGetValue("LFE", out var v) && v == 1;
    }

    private static bool TryListener(SurroundConfig cfg, out double x, out double y)
    {
        x = y = 0;
        if (cfg.Extra is null || !cfg.Extra.TryGetValue("room", out var room) || room.ValueKind != JsonValueKind.Object) return false;
        if (!room.TryGetProperty("listener", out var l) || l.ValueKind != JsonValueKind.Object) return false;
        return l.TryGetProperty("x", out var px) && px.TryGetDouble(out x) && double.IsFinite(x)
            && l.TryGetProperty("y", out var py) && py.TryGetDouble(out y) && double.IsFinite(y);
    }

    private static bool TryNumber(Dictionary<string, JsonElement>? extra, string key, out double v)
    {
        v = 0;
        return extra is not null && extra.TryGetValue(key, out var e) && e.ValueKind == JsonValueKind.Number
            && e.TryGetDouble(out v) && double.IsFinite(v);
    }

    /// <summary>0° = front (y decreases), + = right (x increases); (−180, 180].</summary>
    private static double Angle(double dx, double dy) =>
        Math.Abs(dx) < 1e-9 && Math.Abs(dy) < 1e-9 ? 0 : Normalize(Math.Atan2(dx, -dy) * 180 / Math.PI);

    private static double Normalize(double deg)
    {
        double a = deg % 360;
        if (a > 180) a -= 360;
        if (a <= -180) a += 360;
        return a;
    }

    /// <summary>Clockwise angle from a to b (0..360).</summary>
    private static double Cw(double a, double b)
    {
        double d = (b - a) % 360;
        return d < 0 ? d + 360 : d;
    }

    private static double R3(double v) => Math.Round(v * 1000, MidpointRounding.AwayFromZero) / 1000;

    private sealed record Dir(double Deg, List<SpeakerConfig> Speakers);

    private static List<Dir> Directions(IEnumerable<(SpeakerConfig S, double Deg, bool Elevated)> list)
    {
        var outList = new List<Dir>();
        foreach (var (s, deg, _) in list.OrderBy(e => e.Deg))
        {
            if (outList.Count > 0 && Math.Abs(Normalize(deg - outList[^1].Deg)) < SameDir) outList[^1].Speakers.Add(s);
            else outList.Add(new Dir(deg, new() { s }));
        }
        if (outList.Count > 1 && Math.Abs(Normalize(outList[0].Deg - outList[^1].Deg)) < SameDir)
        {
            outList[0].Speakers.AddRange(outList[^1].Speakers);
            outList.RemoveAt(outList.Count - 1);
        }
        return outList;
    }

    private static void Ring(List<Dir> dirs, (string Ch, double Deg)[] nominal, Dictionary<SpeakerConfig, Dictionary<string, double>> rows)
    {
        if (dirs.Count == 0) return;
        void Add(Dir d, string ch, double g)
        {
            // n speakers in one direction: each g/√n (power kept).
            double share = g / Math.Sqrt(d.Speakers.Count);
            foreach (var s in d.Speakers)
            {
                var row = rows[s];
                double v = R3(row.GetValueOrDefault(ch) + share);
                if (v > 0) row[ch] = v;
            }
        }
        foreach (var (ch, deg) in nominal)
        {
            if (dirs.Count == 1) { Add(dirs[0], ch, 1); continue; }
            var b = dirs.Aggregate((p, d) => Cw(deg, d.Deg) < Cw(deg, p.Deg) ? d : p);
            var a = dirs.Aggregate((p, d) => Cw(d.Deg, deg) < Cw(p.Deg, deg) ? d : p);
            if (Math.Abs(Normalize(b.Deg - deg)) < SameDir) { Add(b, ch, 1); continue; }
            if (Math.Abs(Normalize(a.Deg - deg)) < SameDir) { Add(a, ch, 1); continue; }
            double span = Cw(a.Deg, b.Deg), off = Cw(a.Deg, deg);
            if (span > MaxPairSpan) { Add(off <= span - off ? a : b, ch, 1); continue; }
            double t = off / span;
            Add(a, ch, Math.Cos(t * Math.PI / 2));
            Add(b, ch, Math.Sin(t * Math.PI / 2));
        }
    }
}
