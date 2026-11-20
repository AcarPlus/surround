using NAudio.CoreAudioApi;

namespace Surround.Engine.Audio;

/// <summary>Windows volume of the source device: slider position 0..1, its dB on the device's curve, mute.</summary>
public readonly record struct VolumeState(bool Available, double Level, bool Muted, double Db)
{
    public static readonly VolumeState Unavailable = new(false, 1, false, 0);

    /// <summary>Linear gain the engine applies: Windows applies none of it to a loopback capture.</summary>
    public float Gain => !Available ? 1f : Muted || Level <= 0.001 ? 0f : (float)Math.Pow(10, Math.Min(0, Db) / 20);

    /// <summary>Fallback when the device does not report dB: close to the Windows taper (50 % ≈ -12 dB, 25 % ≈ -24 dB).</summary>
    public static double ApproxDb(double level) => level <= 0 ? -96 : Math.Max(-96, 40 * Math.Log10(level));
}

/// <summary>
/// Follows the endpoint volume (the Windows volume slider, the volume keys, mute) of a render device. A WASAPI loopback
/// capture taps the mix before that volume, so without this the volume keys would not change what Surround plays.
/// Create and use it from an MTA thread; <see cref="Changed"/> is raised on a COM thread.
/// </summary>
public sealed class SourceVolume : IDisposable
{
    private readonly MMDevice _device;
    private readonly bool _ownsDevice;
    private readonly AudioEndpointVolume _volume;
    private readonly Action<string>? _log;
    private VolumeState _state;
    private int _disposed;

    public event Action<VolumeState>? Changed;

    public VolumeState State => _state;
    /// <summary>
    /// Read once at creation (on the MTA thread): the page's config saves ask for it on the UI (STA) thread, where any
    /// call into the MTA-created IMMDevice fails with E_NOINTERFACE.
    /// </summary>
    public string DeviceId { get; }

    private SourceVolume(MMDevice device, bool ownsDevice, Action<string>? log)
    {
        _device = device;
        DeviceId = device.ID;
        _ownsDevice = ownsDevice;
        _log = log;
        _volume = device.AudioEndpointVolume;
        _state = Read(null);
        _volume.OnVolumeNotification += OnNotify;
    }

    /// <summary>Watches <paramref name="device"/> (not disposed here); null when the device has no volume control.</summary>
    public static SourceVolume? TryAttach(MMDevice device, Action<string>? log = null)
    {
        try { return new SourceVolume(device, false, log); }
        catch (Exception ex) { log?.Invoke($"Ses düzeyi izlenemiyor: {ex.Message}"); return null; }
    }

    public static SourceVolume? TryOpen(string deviceId, Action<string>? log = null)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return null;
        MMDevice? dev = null;
        try
        {
            using var en = new MMDeviceEnumerator();
            dev = en.GetDevice(deviceId.Trim());
            return new SourceVolume(dev, true, log);
        }
        catch (Exception ex)
        {
            dev?.Dispose();
            log?.Invoke($"Ses düzeyi izlenemiyor: {ex.Message}");
            return null;
        }
    }

    /// <summary>Sets the Windows volume slider (0..1); the change comes back through <see cref="Changed"/>.</summary>
    public void SetLevel(double level)
    {
        _volume.MasterVolumeLevelScalar = (float)Math.Clamp(level, 0, 1);
        Refresh();
    }

    public void SetMuted(bool muted)
    {
        _volume.Mute = muted;
        Refresh();
    }

    private void Refresh()
    {
        var s = Read(null);
        if (s == _state) return;
        _state = s;
        Changed?.Invoke(s);
    }

    private void OnNotify(AudioVolumeNotificationData data)
    {
        if (Volatile.Read(ref _disposed) != 0) return;
        var s = Read(data);
        if (s == _state) return;
        _state = s;
        try { Changed?.Invoke(s); }
        catch (Exception ex) { _log?.Invoke($"Ses düzeyi bildirimi: {ex.Message}"); }
    }

    private VolumeState Read(AudioVolumeNotificationData? data)
    {
        double level;
        bool muted;
        try
        {
            level = data?.MasterVolume ?? _volume.MasterVolumeLevelScalar;
            muted = data?.Muted ?? _volume.Mute;
        }
        catch (Exception) { return VolumeState.Unavailable; }
        double db;
        try { db = _volume.MasterVolumeLevel; }
        catch (Exception) { db = VolumeState.ApproxDb(level); }
        return new VolumeState(true, Math.Round(level, 4), muted, Math.Round(db, 2));
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        try { _volume.OnVolumeNotification -= OnNotify; } catch { }
        if (_ownsDevice)
        {
            try { _device.Dispose(); } catch { }
        }
    }
}
