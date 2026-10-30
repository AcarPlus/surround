using Surround.Engine.Config;

namespace Surround.Engine.Tests;

public class ConfigTests
{
    private const string Json = """
    {
      // comments allowed
      "source": { "deviceId": "SRC", "mode": "loopback" },
      "upmix": true,
      "outputs": [
        { "deviceId": "A", "latencyMs": 10, "bufferMs": 40 },
        { "deviceId": "B", "latencyMs": 30 }
      ],
      "speakers": [
        { "name": "FL", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 1.0 } },
        { "name": "RL", "outputDeviceId": "B", "deviceChannel": 2, "source": { "BL": 1.0, "SL": 0.5 }, "delayMs": 5, "gainDb": -3 }
      ]
    }
    """;

    private sealed class FakeCatalog : IDeviceCatalog
    {
        public Dictionary<string, DeviceDescriptor> Devices = new(StringComparer.OrdinalIgnoreCase);
        public DeviceDescriptor? Find(string id) => Devices.GetValueOrDefault(id.Trim());
    }

    [Fact]
    public void ParsesAndValidates()
    {
        var cfg = SurroundConfig.Parse(Json);
        Assert.True(cfg.Upmix);
        Assert.Equal(40, cfg.Outputs[1].BufferMs);
        Assert.Equal(2, cfg.Speakers.Count);
        Assert.Empty(ConfigValidator.Validate(cfg));
    }

    [Fact]
    public void FeedbackGuardRejectsLoopbackSourceUsedAsOutput()
    {
        var cfg = SurroundConfig.Parse(Json);
        cfg.Outputs[0].DeviceId = " src ";
        cfg.Speakers[0].OutputDeviceId = "src";
        var errors = ConfigValidator.Validate(cfg);
        Assert.Contains(errors, e => e.Contains("geri besleme"));
    }

    [Fact]
    public void RejectsUnknownChannelNames()
    {
        var cfg = SurroundConfig.Parse(Json);
        cfg.Speakers[0].Source["XX"] = 1;
        Assert.Contains(ConfigValidator.Validate(cfg), e => e.Contains("XX"));
    }

    [Fact]
    public void RejectsSpeakerWithUnlistedOutput()
    {
        var cfg = SurroundConfig.Parse(Json);
        cfg.Speakers[0].OutputDeviceId = "ZZZ";
        Assert.NotEmpty(ConfigValidator.Validate(cfg));
    }

    [Fact]
    public void RejectsBadModeAndChannelZero()
    {
        var cfg = SurroundConfig.Parse(Json);
        cfg.Source.Mode = "weird";
        cfg.Speakers[1].DeviceChannel = 0;
        Assert.True(ConfigValidator.Validate(cfg).Count >= 2);
    }

    [Fact]
    public void EffectiveDelayCompensatesForLatency()
    {
        var cfg = SurroundConfig.Parse(Json);
        Assert.Equal(20, cfg.EffectiveDelayMs(cfg.Speakers[0]), 6); // (30-10)+0
        Assert.Equal(5, cfg.EffectiveDelayMs(cfg.Speakers[1]), 6);  // (30-30)+5
    }

    private static FakeCatalog GoodCatalog()
    {
        var c = new FakeCatalog();
        c.Devices["SRC"] = new("SRC", "Virtual", DeviceFlow.Render, 2, 48000);
        c.Devices["A"] = new("A", "Speakers A", DeviceFlow.Render, 2, 48000);
        c.Devices["B"] = new("B", "Speakers B", DeviceFlow.Render, 2, 48000);
        return c;
    }

    [Fact]
    public void DeviceCheckPassesForMatchingDevices() =>
        Assert.Empty(ConfigValidator.CheckDevices(SurroundConfig.Parse(Json), GoodCatalog()));

    [Fact]
    public void DeviceCheckReportsMissingDevice()
    {
        var cat = GoodCatalog();
        cat.Devices.Remove("B");
        Assert.Contains(ConfigValidator.CheckDevices(SurroundConfig.Parse(Json), cat), e => e.Contains("B"));
    }

