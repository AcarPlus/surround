namespace Surround.Engine.Dsp;

/// <summary>One speaker's route inside a sink: mix row, gain, device channel (0-based) and delay.</summary>
public sealed record SpeakerRoute(string Name, int DeviceChannel, float[] MixRow, double GainDb, bool Mute, int DelaySamples);

/// <summary>
/// Builds device-channel frames from logical 7.1 frames (mix rows x gain, per-speaker delay)
/// and pushes them into the sink's ring buffer. Producer side only.
/// </summary>
public sealed class SinkMixer
{
    private readonly int _devCh;
    private readonly int[][] _idx;
    private readonly float[][] _coef;
    private readonly int[] _outCh;
    private readonly DelayLine[] _delay;
    private float[] _scratch = new float[8192];

    public SinkMixer(int deviceChannels, IReadOnlyList<SpeakerRoute> speakers)
    {
        _devCh = deviceChannels;
        int n = 0;
        foreach (var s in speakers) if (!s.Mute) n++;
        _idx = new int[n][]; _coef = new float[n][]; _outCh = new int[n]; _delay = new DelayLine[n];
        int k = 0;
        foreach (var s in speakers)
        {
            if (s.Mute) continue;
            if (s.DeviceChannel < 0 || s.DeviceChannel >= deviceChannels)
                throw new ArgumentOutOfRangeException(nameof(speakers), $"{s.Name}: device channel out of range");
            float g = (float)Math.Pow(10.0, s.GainDb / 20.0);
            var idx = new List<int>(); var coef = new List<float>();
            for (int c = 0; c < Channels.Count && c < s.MixRow.Length; c++)
                if (s.MixRow[c] != 0f) { idx.Add(c); coef.Add(s.MixRow[c] * g); }
            _idx[k] = idx.ToArray(); _coef[k] = coef.ToArray();
            _outCh[k] = s.DeviceChannel;
            _delay[k] = new DelayLine(s.DelaySamples);
            k++;
        }
    }

    public int DeviceChannels => _devCh;

    /// <summary>Returns the number of frames that did not fit into the ring.</summary>
    public int Process(ReadOnlySpan<float> logical, int frames, RingBuffer ring)
    {
        int total = frames * _devCh;
        if (_scratch.Length < total) _scratch = new float[total * 2];
        var scratch = _scratch.AsSpan(0, total);
        scratch.Clear();
        for (int k = 0; k < _idx.Length; k++)
        {
            var idx = _idx[k]; var coef = _coef[k]; var dl = _delay[k];
            int oc = _outCh[k];
            for (int f = 0; f < frames; f++)
            {
                float acc = 0f;
                int b = f * Channels.Count;
                for (int j = 0; j < idx.Length; j++) acc += logical[b + idx[j]] * coef[j];
                scratch[f * _devCh + oc] += dl.Process(acc);
            }
        }
        int written = ring.Write(scratch);
        return (total - written) / _devCh;
    }
}
