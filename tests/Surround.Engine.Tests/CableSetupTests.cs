using Surround.Engine.Audio;

namespace Surround.Engine.Tests;

public class CableSetupTests
{
    [Fact]
    public void NewestPackUrl_TakesTheHighestPackOnThePage()
    {
        const string html = """
            <a href="https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack43.zip">old</a>
            <a href="https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack47.zip">new</a>
            <a href="https://download.vb-audio.com/Download_CABLE/VBCABLE_A_B_Driver_Pack45.zip">A+B</a>
            """;
        Assert.Equal("https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack47.zip", CableInstaller.NewestPackUrl(html));
        Assert.Null(CableInstaller.NewestPackUrl("<html>nothing</html>"));
    }

    [Fact]
    public void IsTrusted_RejectsUnsignedFiles()
    {
        string f = Path.Combine(Path.GetTempPath(), "surround-unsigned-" + Guid.NewGuid().ToString("N") + ".exe");
        File.WriteAllBytes(f, new byte[] { 0x4D, 0x5A, 0, 0 });
        try { Assert.False(CableInstaller.IsTrusted(f, out var why)); Assert.NotNull(why); }
        finally { File.Delete(f); }
    }

    [Fact]
    public void SevenOneFormat_IsAnEightChannelExtensibleFormat()
    {
        var b = SpeakerLayout.Format(48000, 24, 24, isFloat: false);
        Assert.Equal(40, b.Length);
        Assert.Equal(0xFFFE, BitConverter.ToUInt16(b, 0));
        Assert.Equal(8, BitConverter.ToUInt16(b, 2));
        Assert.Equal(48000, BitConverter.ToInt32(b, 4));
        Assert.Equal(48000 * 24, BitConverter.ToInt32(b, 8)); // 8 ch × 3 bytes
        Assert.Equal(24, BitConverter.ToUInt16(b, 12));
        Assert.Equal(22, BitConverter.ToUInt16(b, 16));
        Assert.Equal(SpeakerLayout.SevenOneMask, BitConverter.ToUInt32(b, 20));
        Assert.Equal(new Guid("00000001-0000-0010-8000-00aa00389b71"), new Guid(b.AsSpan(24, 16)));
        var f = SpeakerLayout.Format(44100, 32, 32, isFloat: true);
        Assert.Equal(new Guid("00000003-0000-0010-8000-00aa00389b71"), new Guid(f.AsSpan(24, 16)));
    }
}
