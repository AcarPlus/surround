using System.Buffers.Binary;
using System.Text;

namespace Surround.Engine.Phone;

/// <summary>
/// Reads the phone's MediaRecorder output (<c>audio/webm;codecs=pcm</c>): one PCM audio track in WebM/Matroska, as a
/// browser writes it while recording (Segment and Cluster sizes may be "unknown"). The page records this way because
/// MediaRecorder takes the microphone track directly, without the Web Audio graph whose input buffer drops blocks of
/// tens of ms on phones. Each block carries its capture time; where a block starts later than the samples so far
/// account for, the capture lost audio there and the gap is filled with silence, so the recording keeps real time.
/// </summary>
public static class WebmPcm
{
    /// <summary>Smallest timestamp jump treated as lost audio (block timestamps have 1 ms resolution and some jitter).</summary>
    public const double GapThresholdMs = 8;
    private const double MaxGapSec = 2;

    /// <param name="Gaps">Number of gaps filled with silence.</param>
    /// <param name="GapMs">Their total length.</param>
    public sealed record Audio(float[] Samples, int SampleRate, int Channels, string Codec, int Gaps, double GapMs);

    private const uint IdEbml = 0x1A45DFA3, IdSegment = 0x18538067, IdInfo = 0x1549A966, IdTimecodeScale = 0x2AD7B1,
        IdTracks = 0x1654AE6B, IdTrackEntry = 0xAE, IdCodecId = 0x86, IdAudio = 0xE1, IdSampling = 0xB5, IdChannels = 0x9F,
        IdBitDepth = 0x6264, IdCluster = 0x1F43B675, IdTimecode = 0xE7, IdSimpleBlock = 0xA3, IdBlockGroup = 0xA0, IdBlock = 0xA1;

    /// <summary>Masters whose children are read in line (the file has one track, so flattening loses nothing).</summary>
    private static readonly HashSet<uint> Descend = new() { IdSegment, IdInfo, IdTracks, IdTrackEntry, IdAudio, IdCluster, IdBlockGroup };

    private readonly record struct Block(long TimeNs, int Offset, int Length);

    public static bool LooksLikeWebm(ReadOnlySpan<byte> data) =>
        data.Length >= 4 && BinaryPrimitives.ReadUInt32BigEndian(data) == IdEbml;

