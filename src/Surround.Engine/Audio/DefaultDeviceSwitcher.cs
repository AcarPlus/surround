using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;

namespace Surround.Engine.Audio;

/// <summary>Windows default-device role (ERole): Console, Multimedia, Communications.</summary>
public enum DeviceRole { Console = 0, Multimedia = 1, Communications = 2 }

/// <summary>Reads and changes the Windows default render device. Abstracted so the guard logic can be tested.</summary>
public interface IDefaultDeviceSwitcher
{
    /// <summary>Id of the current default render endpoint for <paramref name="role"/>, or null if there is none.</summary>
    string? GetDefaultRender(DeviceRole role);

    /// <summary>True if <paramref name="deviceId"/> is an active render endpoint.</summary>
    bool RenderDeviceExists(string deviceId);

    /// <summary>Makes <paramref name="deviceId"/> the default render endpoint for <paramref name="role"/>. Throws on failure.</summary>
    void SetDefaultRender(string deviceId, DeviceRole role);
}

/// <summary>
/// Real implementation. Setting the default needs the undocumented IPolicyConfig COM interface (the same one the
/// Sound control panel and tools such as nircmd use); reading and existence checks go through the public MMDevice API.
/// </summary>
public sealed class WasapiDefaultDeviceSwitcher : IDefaultDeviceSwitcher
{
    public string? GetDefaultRender(DeviceRole role)
    {
        try
        {
            using var en = new MMDeviceEnumerator();
            using var dev = en.GetDefaultAudioEndpoint(DataFlow.Render, ToNAudio(role));
            return dev.ID;
        }
        catch { return null; } // no default endpoint
    }

    public bool RenderDeviceExists(string deviceId)
    {
        try
        {
            using var en = new MMDeviceEnumerator();
            using var dev = en.GetDevice(deviceId);
            return dev.DataFlow == DataFlow.Render && dev.State == DeviceState.Active;
        }
        catch { return false; }
    }

    public void SetDefaultRender(string deviceId, DeviceRole role)
    {
        var policy = (IPolicyConfig)new PolicyConfigClient();
        try
        {
            int hr = policy.SetDefaultEndpoint(deviceId, (int)role);
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        }
        finally { Marshal.ReleaseComObject(policy); }
    }

    private static Role ToNAudio(DeviceRole role) => role switch
    {
        DeviceRole.Console => Role.Console,
        DeviceRole.Communications => Role.Communications,
        _ => Role.Multimedia,
    };

    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    private class PolicyConfigClient { }

    // Windows 10/11 vtable. Only SetDefaultEndpoint is used; the rest exist to keep the slot order right.
    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultFormat, IntPtr format);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultPeriod, IntPtr defaultPeriodValue, IntPtr minimumPeriod);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr period);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int bFxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int bFxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
    }
}
