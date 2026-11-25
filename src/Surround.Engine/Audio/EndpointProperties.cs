using System.Runtime.InteropServices;

namespace Surround.Engine.Audio;

/// <summary>
/// Reads single properties of an audio endpoint by key. NAudio's <c>MMDevice.FriendlyName</c> / <c>Properties[key]</c>
/// walk the whole property store for every lookup, and each step is a call into the Windows audio service: listing the
/// devices took ~360 ms on a machine with nine endpoints, most of it here (each property ~10-15 ms). Asking the store
/// for the key directly is one call.
/// </summary>
internal static class EndpointProperties
{
    private static readonly Guid DeviceKeys = new("a45c254e-df1c-4efd-8020-67d146a850e0");
    // Created by CLSID, not through a [ComImport] class: NAudio already has one for this CLSID and the runtime hands
    // back NAudio's type for it, which does not cast to ours.
    private static readonly Type? EnumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));

    /// <summary>PKEY_Device_FriendlyName and PKEY_Device_EnumeratorName; null for what cannot be read.</summary>
    public static (string? FriendlyName, string? Enumerator) Read(string id)
    {
        IMMDeviceEnumerator? en = null;
        IMMDevice? dev = null;
        IPropertyStore? store = null;
        try
        {
            if (EnumeratorType is null) return (null, null);
            en = (IMMDeviceEnumerator)Activator.CreateInstance(EnumeratorType)!;
            if (en.GetDevice(id, out dev) != 0 || dev is null) return (null, null);
            if (dev.OpenPropertyStore(0 /* STGM_READ */, out store) != 0 || store is null) return (null, null);
            return (ReadString(store, new PropertyKey(DeviceKeys, 14)), ReadString(store, new PropertyKey(DeviceKeys, 24)));
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException)
        {
            return (null, null);
        }
        finally
        {
            if (store != null) Marshal.ReleaseComObject(store);
            if (dev != null) Marshal.ReleaseComObject(dev);
            if (en != null) Marshal.ReleaseComObject(en);
        }
    }

    private static string? ReadString(IPropertyStore store, PropertyKey key)
    {
        var pv = new PropVariant();
        try
        {
            if (store.GetValue(ref key, out pv) != 0) return null;
            return pv.Vt == 31 /* VT_LPWSTR */ && pv.Ptr != IntPtr.Zero ? Marshal.PtrToStringUni(pv.Ptr) : null;
        }
        finally { PropVariantClear(ref pv); }
    }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant pvar);

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey
    {
        public Guid FormatId;
        public int PropertyId;
        public PropertyKey(Guid f, int p) { FormatId = f; PropertyId = p; }
    }

    /// <summary>PROPVARIANT header + the first pointer-sized value (all that a string needs); 24 bytes on x64.</summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant
    {
        public ushort Vt;
        public ushort R1, R2, R3;
        public IntPtr Ptr;
        public IntPtr Ptr2;
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int stgmAccess, out IPropertyStore properties);
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    }
}
