using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace Surround.Engine.Audio;

/// <summary>
/// Endpoint notifications (IMMNotificationClient): raises <see cref="Changed"/> with the endpoint id when a device is
/// added, removed, changes state (unplugged, disabled …) or changes its shared-mode format. Default-device changes are
/// ignored (the app makes them itself). <see cref="Changed"/> runs on a Windows notification thread: handlers must only
/// record the event and return, never touch the engine or block.
/// </summary>
public sealed class DeviceWatcher : IMMNotificationClient, IDisposable
{
    // PKEY_AudioEngine_DeviceFormat / PKEY_AudioEngine_OEMFormat (mmdeviceapi.h).
    private static readonly Guid DeviceFormatFmtId = new("f19f064d-082c-4e27-bc73-6882a1bb8e4c");
    private static readonly Guid OemFormatFmtId = new("e4870e26-3cc5-4cd2-ba46-ca0a9a70ed04");

    private MMDeviceEnumerator? _enumerator;

    public event Action<string>? Changed;

    public DeviceWatcher()
    {
        _enumerator = new MMDeviceEnumerator();
        int hr = _enumerator.RegisterEndpointNotificationCallback(this);
        if (hr < 0)
        {
            _enumerator.Dispose();
            _enumerator = null;
            System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(hr);
        }
    }

    public void OnDeviceStateChanged(string deviceId, DeviceState newState) => Raise(deviceId);
    public void OnDeviceAdded(string pwstrDeviceId) => Raise(pwstrDeviceId);
    public void OnDeviceRemoved(string deviceId) => Raise(deviceId);
    public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId) { }

    public void OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key)
    {
        if ((key.formatId == DeviceFormatFmtId && key.propertyId == 0) || (key.formatId == OemFormatFmtId && key.propertyId == 3))
            Raise(pwstrDeviceId);
    }

    private void Raise(string? id)
    {
        if (string.IsNullOrEmpty(id)) return;
        try { Changed?.Invoke(id); } catch { /* never let an exception cross back into the audio service */ }
    }

    public void Dispose()
    {
        var en = Interlocked.Exchange(ref _enumerator, null);
        if (en is null) return;
        try { en.UnregisterEndpointNotificationCallback(this); } catch { }
        en.Dispose();
    }
}
