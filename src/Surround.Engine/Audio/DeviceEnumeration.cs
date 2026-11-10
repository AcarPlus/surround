using NAudio.CoreAudioApi;
using Surround.Engine.Config;

namespace Surround.Engine.Audio;

public sealed record DeviceInfo(string Id, string Name, DeviceFlow Flow, string State, int SampleRate, int Channels, bool IsDefault,
    bool Bluetooth = false, bool HandsFree = false);

/// <summary>Bluetooth uç noktası sınıflandırması (saf mantık; birim testlenir).</summary>
public static class DeviceClassifier
{
    /// <summary>
    /// Bluetooth mu / Hands-Free (HFP, düşük kalite mono) mu? Önce numaralandırıcı adı (BTHENUM, BTHLEDevice, BTHHFENUM),
    /// yoksa ad sezgisi (Bluetooth, Hands-Free, AG Audio).
    /// </summary>
    public static (bool Bluetooth, bool HandsFree) Classify(string? enumeratorName, string? friendlyName)
    {
        var en = enumeratorName ?? "";
        var name = friendlyName ?? "";
        bool hands = name.Contains("Hands-Free", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Handsfree", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Hands Free", StringComparison.OrdinalIgnoreCase)
            || name.Contains("AG Audio", StringComparison.OrdinalIgnoreCase)
            || en.Equals("BTHHFENUM", StringComparison.OrdinalIgnoreCase);
        bool bt = en.StartsWith("BTH", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Bluetooth", StringComparison.OrdinalIgnoreCase)
            || hands;
        return (bt, bt && hands);
    }
}

public static class DeviceEnumeration
{
    public static List<DeviceInfo> List(bool includeInactive = false)
    {
        var result = new List<DeviceInfo>();
        using var en = new MMDeviceEnumerator();
        var mask = includeInactive ? DeviceState.All : DeviceState.Active;
        foreach (var flow in new[] { DataFlow.Render, DataFlow.Capture })
        {
            string? defId = null;
            try
            {
                using var d = en.GetDefaultAudioEndpoint(flow, Role.Multimedia);
                defId = d.ID;
            }
            catch { /* no default endpoint */ }

            foreach (var dev in en.EnumerateAudioEndPoints(flow, mask))
            {
                using (dev) result.Add(Describe(dev, defId));
            }
        }
        return result;
    }

    /// <summary>
    /// Current state of one endpoint for <see cref="DeviceRecovery"/>: present = active. The name is kept for unplugged or
    /// disabled endpoints Windows still knows; null when the id is unknown.
    /// </summary>
    public static DeviceProbe Probe(string id)
    {
        try
        {
            using var en = new MMDeviceEnumerator();
            using var dev = en.GetDevice(id.Trim());
            string? name = null;
            try { name = dev.FriendlyName; } catch { /* property store unavailable */ }
            if (dev.State != DeviceState.Active) return new DeviceProbe(id, name, false);
            var info = Describe(dev);
            return new DeviceProbe(id, name ?? info.Name, true, info.Channels, info.SampleRate);
        }
        catch
        {
            return new DeviceProbe(id, null, false);
        }
    }

    internal static DeviceInfo Describe(MMDevice dev, string? defaultId = null)
    {
        int rate = 0, ch = 0;
        if (dev.State == DeviceState.Active)
        {
            try
            {
                var mf = dev.AudioClient.MixFormat;
                rate = mf.SampleRate; ch = mf.Channels;
            }
            catch { /* device busy or exclusive-only */ }
        }
        string? enumerator = null;
        try
        {
            // PKEY_Device_EnumeratorName {a45c254e-df1c-4efd-8020-67d146a850e0},24
            var key = new PropertyKey(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 24);
            if (dev.Properties.Contains(key)) enumerator = dev.Properties[key].Value as string;
        }
        catch { /* property store unavailable */ }
        var (bt, hf) = DeviceClassifier.Classify(enumerator, dev.FriendlyName);
        return new DeviceInfo(dev.ID, dev.FriendlyName,
            dev.DataFlow == DataFlow.Render ? DeviceFlow.Render : DeviceFlow.Capture,
            dev.State.ToString(), rate, ch, defaultId != null && dev.ID == defaultId, bt, hf);
    }
}

public sealed class WasapiDeviceCatalog : IDeviceCatalog
{
    public DeviceDescriptor? Find(string id)
    {
        using var en = new MMDeviceEnumerator();
        try
        {
            using var dev = en.GetDevice(id.Trim());
            if (dev.State != DeviceState.Active) return null;
            var info = DeviceEnumeration.Describe(dev);
            return new DeviceDescriptor(info.Id, info.Name, info.Flow, info.Channels, info.SampleRate);
        }
        catch
        {
            return null;
        }
    }
}