    [Fact]
    public void DeviceCheckReportsChannelOutOfRange()
    {
        var cfg = SurroundConfig.Parse(Json);
        cfg.Speakers[1].DeviceChannel = 3;
        Assert.Contains(ConfigValidator.CheckDevices(cfg, GoodCatalog()), e => e.Contains("2 kanal"));
    }

    [Fact]
    public void DeviceCheckReportsWrongFlowForSource()
    {
        var cat = GoodCatalog();
        cat.Devices["SRC"] = new("SRC", "Mic", DeviceFlow.Capture, 2, 48000);
        Assert.NotEmpty(ConfigValidator.CheckDevices(SurroundConfig.Parse(Json), cat));
    }
}

public class ConfigRoundTripTests
{
    private const string UiJson = """
    {
      "source": { "deviceId": "SRC", "mode": "loopback", "futureFlag": true },
      "upmix": false,
      "outputs": [ { "deviceId": "A", "latencyMs": 0, "bufferMs": 40, "label": "salon" } ],
      "speakers": [
        { "id": "spk-1", "name": "Ön sol", "outputDeviceId": "A", "deviceChannel": 1,
          "source": { "FL": 1 }, "delayMs": 1.5, "gainDb": -2, "mute": false,
          "x": 0.75, "y": 1.2, "auto": { "delay": true, "gain": false } }
      ],
      "room": { "widthM": 5, "depthM": 4.5, "listener": { "x": 2.5, "y": 2.3 } }
    }
    """;

    [Fact]
    public void ExtraFieldsSurviveRoundTripAtEveryLevel()
    {
        var cfg = SurroundConfig.Parse(UiJson);
        var again = SurroundConfig.Parse(cfg.ToJson());
        using var doc = System.Text.Json.JsonDocument.Parse(again.ToJson());
        var root = doc.RootElement;

        Assert.Equal(4.5, root.GetProperty("room").GetProperty("depthM").GetDouble());
        Assert.Equal(2.3, root.GetProperty("room").GetProperty("listener").GetProperty("y").GetDouble());
        Assert.True(root.GetProperty("source").GetProperty("futureFlag").GetBoolean());
        Assert.Equal("salon", root.GetProperty("outputs")[0].GetProperty("label").GetString());
        var sp = root.GetProperty("speakers")[0];
        Assert.Equal("spk-1", sp.GetProperty("id").GetString());
        Assert.Equal(0.75, sp.GetProperty("x").GetDouble());
        Assert.False(sp.GetProperty("auto").GetProperty("gain").GetBoolean());
        // known fields are still written once, camelCase
        Assert.Equal(1.5, sp.GetProperty("delayMs").GetDouble());
    }

    [Fact]
    public void ExtraFieldsDoNotAffectValidation()
    {
        Assert.Empty(ConfigValidator.Validate(SurroundConfig.Parse(UiJson)));
    }

    [Fact]
    public void ConfigWithoutExtrasHasNoExtraKeys()
    {
        var cfg = SurroundConfig.Parse("""{ "source": { "deviceId": "S" } }""");
        using var doc = System.Text.Json.JsonDocument.Parse(cfg.ToJson());
        Assert.False(doc.RootElement.TryGetProperty("extra", out _));
        Assert.False(doc.RootElement.TryGetProperty("room", out _));
    }

    [Fact]
    public void FingerprintIgnoresUiFieldsButNotEngineFields()
    {
        var a = SurroundConfig.Parse(UiJson);
        var b = SurroundConfig.Parse(UiJson.Replace("\"x\": 0.75", "\"x\": 3.1").Replace("\"widthM\": 5", "\"widthM\": 9"));
        Assert.Equal(a.EngineFingerprint(), b.EngineFingerprint());

        var c = SurroundConfig.Parse(UiJson.Replace("\"delayMs\": 1.5", "\"delayMs\": 2.5"));
        Assert.NotEqual(a.EngineFingerprint(), c.EngineFingerprint());
    }
}
