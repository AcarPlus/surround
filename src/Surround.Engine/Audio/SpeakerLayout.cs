using System.Runtime.InteropServices;

namespace Surround.Engine.Audio;

/// <summary>
/// Sets a render endpoint to 7.1 the way the Sound control panel's "Configure" does: the physical / full-range speaker
/// masks and the shared-mode device format (8 channels, same rate and sample type as before), through the undocumented
/// IPolicyConfig interface (as <see cref="WasapiDefaultDeviceSwitcher"/>). Used for VB-Cable, which installs as stereo:
/// without 7.1 Windows downmixes everything to two channels before Surround sees it.
/// </summary>
public static class SpeakerLayout
{
    /// <summary>KSAUDIO_SPEAKER_7POINT1_SURROUND: FL FR FC LFE BL BR SL SR.</summary>
    public const uint SevenOneMask = 0x63F;

    private static readonly Guid SubPcm = new("00000001-0000-0010-8000-00aa00389b71");
    private static readonly Guid SubFloat = new("00000003-0000-0010-8000-00aa00389b71");
    private static readonly Guid PkeySpeakers = new("1da5d803-d492-4edd-8c23-e0c0ffee7f0e");
    private const int PidPhysicalSpeakers = 3, PidFullRangeSpeakers = 6;

    /// <summary>Endpoint format for a device that was <paramref name="bits"/>/<paramref name="rate"/>: 8 channels, 7.1 mask.</summary>
    internal static byte[] Format(int rate, int bits, int validBits, bool isFloat)
    {
        var b = new byte[40];
        int block = 8 * bits / 8;
        BitConverter.TryWriteBytes(b.AsSpan(0), (ushort)0xFFFE);          // WAVE_FORMAT_EXTENSIBLE
        BitConverter.TryWriteBytes(b.AsSpan(2), (ushort)8);
        BitConverter.TryWriteBytes(b.AsSpan(4), rate);
        BitConverter.TryWriteBytes(b.AsSpan(8), rate * block);
        BitConverter.TryWriteBytes(b.AsSpan(12), (ushort)block);
        BitConverter.TryWriteBytes(b.AsSpan(14), (ushort)bits);
        BitConverter.TryWriteBytes(b.AsSpan(16), (ushort)22);
        BitConverter.TryWriteBytes(b.AsSpan(18), (ushort)validBits);
        BitConverter.TryWriteBytes(b.AsSpan(20), SevenOneMask);
        (isFloat ? SubFloat : SubPcm).TryWriteBytes(b.AsSpan(24));
        return b;
    }

    public static void SetSevenOne(string deviceId)
    {
        var policy = (IPolicyConfig)new PolicyConfigClient();
        IntPtr cur = IntPtr.Zero;
        try
        {
            int rate = 48000, bits = 24, valid = 24;
            bool isFloat = false;
            if (policy.GetDeviceFormat(deviceId, 0, out cur) >= 0 && cur != IntPtr.Zero)
            {
                ushort tag = (ushort)Marshal.ReadInt16(cur, 0);
                int r = Marshal.ReadInt32(cur, 4), bps = (ushort)Marshal.ReadInt16(cur, 14);
                if (r is >= 8000 and <= 384000) rate = r;
                if (bps is 16 or 24 or 32) bits = valid = bps;
                if (tag == 3) isFloat = true;
                else if (tag == 0xFFFE)
                {
                    int vb = (ushort)Marshal.ReadInt16(cur, 18);
                    if (vb > 0 && vb <= bits) valid = vb;
                    var sub = new byte[16];
                    Marshal.Copy(cur + 24, sub, 0, 16);
                    isFloat = new Guid(sub) == SubFloat;
                }
            }

            SetMask(policy, deviceId, PidPhysicalSpeakers);
            SetMask(policy, deviceId, PidFullRangeSpeakers);

            var ep = Format(rate, bits, valid, isFloat);
            var mix = Format(rate, 32, 32, isFloat: true); // the engine mixes in float
            var pe = Marshal.AllocCoTaskMem(ep.Length);
            var pm = Marshal.AllocCoTaskMem(mix.Length);
            try
            {
                Marshal.Copy(ep, 0, pe, ep.Length);
                Marshal.Copy(mix, 0, pm, mix.Length);
                int hr = policy.SetDeviceFormat(deviceId, pe, pm);
                if (hr < 0) Marshal.ThrowExceptionForHR(hr);
            }
            finally { Marshal.FreeCoTaskMem(pe); Marshal.FreeCoTaskMem(pm); }
        }
        finally
        {
            if (cur != IntPtr.Zero) Marshal.FreeCoTaskMem(cur);
            Marshal.ReleaseComObject(policy);
        }
    }

    private static void SetMask(IPolicyConfig policy, string deviceId, int pid)
    {
        var key = Marshal.AllocCoTaskMem(20);
        var pv = Marshal.AllocCoTaskMem(24); // PROPVARIANT (x64)
        try
        {
            Marshal.Copy(PkeySpeakers.ToByteArray(), 0, key, 16);
            Marshal.WriteInt32(key, 16, pid);
            Marshal.Copy(new byte[24], 0, pv, 24);
            Marshal.WriteInt16(pv, 0, 19); // VT_UI4
            Marshal.WriteInt32(pv, 8, unchecked((int)SevenOneMask));
            int hr = policy.SetPropertyValue(deviceId, 0, key, pv);
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        }
        finally { Marshal.FreeCoTaskMem(key); Marshal.FreeCoTaskMem(pv); }
    }

    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    private class PolicyConfigClient { }

    // Windows 10/11 vtable (same as in DefaultDeviceSwitcher), with the format/property slots typed for use here.
    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultFormat, out IntPtr format);
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
