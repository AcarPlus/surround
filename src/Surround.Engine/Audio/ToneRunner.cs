using NAudio.CoreAudioApi;
using NAudio.Wave;
using Surround.Engine.Config;

namespace Surround.Engine.Audio;

/// <summary>Plays a 440 Hz sine on one channel of one device (to identify speakers by ear).</summary>
public static class ToneRunner
{
    public static void Play(string deviceId, int channel1Based, double seconds, CancellationToken ct = default)
    {
        using var en = new MMDeviceEnumerator();
        using var dev = en.GetDevice(deviceId.Trim());
        var mix = dev.AudioClient.MixFormat;
        if (channel1Based < 1 || channel1Based > mix.Channels)
            throw new ArgumentOutOfRangeException(nameof(channel1Based), $"Cihaz {mix.Channels} kanallı; istenen kanal {channel1Based}.");

        var fmt = SampleConverter.EffectiveEncoding(mix) == WaveFormatEncoding.IeeeFloat && mix.BitsPerSample == 32
            ? mix : WaveFormat.CreateIeeeFloatWaveFormat(mix.SampleRate, mix.Channels);
        using var wo = new WasapiOut(dev, AudioClientShareMode.Shared, true, 60);
        try
        {
            wo.Init(new ToneProvider(fmt, channel1Based - 1, seconds));
            wo.Play();
            var end = DateTime.UtcNow.AddSeconds(seconds + 0.3);
            while (DateTime.UtcNow < end && !ct.IsCancellationRequested) Thread.Sleep(20);
        }
        finally
        {
            try { wo.Stop(); } catch { }
        }
    }

    private sealed class ToneProvider : IWaveProvider
    {
        private readonly int _ch, _target;
        private readonly double _step, _total;
        private double _phase;
        private long _pos;

        public ToneProvider(WaveFormat f, int targetChannel, double seconds)
        {
            WaveFormat = f; _ch = f.Channels; _target = targetChannel;
            _step = 2 * Math.PI * 440.0 / f.SampleRate;
            _total = seconds * f.SampleRate;
        }

        public WaveFormat WaveFormat { get; }

        public int Read(byte[] buffer, int offset, int count)
        {
            var s = System.Runtime.InteropServices.MemoryMarshal.Cast<byte, float>(buffer.AsSpan(offset, count));
            s.Clear();
            int frames = s.Length / _ch;
            int fade = (int)(0.02 * WaveFormat.SampleRate);
            for (int f = 0; f < frames; f++, _pos++)
            {
                if (_pos >= _total) continue;
                double env = Math.Min(1.0, Math.Min(_pos / (double)fade, (_total - _pos) / fade));
                s[f * _ch + _target] = (float)(0.2 * env * Math.Sin(_phase));
                _phase += _step;
                if (_phase > 2 * Math.PI) _phase -= 2 * Math.PI;
            }
            return count;
        }
    }
}
