using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Surround.Engine.Phone;

/// <summary>
/// The self-signed TLS certificate of the phone link. Kept in a PFX file so the phone's one-time "proceed anyway"
/// exception stays valid across runs; made again when this PC's LAN addresses are no longer all in it (the browser
/// checks the address it connects to) or when it is about to expire.
/// </summary>
public static class PhoneCertificate
{
    private const string Subject = "CN=Surround (bu bilgisayar)";

    public static X509Certificate2 LoadOrCreate(string path, IReadOnlyList<IPAddress> addresses)
    {
        try
        {
            if (File.Exists(path))
            {
                var c = X509CertificateLoader.LoadPkcs12FromFile(path, null, X509KeyStorageFlags.Exportable);
                if (c.NotAfter > DateTime.Now.AddDays(30) && addresses.All(a => Covers(c, a))) return c;
                c.Dispose();
            }
        }
        catch { /* unreadable: make a new one */ }

        var cert = Create(addresses);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, cert.Export(X509ContentType.Pfx));
        }
        catch { /* not persisted: the phone asks again next time */ }
        return cert;
    }

    public static X509Certificate2 Create(IReadOnlyList<IPAddress> addresses)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var req = new CertificateRequest(Subject, key, HashAlgorithmName.SHA256);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("localhost");
        san.AddIpAddress(IPAddress.Loopback);
        foreach (var a in addresses) san.AddIpAddress(a);
        req.CertificateExtensions.Add(san.Build());
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, true));
        req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        using var tmp = req.CreateSelfSigned(DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddYears(2));
        // SChannel needs a key it can reach: round-trip through PFX (an ephemeral key fails the TLS handshake on Windows).
        return X509CertificateLoader.LoadPkcs12(tmp.Export(X509ContentType.Pfx), null, X509KeyStorageFlags.Exportable);
    }

    private static bool Covers(X509Certificate2 c, IPAddress a)
    {
        foreach (var ext in c.Extensions)
            if (ext is X509SubjectAlternativeNameExtension san)
                return san.EnumerateIPAddresses().Any(x => x.Equals(a));
        return false;
    }

    /// <summary>
    /// IPv4 addresses a phone on the same network can reach: up, non-loopback, non-virtual-looking interfaces with a
    /// gateway first (the Wi-Fi/Ethernet the phone is likely on), private ranges only.
    /// </summary>
    public static List<IPAddress> LanAddresses()
    {
        var list = new List<(IPAddress Ip, bool Gateway)>();
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
                var props = ni.GetIPProperties();
                bool gw = props.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
                foreach (var u in props.UnicastAddresses)
                    if (u.Address.AddressFamily == AddressFamily.InterNetwork && IsPrivate(u.Address)) list.Add((u.Address, gw));
            }
        }
        catch { }
        return list.OrderByDescending(x => x.Gateway).Select(x => x.Ip).Distinct().ToList();
    }

    internal static bool IsPrivate(IPAddress a)
    {
        var b = a.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
    }
}
