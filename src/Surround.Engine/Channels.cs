namespace Surround.Engine;

/// <summary>
/// Logical channel order: the first 8 follow WAVEFORMATEXTENSIBLE 7.1 (what sources deliver), then 4 height lanes
/// (top front/back left/right) that are always derived by the engine (see docs/duzen.md).
/// </summary>
public static class Channels
{
    public const int Count = 12;
    /// <summary>Channels a source can deliver (7.1); the height lanes start here.</summary>
    public const int SourceCount = 8;
    public const int FL = 0, FR = 1, FC = 2, LFE = 3, BL = 4, BR = 5, SL = 6, SR = 7;
    public const int TFL = 8, TFR = 9, TBL = 10, TBR = 11;

    public static readonly string[] Names = { "FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR", "TFL", "TFR", "TBL", "TBR" };

    public static bool IsHeight(int channel) => channel >= SourceCount && channel < Count;

    public static int IndexOf(string? name)
    {
        if (name is null) return -1;
        for (int i = 0; i < Names.Length; i++)
            if (string.Equals(Names[i], name, StringComparison.OrdinalIgnoreCase)) return i;
        return -1;
    }

    /// <summary>
    /// Maps source channel index to logical channel index for a given source channel count. Sources never feed the
    /// height lanes; beyond 8 channels the first 8 are taken as 7.1.
    /// </summary>
    public static int[] MapForSourceChannels(int n) => n switch
    {
        1 => new[] { FC },
        2 => new[] { FL, FR },
        3 => new[] { FL, FR, FC },
        4 => new[] { FL, FR, BL, BR },
        5 => new[] { FL, FR, FC, BL, BR },
        _ => Enumerable.Range(0, Math.Min(n, SourceCount)).ToArray(),
    };
}
