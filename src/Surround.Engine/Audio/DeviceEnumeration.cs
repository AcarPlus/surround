using NAudio.CoreAudioApi;
using Surround.Engine.Config;

namespace Surround.Engine.Audio;

public sealed record DeviceInfo(string Id, string Name, DeviceFlow Flow, string State, int SampleRate, int Channels, bool IsDefault);

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
        return new DeviceInfo(dev.ID, dev.FriendlyName,
            dev.DataFlow == DataFlow.Render ? DeviceFlow.Render : DeviceFlow.Capture,
            dev.State.ToString(), rate, ch, defaultId != null && dev.ID == defaultId);
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
