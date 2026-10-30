namespace Surround.Engine;

/// <summary>Logical channel order follows WAVEFORMATEXTENSIBLE 7.1.</summary>
public static class Channels
{
    public const int Count = 8;
    public const int FL = 0, FR = 1, FC = 2, LFE = 3, BL = 4, BR = 5, SL = 6, SR = 7;

    public static readonly string[] Names = { "FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR" };

    public static int IndexOf(string? name)
    {
        if (name is null) return -1;
        for (int i = 0; i < Names.Length; i++)
            if (string.Equals(Names[i], name, StringComparison.OrdinalIgnoreCase)) return i;
        return -1;
    }

    /// <summary>Maps source channel index to logical channel index for a given source channel count.</summary>
    public static int[] MapForSourceChannels(int n) => n switch
    {
        1 => new[] { FC },
        2 => new[] { FL, FR },
        3 => new[] { FL, FR, FC },
        4 => new[] { FL, FR, BL, BR },
        5 => new[] { FL, FR, FC, BL, BR },
        _ => Enumerable.Range(0, Math.Min(n, Count)).ToArray(),
    };
}
