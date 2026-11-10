using Surround.Engine.Config;

namespace Surround.Engine.Tests;

public class ProfileCatalogTests
{
    private const string Json = """
    {
      "source": { "deviceId": "SRC", "mode": "loopback" },
      "upmix": false,
      "upmixOptions": { "mode": "film", "centerDb": 0 },
      "processing": { "enabled": true, "preset": "flat", "eq": [0,0,0,0,0,0,0,0,0,0] },
      "outputs": [],
      "speakers": [],
      "activeProfileId": "builtin-film",
      "profiles": [
        { "id": "builtin-film", "name": "Film", "builtin": true,
          "processing": { "enabled": true, "preset": "film", "bassBoostDb": 4, "eq": [1,2,3] },
          "upmix": true, "upmixOptions": { "mode": "film", "centerDb": 2 } },
        { "id": "builtin-game", "name": "Oyun", "upmix": true, "upmixOptions": { "mode": "game" } },
        { "id": "broken" },
        { "id": "builtin-film", "name": "Kopya" },
        { "id": "u1", "name": "  Gece filmi için çok uzun bir profil adı  ", "processing": { "eq": "bozuk" } },
        42
      ]
    }
    """;

    [Fact]
    public void ListsValidProfilesInOrder()
    {
        var list = ProfileCatalog.List(SurroundConfig.Parse(Json));
        Assert.Equal(new[] { "builtin-film", "builtin-game", "u1" }, list.Select(p => p.Id));
        Assert.Equal("Film", list[0].Name);
        Assert.True(list[2].Name.Length <= 24);
        Assert.False(list[2].Name.StartsWith(' '));
    }

    [Fact]
    public void ActiveIdMustExist()
    {
        var cfg = SurroundConfig.Parse(Json);
        Assert.Equal("builtin-film", ProfileCatalog.ActiveId(cfg));
        cfg.Extra!["activeProfileId"] = System.Text.Json.JsonSerializer.SerializeToElement("gone");
        Assert.Null(ProfileCatalog.ActiveId(cfg));
        Assert.Empty(ProfileCatalog.List(SurroundConfig.Parse("""{ "source": { "deviceId": "x" } }""")));
    }

    [Fact]
    public void ApplyCopiesSettingsAndSurvivesRoundTrip()
    {
        var cfg = SurroundConfig.Parse(Json);
        Assert.True(ProfileCatalog.Apply(cfg, "builtin-film"));
        Assert.True(cfg.Upmix);
        Assert.Equal(2, cfg.UpmixOptions.CenterDb);
        Assert.Equal(4, cfg.Processing.BassBoostDb);
        Assert.Equal("film", cfg.Processing.Preset);
        Assert.Equal(ProcessingConfig.Bands, cfg.Processing.Eq.Length); // short EQ padded
        Assert.Equal(3, cfg.Processing.Eq[2]);

        // Partial profile: processing kept, upmix mode switched, active id saved and reloaded.
        Assert.True(ProfileCatalog.Apply(cfg, "builtin-game"));
        Assert.True(cfg.UpmixOptions.IsGame);
        Assert.Equal(4, cfg.Processing.BassBoostDb);
        var back = SurroundConfig.Parse(cfg.ToJson());
        Assert.Equal("builtin-game", ProfileCatalog.ActiveId(back));
        Assert.Equal(3, ProfileCatalog.List(back).Count);
    }

    [Fact]
    public void UnknownOrBrokenProfileLeavesConfigUntouched()
    {
        var cfg = SurroundConfig.Parse(Json);
        var before = cfg.ToJson();
        Assert.False(ProfileCatalog.Apply(cfg, "nope"));
        Assert.False(ProfileCatalog.Apply(cfg, "broken"));
        Assert.False(ProfileCatalog.Apply(cfg, "u1"));
        Assert.Equal(before, cfg.ToJson());
    }
}
