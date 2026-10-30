using NAudio.Wave;

namespace Surround.Engine.Audio;

/// <summary>Converts captured byte buffers (PCM 16/24/32 or float32) to interleaved float.</summary>
public static class SampleConverter
{
    public static WaveFormatEncoding EffectiveEncoding(WaveFormat f) =>
        f is WaveFormatExtensible ext ? ext.ToStandardWaveFormat().Encoding : f.Encoding;

    public static bool IsSupported(WaveFormat f)
    {
        var enc = EffectiveEncoding(f);
        return enc == WaveFormatEncoding.IeeeFloat ? f.BitsPerSample == 32
            : enc == WaveFormatEncoding.Pcm && (f.BitsPerSample is 16 or 24 or 32);
    }

    /// <summary>Returns the number of samples (all channels) written to dst.</summary>
    public static int ToFloat(byte[] src, int bytes, WaveFormat f, float[] dst)
    {
        var enc = EffectiveEncoding(f);
        int bps = f.BitsPerSample / 8;
        int n = bytes / bps;
        if (enc == WaveFormatEncoding.IeeeFloat)
        {
            Buffer.BlockCopy(src, 0, dst, 0, n * 4);
            return n;
        }
        switch (f.BitsPerSample)
        {
            case 16:
                for (int i = 0; i < n; i++) dst[i] = BitConverter.ToInt16(src, i * 2) / 32768f;
                break;
            case 24:
                for (int i = 0; i < n; i++)
                {
                    int o = i * 3;
                    int v = (src[o] << 8) | (src[o + 1] << 16) | (src[o + 2] << 24);
                    dst[i] = v / 2147483648f;
                }
                break;
            case 32:
                for (int i = 0; i < n; i++) dst[i] = BitConverter.ToInt32(src, i * 4) / 2147483648f;
                break;
            default:
                throw new NotSupportedException($"Desteklenmeyen format: {f}");
        }
        return n;
    }
}
