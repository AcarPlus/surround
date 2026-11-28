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

    /// <summary>Active render endpoints, id and friendly name only (no audio client is opened: cheap enough to poll).</summary>
    public static List<DeviceInfo> ActiveRenderEndpoints()
    {
        var result = new List<DeviceInfo>();
        try
        {
            using var en = new MMDeviceEnumerator();
            foreach (var dev in en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
                using (dev) result.Add(new DeviceInfo(dev.ID, NameOf(dev), DeviceFlow.Render, dev.State.ToString(), 0, 0, false));
        }
        catch { /* enumeration unavailable: nothing to rebind to */ }
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
            if (dev.State != DeviceState.Active) return new DeviceProbe(id, ReadProps(dev).Name, false);
            var info = Describe(dev);
            return new DeviceProbe(id, info.Name, true, info.Channels, info.SampleRate);
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
        var (name, enumerator) = ReadProps(dev);
        var (bt, hf) = DeviceClassifier.Classify(enumerator, name);
        return new DeviceInfo(dev.ID, name ?? "",
            dev.DataFlow == DataFlow.Render ? DeviceFlow.Render : DeviceFlow.Capture,
            dev.State.ToString(), rate, ch, defaultId != null && dev.ID == defaultId, bt, hf);
    }

    /// <summary>The endpoint's friendly name, read by key (fast; see <see cref="EndpointProperties"/>); "" if unreadable.</summary>
    public static string NameOf(MMDevice dev) => ReadProps(dev).Name ?? "";

    /// <summary>Friendly name and enumerator (PKEY_Device_EnumeratorName), read by key (see <see cref="EndpointProperties"/>).</summary>
    private static (string? Name, string? Enumerator) ReadProps(MMDevice dev)
    {
        var (name, enumerator) = EndpointProperties.Read(dev.ID);
        if (name is null)
        {
            // Fallback: NAudio's own (slower) lookup.
            try { name = dev.FriendlyName; } catch { /* property store unavailable */ }
        }
        return (name, enumerator);
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
