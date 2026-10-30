using Surround.Engine.Audio;
using Surround.Engine.Config;

namespace Surround.Engine.Tests;

public class DefaultDeviceGuardTests : IDisposable
{
    private sealed class FakeSwitcher : IDefaultDeviceSwitcher
    {
        public Dictionary<DeviceRole, string?> Defaults = new()
        {
            [DeviceRole.Console] = "SPK", [DeviceRole.Multimedia] = "SPK", [DeviceRole.Communications] = "HEAD",
        };
        public HashSet<string> Existing = new() { "SPK", "HEAD", "CABLE" };
        public bool FailSet;
        public int SetCalls;

        public string? GetDefaultRender(DeviceRole role) => Defaults[role];
        public bool RenderDeviceExists(string id) => Existing.Contains(id);
        public void SetDefaultRender(string id, DeviceRole role)
        {
            SetCalls++;
            if (FailSet) throw new InvalidOperationException("COM failed");
            Defaults[role] = id;
        }
    }

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "surround-test-" + Guid.NewGuid().ToString("N"));
    private readonly FakeSwitcher _sw = new();
    private readonly AppSettingsStore _store;
    private readonly List<string> _log = new();

    public DefaultDeviceGuardTests() => _store = new AppSettingsStore(Path.Combine(_dir, "app.json"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch { }
    }

    private DefaultDeviceGuard Guard() => new(_sw, _store, _log.Add);

    [Fact]
    public void EngageSwitchesAllRolesAndRestoreBringsBackEach()
    {
        var g = Guard();
        Assert.True(g.Engage("CABLE"));
        Assert.All(_sw.Defaults.Values, v => Assert.Equal("CABLE", v));
        Assert.Equal("SPK", _store.Load().RestoreDeviceId);

        g.Restore();
        Assert.Equal("SPK", _sw.Defaults[DeviceRole.Console]);
        Assert.Equal("SPK", _sw.Defaults[DeviceRole.Multimedia]);
        Assert.Equal("HEAD", _sw.Defaults[DeviceRole.Communications]); // communications default is preserved separately
        Assert.Null(_store.Load().RestoreDeviceId);
    }

    [Fact]
    public void EngageIsIdempotentAndKeepsTheFirstRememberedDevice()
    {
        var g = Guard();
        g.Engage("CABLE");
        int calls = _sw.SetCalls;
        g.Engage("CABLE"); // engine restart
        Assert.Equal(calls, _sw.SetCalls);
        Assert.Equal("SPK", _store.Load().RestoreDeviceId);

        _sw.Existing.Add("CABLE2");
        g.Engage("CABLE2"); // source changed while running
        Assert.Equal("CABLE2", _sw.Defaults[DeviceRole.Multimedia]);
        Assert.Equal("SPK", _store.Load().RestoreDeviceId);
        g.Restore();
        Assert.Equal("SPK", _sw.Defaults[DeviceRole.Multimedia]);
    }

    [Fact]
    public void SourceAlreadyDefaultRemembersNothing()
    {
        _sw.Defaults[DeviceRole.Multimedia] = "CABLE";
        _sw.Defaults[DeviceRole.Console] = "CABLE";
        _sw.Defaults[DeviceRole.Communications] = "CABLE";
        var g = Guard();
        Assert.True(g.Engage("CABLE"));
        Assert.Equal(0, _sw.SetCalls);
        Assert.Null(_store.Load().RestoreDeviceId);
        g.Restore();
        Assert.Equal(0, _sw.SetCalls);
    }

    [Fact]
    public void RestoreSkipsAMissingDevice()
    {
        var g = Guard();
        g.Engage("CABLE");
        _sw.Existing.Remove("SPK");
        g.Restore();
        Assert.Equal("CABLE", _sw.Defaults[DeviceRole.Multimedia]); // nothing to restore to
        Assert.Null(_store.Load().RestoreDeviceId);                 // and the memory is dropped, not retried forever
    }

    [Fact]
    public void RestoreLeavesRolesTheUserChangedMeanwhile()
    {
        var g = Guard();
        g.Engage("CABLE");
        _sw.Defaults[DeviceRole.Multimedia] = "HEAD"; // user picked something else
        g.Restore();
        Assert.Equal("HEAD", _sw.Defaults[DeviceRole.Multimedia]);
        Assert.Equal("SPK", _sw.Defaults[DeviceRole.Console]);
    }

    [Fact]
    public void CrashRecoveryRestoresFromAFreshGuardInstance()
    {
        Guard().Engage("CABLE");          // "process 1", then it dies without restoring
        var next = Guard();               // next launch, same app.json
        Assert.True(next.HasPending);
        next.RestoreIfPending();
        Assert.Equal("SPK", _sw.Defaults[DeviceRole.Multimedia]);
        Assert.False(next.HasPending);
        next.RestoreIfPending();          // second call is a no-op
    }

    [Fact]
    public void ComFailuresAreLoggedNotThrown()
    {
        _sw.FailSet = true;
        var g = Guard();
        Assert.False(g.Engage("CABLE"));
        Assert.NotEmpty(_log);
        g.Restore(); // must not throw either
    }
}

public class AppSettingsTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "surround-test-" + Guid.NewGuid().ToString("N"));
    public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    [Fact]
    public void DefaultsWhenFileMissing()
    {
        var s = new AppSettingsStore(Path.Combine(_dir, "app.json")).Load();
        Assert.True(s.SwitchDefaultDevice);
        Assert.False(s.StartWithWindows);
        Assert.False(s.StartEngineOnLaunch);
        Assert.True(s.MinimizeToTray);
        Assert.Null(s.RestoreDeviceId);
    }

    [Fact]
    public void RoundTripAndCamelCaseOnDisk()
    {
        var path = Path.Combine(_dir, "app.json");
        var store = new AppSettingsStore(path);
        store.Save(new AppSettings { SwitchDefaultDevice = false, StartWithWindows = true, StartEngineOnLaunch = true, MinimizeToTray = false, RestoreDeviceId = "X" });
        var s = new AppSettingsStore(path).Load();
        Assert.False(s.SwitchDefaultDevice);
        Assert.True(s.StartWithWindows);
        Assert.True(s.StartEngineOnLaunch);
        Assert.False(s.MinimizeToTray);
        Assert.Equal("X", s.RestoreDeviceId);
        var text = File.ReadAllText(path);
        Assert.Contains("\"switchDefaultDevice\"", text);
        Assert.DoesNotContain("restoreCommunicationsId", text); // nulls are omitted
    }

    [Fact]
    public void UserSettingsKeepBookkeeping()
    {
        var s = new AppSettings { RestoreDeviceId = "X", TrayHintShown = true };
        var merged = s.WithUserSettings(new AppSettings { SwitchDefaultDevice = false, MinimizeToTray = false });
        Assert.False(merged.SwitchDefaultDevice);
        Assert.Equal("X", merged.RestoreDeviceId);
        Assert.True(merged.TrayHintShown);
    }

    [Fact]
    public void BrokenFileFallsBackToDefaultsAndIsKept()
    {
        Directory.CreateDirectory(_dir);
        var path = Path.Combine(_dir, "app.json");
        File.WriteAllText(path, "{ not json");
        var s = new AppSettingsStore(path).Load();
        Assert.True(s.SwitchDefaultDevice);
        Assert.True(File.Exists(path + ".bad"));
    }
}
