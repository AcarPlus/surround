namespace Surround.Engine.Phone;

/// <summary>The phone page (phone.html, embedded): asks for the microphone, records on request (MediaRecorder PCM WebM when the browser can, see <see cref="WebmPcm"/>), uploads.</summary>
public static class PhonePage
{
    private static byte[]? _html;

    public static byte[] Html()
    {
        if (_html != null) return _html;
        var asm = typeof(PhonePage).Assembly;
        var name = asm.GetManifestResourceNames().First(n => n.EndsWith("phone.html", StringComparison.Ordinal));
        using var s = asm.GetManifestResourceStream(name)!;
        using var m = new MemoryStream();
        s.CopyTo(m);
        return _html = m.ToArray();
    }
}
