namespace Surround.Engine.Dsp;

/// <summary>
/// "Flat" stereo distribution: no decoding, filtering, decorrelation or delay, every playing speaker gets the original
/// signal. FL/FR pass through; the center gets the plain mono sum (L+R)/2; left side/back/height lanes copy L, right
/// ones copy R; LFE stays silent (bass management still feeds the bass receivers). Only channels some speaker plays are
/// written, so the channel fold never adds a copy on top of a front (+6 dB), and not the side/back channels that only
/// land on speakers already playing a front (<see cref="UpmixLayout.Silent"/>; "distribute by position" with fronts only). Native multichannel content is untouched
/// (<see cref="AdaptiveUpmix"/> only calls this while the source is stereo).
/// </summary>
public sealed class DirectUpmixer : IStereoUpmixer
{
    private const int Ch = Channels.Count;
    private static readonly int[] LeftCopies = { Channels.SL, Channels.BL, Channels.TFL, Channels.TBL };
    private static readonly int[] RightCopies = { Channels.SR, Channels.BR, Channels.TFR, Channels.TBR };
    private readonly bool _center;
    private readonly int[] _left, _right;

    public DirectUpmixer(UpmixLayout? layout = null)
    {
        layout ??= UpmixLayout.Full;
        _center = layout.Has(Channels.FC);
        _left = LeftCopies.Where(c => layout.Has(c) && !layout.Silent(c)).ToArray();
        _right = RightCopies.Where(c => layout.Has(c) && !layout.Silent(c)).ToArray();
    }

    public int LatencyFrames => 0;

    /// <summary>Levels are not adjustable in the flat mode (unity everywhere).</summary>
    public void Update(UpmixSettings settings) { }

    public void Process(ReadOnlySpan<float> input, Span<float> output, int frames)
    {
        output[..(frames * Ch)].Clear();
        for (int f = 0; f < frames; f++)
        {
            int b = f * Ch;
            float l = input[b + Channels.FL], r = input[b + Channels.FR];
            output[b + Channels.FL] = l;
            output[b + Channels.FR] = r;
            if (_center) output[b + Channels.FC] = 0.5f * (l + r);
            foreach (int c in _left) output[b + c] = l;
            foreach (int c in _right) output[b + c] = r;
        }
    }
}