    public static Audio Decode(byte[] data)
    {
        long scale = 1_000_000;
        string codec = "";
        double rate = 0;
        int channels = 1, bits = 0;
        long cluster = 0;
        var blocks = new List<Block>();

        int pos = 0;
        while (pos < data.Length)
        {
            if (!ReadId(data, ref pos, out uint id) || !ReadSize(data, ref pos, out long size)) break;
            bool unknown = size < 0;
            if (Descend.Contains(id)) continue; // step into: its children follow
            if (unknown || pos + size > data.Length)
            {
                if (id == IdSimpleBlock || id == IdBlock) size = data.Length - pos; // a cut-off last block
                else break;
            }
            int len = (int)size;
            switch (id)
            {
                case IdTimecodeScale: scale = (long)ReadUInt(data, pos, len); break;
                case IdCodecId: codec = Encoding.ASCII.GetString(data, pos, len).TrimEnd('\0'); break;
                case IdSampling: rate = len == 4 ? BinaryPrimitives.ReadSingleBigEndian(data.AsSpan(pos)) : BinaryPrimitives.ReadDoubleBigEndian(data.AsSpan(pos)); break;
                case IdChannels: channels = (int)ReadUInt(data, pos, len); break;
                case IdBitDepth: bits = (int)ReadUInt(data, pos, len); break;
                case IdTimecode: cluster = (long)ReadUInt(data, pos, len); break;
                case IdSimpleBlock:
                case IdBlock:
                {
                    int p = pos;
                    if (!ReadSize(data, ref p, out _) || p + 3 > pos + len) break; // track number
                    short rel = BinaryPrimitives.ReadInt16BigEndian(data.AsSpan(p));
                    byte flags = data[p + 2];
                    if ((flags & 0x06) != 0) throw new InvalidDataException("WebM kaydında desteklenmeyen paketleme (lacing).");
                    p += 3;
                    blocks.Add(new Block((cluster + rel) * scale, p, pos + len - p));
                    break;
                }
            }
            pos += len;
        }

        int sampleBytes;
        bool isFloat;
        switch (codec)
        {
            case "A_PCM/FLOAT/IEEE": isFloat = true; sampleBytes = bits == 64 ? 8 : 4; break;
            case "A_PCM/INT/LIT": isFloat = false; sampleBytes = bits is 16 or 24 or 32 ? bits / 8 : 2; break;
            default: throw new InvalidDataException(codec.Length == 0 ? "WebM kaydında ses izi yok." : $"WebM kaydı PCM değil ({codec}).");
        }
        int sr = (int)Math.Round(rate);
        if (sr < 8000 || sr > 192000) throw new InvalidDataException("WebM kaydında geçersiz örnekleme hızı.");
        if (channels < 1 || channels > 8) throw new InvalidDataException("WebM kaydında geçersiz kanal sayısı.");
        int frameBytes = sampleBytes * channels;

        // Timestamp drift against the sample count; a jump that the next block confirms is lost audio.
        long total = 0;
        foreach (var b in blocks) total += b.Length / frameBytes;
        var outList = new List<float>((int)Math.Min(int.MaxValue, total + sr));
        int gaps = 0;
        double gapMs = 0;
        long t0 = blocks.Count > 0 ? blocks[0].TimeNs : 0;
        double Lead(int i, long written) => (blocks[i].TimeNs - t0) / 1e6 - written * 1000.0 / sr;
        for (int i = 0; i < blocks.Count; i++)
        {
            var b = blocks[i];
            if (i > 0)
            {
                double lead = Lead(i, outList.Count);
                if (i + 1 < blocks.Count) lead = Math.Min(lead, Lead(i + 1, outList.Count + b.Length / frameBytes));
                if (lead > GapThresholdMs && lead < MaxGapSec * 1000)
                {
                    int n = (int)Math.Round(lead * sr / 1000);
                    for (int k = 0; k < n; k++) outList.Add(0);
                    gaps++; gapMs += n * 1000.0 / sr;
                }
            }
            int frames = b.Length / frameBytes;
            for (int f = 0; f < frames; f++)
            {
                double sum = 0;
                for (int c = 0; c < channels; c++) sum += Sample(data, b.Offset + f * frameBytes + c * sampleBytes, sampleBytes, isFloat);
                float v = (float)(sum / channels);
                outList.Add(float.IsFinite(v) ? v : 0);
            }
        }
        return new Audio(outList.ToArray(), sr, channels, codec, gaps, Math.Round(gapMs, 1));
    }

    private static double Sample(byte[] d, int at, int bytes, bool isFloat)
    {
        var s = d.AsSpan(at);
        if (isFloat) return bytes == 8 ? BinaryPrimitives.ReadDoubleLittleEndian(s) : BinaryPrimitives.ReadSingleLittleEndian(s);
        return bytes switch
        {
            2 => BinaryPrimitives.ReadInt16LittleEndian(s) / 32768.0,
            3 => ((s[0] | (s[1] << 8) | (s[2] << 16)) << 8 >> 8) / 8388608.0,
            _ => BinaryPrimitives.ReadInt32LittleEndian(s) / 2147483648.0,
        };
    }

    private static ulong ReadUInt(byte[] d, int at, int len)
    {
        ulong v = 0;
        for (int i = 0; i < len && i < 8; i++) v = (v << 8) | d[at + i];
        return v;
    }

    /// <summary>Element ID: a vint with its length marker kept (1–4 bytes).</summary>
    private static bool ReadId(byte[] d, ref int pos, out uint id)
    {
        id = 0;
        if (pos >= d.Length) return false;
        byte b = d[pos];
        int n = b >= 0x80 ? 1 : b >= 0x40 ? 2 : b >= 0x20 ? 3 : b >= 0x10 ? 4 : 0;
        if (n == 0 || pos + n > d.Length) return false;
        for (int i = 0; i < n; i++) id = (id << 8) | d[pos + i];
        pos += n;
        return true;
    }

    /// <summary>Element size: a vint without its marker (1–8 bytes); all value bits set = unknown (-1).</summary>
    private static bool ReadSize(byte[] d, ref int pos, out long size)
    {
        size = 0;
        if (pos >= d.Length) return false;
        byte b = d[pos];
        int n = 1;
        while (n <= 8 && (b & (0x80 >> (n - 1))) == 0) n++;
        if (n > 8 || pos + n > d.Length) return false;
        long v = b & (0xFF >> n);
        bool allOnes = v == (0xFF >> n);
        for (int i = 1; i < n; i++) { v = (v << 8) | d[pos + i]; allOnes &= d[pos + i] == 0xFF; }
        pos += n;
        size = allOnes ? -1 : v;
        return true;
    }
}
