using Surround.Desktop.Bridge;
using Surround.Engine.Audio;
using Surround.Engine.Config;

namespace Surround.Engine.Tests;

public class AppBridgeTests
{
    private static string Temp() => Path.Combine(Path.GetTempPath(), "surround-test-" + Guid.NewGuid().ToString("N"), "config.json");

    private static void Write(string path, string json)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, json);
    }

    [Theory]
    [InlineData("""{ "speakers": null }""")]
    [InlineData("""{ "speakers": [null] }""")]
    [InlineData("""{ "source": null }""")]
    [InlineData("""{ "outputs": null, "speakers": [] }""")]
    [InlineData("""{ "outputs": [null, {"deviceId":"A"}] }""")]
    [InlineData("""{ "speakers": [ { "name": "x", "source": null, "outputDeviceId": null } ] }""")]
    [InlineData("""{ "source": { "deviceId": null, "mode": null }, "processing": null, "upmixOptions": null }""")]
    public void NullsInValidJsonAreNormalisedAndConfigLoads(string json)
    {
        var path = Temp();
        Write(path, json);
        var store = new ConfigStore(path);
        var cfg = store.Load();
        Assert.NotNull(cfg.Source);
        Assert.NotNull(cfg.Outputs);
        Assert.NotNull(cfg.Speakers);
        Assert.All(cfg.Speakers, s => { Assert.NotNull(s.Source); Assert.NotNull(s.OutputDeviceId); });
        Assert.Null(store.TakeNotice());
        // Engine-side helpers must not throw either.
        _ = cfg.ForRouting();
        _ = ConfigValidator.Validate(cfg);
        _ = cfg.EngineFingerprint();
        Directory.Delete(Path.GetDirectoryName(path)!, true);
    }

    [Fact]
    public void NumericStringsAreReadLeniently()
    {
        var cfg = SurroundConfig.Parse("""{ "speakers": [ { "name":"a", "deviceChannel": "2", "gainDb": "-3.5" } ] }""");
        Assert.Equal(2, cfg.Speakers[0].DeviceChannel);
        Assert.Equal(-3.5, cfg.Speakers[0].GainDb);
    }

    [Fact]
    public void BrokenFileIsBackedUpWithTimestampNotOverwrittenAndNoticeGivenOnce()
    {
        var path = Temp();
        string dir = Path.GetDirectoryName(path)!;
        Write(path, "{ not json");
        var store = new ConfigStore(path);
        store.Load();
        var n1 = store.TakeNotice();
        Assert.NotNull(n1);
        Assert.Matches(@"config\.bad-\d{8}-\d{6}\.json$", n1!.BackupPath);
        Assert.Equal("{ not json", File.ReadAllText(n1.BackupPath));
        Assert.Null(store.TakeNotice());

        // A second broken file must not clobber the first backup.
        Write(path, "[1,2");
        store.Load();
        var n2 = store.TakeNotice();
        Assert.NotNull(n2);
        Assert.NotEqual(n1.BackupPath, n2!.BackupPath);
        Assert.True(File.Exists(n1.BackupPath));
        Assert.Equal(2, Directory.GetFiles(dir, "config.bad-*").Length);
        Directory.Delete(dir, true);
    }

    [Fact]
    public void ResetToDefaultKeepsBackup()
    {
        var path = Temp();
        string dir = Path.GetDirectoryName(path)!;
        Write(path, """{ "speakers": [ { "name": "keep-me" } ] }""");
        var store = new ConfigStore(path);
        store.ResetToDefault();
        Assert.Single(Directory.GetFiles(dir, "config.bad-*"));
        Assert.Empty(store.Load().Speakers);
        Directory.Delete(dir, true);
    }

    [Fact]
    public void SinkStatusLabelsFollowRoutedConfigWhenSourceDeviceHostsSpeakers()
    {
        // Loopback source "SRC" also hosts a speaker; its output entry is dropped by ForRouting, so the engine's
        // sinks are [A, B] while the raw outputs are [SRC, A, B].
        var cfg = SurroundConfig.Parse("""
        {
          "source": { "deviceId": "SRC", "mode": "loopback" },
          "outputs": [ { "deviceId": "SRC" }, { "deviceId": "A" }, { "deviceId": "B" } ],
          "speakers": [
            { "name": "s", "outputDeviceId": "SRC", "deviceChannel": 1, "source": { "FL": 1 } },
            { "name": "a", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FR": 1 } },
            { "name": "b", "outputDeviceId": "B", "deviceChannel": 1, "source": { "BL": 1 } }
          ]
        }
        """);
        var sinks = new List<SinkStatus>
        {
            new("devA", 40, 0, 0, 0, 48000, 2),
            new("devB", 41, 0, 0, 0, 48000, 2),
        };
        var dtos = EngineHost.SinkDtos(sinks, cfg);
        Assert.Equal(new[] { "A", "B" }, dtos.Select(d => d.DeviceId).ToArray());
        Assert.Equal(41, dtos[1].FillMs);
    }
}
