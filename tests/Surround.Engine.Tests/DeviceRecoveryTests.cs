using Surround.Engine.Audio;
using Surround.Engine.Config;

namespace Surround.Engine.Tests;

public class DeviceRecoveryTests
{
    private static DeviceProbe Up(string id, int ch = 2, int rate = 48000) => new(id, "Cihaz " + id, true, ch, rate);
    private static DeviceProbe Gone(string id, string? name = null) => new(id, name, false);

    private static DeviceRecovery Running(long now = 0, params DeviceProbe[] devices)
    {
        var r = new DeviceRecovery();
        r.Started(devices.Length > 0 ? devices : new[] { Up("SRC", 8), Up("A"), Up("B") }, now);
        return r;
    }

    [Fact]
    public void RequiredIds_are_source_and_routed_outputs()
    {
        var cfg = SurroundConfig.Parse("""
        {
          "source": { "deviceId": "CABLE", "mode": "loopback" },
          "outputs": [ { "deviceId": "A" }, { "deviceId": "B" }, { "deviceId": "CABLE" }, { "deviceId": "UNUSED" } ],
          "speakers": [
            { "name": "FL", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 1 } },
            { "name": "FR", "outputDeviceId": " a ", "deviceChannel": 2, "source": { "FR": 1 } },
            { "name": "BL", "outputDeviceId": "B", "deviceChannel": 1, "source": { "BL": 1 } },
            { "name": "On source", "outputDeviceId": "CABLE", "deviceChannel": 1, "source": { "FC": 1 } }
          ]
        }
        """);
        Assert.Equal(new[] { "CABLE", "A", "B" }, DeviceRecovery.RequiredIds(cfg));
    }

    [Fact]
    public void Stopped_ignores_everything()
    {
        var r = new DeviceRecovery();
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Gone("A") }, streamFailed: true, deviceEvent: true, 0));
        Assert.Equal(RecoveryState.Stopped, r.State);
        Assert.Null(r.NextCheckAt);
    }

    [Fact]
    public void Running_with_all_devices_unchanged_does_nothing()
    {
        var r = Running();
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8), Up("A"), Up("B") }, false, true, 500));
        Assert.Equal(RecoveryState.Running, r.State);
        Assert.Equal(new[] { "SRC", "A", "B" }, r.Watched);
    }

    [Fact]
    public void Missing_output_stops_and_waits_until_it_has_been_back_for_the_debounce()
    {
        var r = Running();
        Assert.Equal(RecoveryAction.Stop, r.Evaluate(new[] { Up("SRC", 8), Gone("A"), Up("B") }, false, true, 1000));
        Assert.Equal(RecoveryState.Waiting, r.State);
        Assert.Equal(new[] { "Cihaz A" }, r.Missing); // name remembered from the start
        Assert.Null(r.Message);
        Assert.Equal(1000 + DeviceRecovery.PollMs, r.NextCheckAt); // polled in case a notification is missed

        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8), Gone("A"), Up("B") }, false, false, 2000));

        // Back at 5000: debounce starts, restart at 6000.
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8), Up("A"), Up("B") }, false, true, 5000));
        Assert.Empty(r.Missing);
        Assert.Equal(6000, r.NextCheckAt);
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8), Up("A"), Up("B") }, false, false, 5999));
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(new[] { Up("SRC", 8), Up("A"), Up("B") }, false, false, 6000));
        Assert.Equal(RecoveryState.Waiting, r.State); // until the host reports back

        r.Started(new[] { Up("SRC", 8), Up("A"), Up("B") }, 6100);
        Assert.Equal(RecoveryState.Running, r.State);
        Assert.Null(r.NextCheckAt);
    }

    [Fact]
    public void Device_events_during_the_debounce_restart_it()
    {
        var r = Running();
        r.Evaluate(new[] { Gone("SRC"), Up("A"), Up("B") }, false, true, 0);
        var all = new[] { Up("SRC", 8), Up("A"), Up("B") };
        Assert.Equal(RecoveryAction.None, r.Evaluate(all, false, true, 100));
        Assert.Equal(RecoveryAction.None, r.Evaluate(all, false, true, 900)); // flapping: debounce from 900
        Assert.Equal(RecoveryAction.None, r.Evaluate(all, false, false, 1500));
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(all, false, false, 1900));
    }

    [Fact]
    public void Device_lost_again_while_debouncing_waits_again()
    {
        var r = Running();
        r.Evaluate(new[] { Up("SRC", 8), Gone("A"), Up("B") }, false, true, 0);
        r.Evaluate(new[] { Up("SRC", 8), Up("A"), Up("B") }, false, true, 100);
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8), Gone("A"), Up("B") }, false, true, 600));
        Assert.Equal(new[] { "Cihaz A" }, r.Missing);
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8), Gone("A"), Up("B") }, false, false, 1200));
    }

    [Fact]
    public void Stream_failure_with_devices_present_stops_then_restarts_after_debounce()
    {
        var r = Running();
        var all = new[] { Up("SRC", 8), Up("A"), Up("B") };
        Assert.Equal(RecoveryAction.Stop, r.Evaluate(all, streamFailed: true, deviceEvent: false, 20_000));
        Assert.Empty(r.Missing);
        Assert.NotNull(r.Message);
        Assert.Equal(21_000, r.NextCheckAt);
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(all, false, false, 21_000));
    }

    [Fact]
    public void Format_change_of_a_required_device_restarts_but_an_identical_or_unreadable_format_does_not()
    {
        var r = Running();
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8), Up("A"), Up("B") }, false, true, 10)); // spurious event
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 0, 0), Up("A"), Up("B") }, false, true, 20)); // mix format busy
        Assert.Equal(RecoveryAction.Stop, r.Evaluate(new[] { Up("SRC", 2), Up("A"), Up("B") }, false, true, 30)); // 7.1 -> stereo
        Assert.Equal(RecoveryState.Waiting, r.State);
        Assert.Contains("biçim", r.Message);

        var r2 = Running();
        Assert.Equal(RecoveryAction.Stop, r2.Evaluate(new[] { Up("SRC", 8), Up("A", 2, 44100), Up("B") }, false, true, 30)); // rate
    }

    [Fact]
    public void Failed_restarts_back_off_up_to_the_cap_and_a_returning_device_resets_it()
    {
        var r = Running();
        var all = new[] { Up("SRC", 8), Up("A"), Up("B") };
        r.Evaluate(all, true, false, 0);
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(all, false, false, 1000));

        r.RestartFailed("Motor başlatılamadı: meşgul", 1000);
        Assert.Equal("Motor başlatılamadı: meşgul", r.Message);
        Assert.Equal(2000, r.RetryMs);
        Assert.Equal(3000, r.NextCheckAt);
        Assert.Equal(RecoveryAction.None, r.Evaluate(all, false, false, 2999));
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(all, false, false, 3000));

        long now = 3000;
        for (int i = 0; i < 10; i++) { r.RestartFailed("x", now); now += r.RetryMs; }
        Assert.Equal(DeviceRecovery.MaxRetryMs, r.RetryMs);

        // The device really goes away and comes back: plain debounce again.
        r.Evaluate(new[] { Up("SRC", 8), Gone("A"), Up("B") }, false, true, now);
        Assert.Equal(DeviceRecovery.DefaultDebounceMs, r.RetryMs);
        r.Evaluate(all, false, true, now + 10);
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(all, false, false, now + 10 + DeviceRecovery.DefaultDebounceMs));
    }

    [Fact]
    public void Auto_restarted_engine_failing_again_quickly_backs_off_but_a_stable_run_resets()
    {
        var r = Running();
        var all = new[] { Up("SRC", 8), Up("A"), Up("B") };
        r.Evaluate(all, true, false, 0);
        r.Evaluate(all, false, false, 1000);
        r.Started(all, 1000); // automatic restart

        Assert.Equal(RecoveryAction.Stop, r.Evaluate(all, true, false, 3000)); // failed again after 2 s
        Assert.Equal(2000, r.RetryMs);
        r.Evaluate(all, false, false, 5000);
        r.Started(all, 5000);

        Assert.Equal(RecoveryAction.Stop, r.Evaluate(all, true, false, 5000 + DeviceRecovery.StableMs + 1));
        Assert.Equal(DeviceRecovery.DefaultDebounceMs, r.RetryMs);
    }

    [Fact]
    public void Stopped_clears_waiting_and_a_user_start_resets_backoff()
    {
        var r = Running();
        r.Evaluate(new[] { Gone("SRC"), Up("A"), Up("B") }, false, true, 0);
        r.Stopped();
        Assert.Equal(RecoveryState.Stopped, r.State);
        Assert.Empty(r.Missing);
        Assert.Null(r.NextCheckAt);
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8) }, false, false, 99_000));
    }

    [Fact]
    public void Missing_device_names_fall_back_to_the_remembered_name_then_a_generic_label()
    {
        var r = Running(0, Up("SRC", 8), Up("A"));
        r.Evaluate(new[] { Gone("SRC"), Gone("A", "Hoparlör (USB)"), Gone("NEW") }, false, true, 0);
        Assert.Equal(new[] { "Cihaz SRC", "Hoparlör (USB)", DeviceRecovery.UnknownDeviceName }, r.Missing);
    }

    [Fact]
    public void Missing_device_uses_the_name_saved_in_the_config()
    {
        var cfg = SurroundConfig.Parse("""
        { "source": { "deviceId": "SRC", "deviceName": "Kaynak" },
          "outputs": [ { "deviceId": "USB1", "deviceName": "USB Hoparlör" } ] }
        """);
        var r = new DeviceRecovery(0);
        r.SeedNames(cfg);
        r.WaitForDevices(new[] { Gone("SRC"), Gone("USB1"), Gone("ZZZ") }, 0);
        Assert.Equal(new[] { "Kaynak", "USB Hoparlör", DeviceRecovery.UnknownDeviceName }, r.Missing);
    }

    [Fact]
    public void Waiting_uses_the_required_set_it_is_given()
    {
        // While waiting the host passes the devices of the saved config: removing the missing device's speakers lets it restart.
        var r = Running();
        r.Evaluate(new[] { Up("SRC", 8), Up("A"), Gone("B") }, false, true, 0);
        var withoutB = new[] { Up("SRC", 8), Up("A") };
        Assert.Equal(RecoveryAction.None, r.Evaluate(withoutB, false, false, 100));
        Assert.Empty(r.Missing);
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(withoutB, false, false, 1100));
    }

    // ---- start-up with missing devices ----

    [Fact]
    public void PlanStart_waits_for_missing_devices_and_fails_on_config_errors()
    {
        var none = Array.Empty<string>();
        Assert.Equal(StartDecision.Start, DeviceRecovery.PlanStart(none, new[] { Up("SRC", 8), Up("A") }));
        Assert.Equal(StartDecision.Wait, DeviceRecovery.PlanStart(none, new[] { Up("SRC", 8), Gone("A") }));
        Assert.Equal(StartDecision.Wait, DeviceRecovery.PlanStart(none, new[] { Gone("SRC"), Up("A") }));
        // A genuine non-device error stays an error, even with a device missing.
        Assert.Equal(StartDecision.Fail, DeviceRecovery.PlanStart(new[] { "Hoparlör yok" }, Array.Empty<DeviceProbe>()));
        Assert.Equal(StartDecision.Fail, DeviceRecovery.PlanStart(new[] { "x" }, new[] { Gone("A") }));
    }

    [Fact]
    public void Start_with_missing_output_waits_then_restarts_when_it_appears_then_runs()
    {
        var r = new DeviceRecovery();
        r.WaitForDevices(new[] { Up("SRC", 8), Gone("A", "USB Hoparlör") }, 0);
        Assert.Equal(RecoveryState.Waiting, r.State);
        Assert.Equal(new[] { "USB Hoparlör" }, r.Missing);
        Assert.NotNull(r.NextCheckAt);

        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8), Gone("A", "USB Hoparlör") }, false, false, 3000));
        Assert.Equal(RecoveryState.Waiting, r.State);

        // The device appears: restart only after the debounce.
        var all = new[] { Up("SRC", 8), Up("A") };
        Assert.Equal(RecoveryAction.None, r.Evaluate(all, false, true, 4000));
        Assert.Empty(r.Missing);
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(all, false, false, 4000 + DeviceRecovery.DefaultDebounceMs));

        r.Started(all, 5500);
        Assert.Equal(RecoveryState.Running, r.State);
        Assert.Equal(new[] { "SRC", "A" }, r.Watched);
    }

    [Fact]
    public void Start_with_missing_source_waits_the_same_way()
    {
        var r = new DeviceRecovery();
        r.WaitForDevices(new[] { Gone("SRC", "CABLE Input"), Up("A") }, 0);
        Assert.Equal(new[] { "CABLE Input" }, r.Missing);
        var all = new[] { Up("SRC", 8), Up("A") };
        Assert.Equal(RecoveryAction.None, r.Evaluate(all, false, true, 1000));
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(all, false, false, 2000));
    }

    [Fact]
    public void Stop_cancels_waiting_that_began_at_start()
    {
        var r = new DeviceRecovery();
        r.WaitForDevices(new[] { Up("SRC", 8), Gone("A") }, 0);
        r.Stopped();
        Assert.Equal(RecoveryState.Stopped, r.State);
        Assert.Empty(r.Missing);
        Assert.Null(r.NextCheckAt);
        Assert.Equal(RecoveryAction.None, r.Evaluate(new[] { Up("SRC", 8), Up("A") }, false, true, 10_000));
    }

    [Fact]
    public void Failed_restart_after_a_start_wait_backs_off_like_the_running_case()
    {
        var r = new DeviceRecovery();
        r.WaitForDevices(new[] { Up("SRC", 8), Gone("A") }, 0);
        var all = new[] { Up("SRC", 8), Up("A") };
        r.Evaluate(all, false, true, 1000);
        Assert.Equal(RecoveryAction.Restart, r.Evaluate(all, false, false, 2000));
        r.RestartFailed("Motor başlatılamadı: meşgul", 2000);
        Assert.Equal(RecoveryState.Waiting, r.State);
        Assert.Equal(2000, r.RetryMs);
        Assert.Equal("Motor başlatılamadı: meşgul", r.Message);
    }

    private const string TwoOutputs = """
    { "source": { "deviceId": "SRC", "mode": "loopback" },
      "outputs": [ { "deviceId": "A" }, { "deviceId": "B" } ],
      "speakers": [
        { "name": "a", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 1 } },
        { "name": "b", "outputDeviceId": "B", "deviceChannel": 1, "source": { "FR": 1 } } ] }
    """;

    [Fact]
    public void WithoutMissing_drops_speakers_and_outputs_on_absent_devices_only()
    {
        var cfg = SurroundConfig.Parse(TwoOutputs);
        var r = DeviceRecovery.WithoutMissing(cfg, new[] { Up("SRC", 8), Up("A"), Gone("B") }, out var dropped);
        Assert.NotNull(r);
        Assert.Equal(new[] { "b" }, dropped);
        Assert.Equal(new[] { "a" }, r!.Speakers.Select(s => s.Name).ToArray());
        Assert.Equal(new[] { "A" }, r.Outputs.Select(o => o.DeviceId).ToArray());
        Assert.Equal(2, cfg.Speakers.Count); // the saved config is untouched
    }

    [Fact]
    public void WithoutMissing_gives_the_missing_speakers_share_back_to_the_others()
    {
        // "Konuma göre dağıt" with a center that shares the fronts; the center's device is gone. The remaining fronts
        // must carry FL/FR at full power again (0.793 → 1, 0.956 → 1), the surrounds stay as they were.
        var cfg = SurroundConfig.Parse("""
        { "source": { "deviceId": "SRC", "mode": "loopback" },
          "outputs": [ { "deviceId": "A" }, { "deviceId": "B" } ],
          "speakers": [
            { "name": "l", "outputDeviceId": "A", "deviceChannel": 1, "source": { "FL": 0.793, "SL": 1, "BL": 1 } },
            { "name": "r", "outputDeviceId": "A", "deviceChannel": 2, "source": { "FR": 0.956, "SR": 1, "BR": 1 } },
            { "name": "c", "outputDeviceId": "B", "deviceChannel": 1, "source": { "FL": 0.609, "FC": 1, "FR": 0.294 } } ] }
        """);
        var r = DeviceRecovery.WithoutMissing(cfg, new[] { Up("SRC", 8), Up("A"), Gone("B") }, out _)!;
        var l = r.Speakers.Single(s => s.Name == "l").Source;
        var rt = r.Speakers.Single(s => s.Name == "r").Source;
        Assert.Equal(1.0, l["FL"], 2);
        Assert.Equal(1.0, rt["FR"], 2);
        Assert.Equal(1.0, l["SL"]);
        Assert.Equal(1.0, rt["BR"]);
        Assert.Equal(0.793, cfg.Speakers[0].Source["FL"]); // the saved config is untouched

        // A muted speaker is the user's choice, not a missing device: nothing is redistributed for it.
        cfg.Speakers[2].Mute = true;
        r = DeviceRecovery.WithoutMissing(cfg, new[] { Up("SRC", 8), Up("A"), Gone("B") }, out _)!;
        Assert.Equal(0.793, r.Speakers.Single(s => s.Name == "l").Source["FL"]);
    }

    [Fact]
    public void WithoutMissing_is_impossible_without_source_or_without_any_playing_speaker()
    {
        var cfg = SurroundConfig.Parse(TwoOutputs);
        Assert.Null(DeviceRecovery.WithoutMissing(cfg, new[] { Gone("SRC"), Up("A"), Up("B") }, out _));
        Assert.Null(DeviceRecovery.WithoutMissing(cfg, new[] { Up("SRC", 8), Gone("A"), Gone("B") }, out _));
    }

    // --- Started without missing devices: rejoin when they return ---

    private static DeviceRecovery Degraded(long now = 0)
    {
        var r = new DeviceRecovery(debounceMs: 1000);
        r.Started(new[] { Up("SRC", 8), Up("A") }, now, new[] { Gone("B", "Sağ hoparlör") });
        return r;
    }

    private static DeviceProbe[] Probes(DeviceProbe b) => new[] { Up("SRC", 8), Up("A"), b };

    [Fact]
    public void Degraded_start_watches_the_left_out_device_and_polls()
    {
        var r = Degraded(100);
        Assert.Equal(new[] { "B" }, r.RejoinIds);
        Assert.Equal(100 + DeviceRecovery.PollMs, r.NextCheckAt);
    }

    [Fact]
    public void Degraded_absent_device_is_not_a_failure()
    {
        var r = Degraded();
        Assert.Equal(RecoveryAction.None, r.Evaluate(Probes(Gone("B")), false, true, 500));
        Assert.Equal(RecoveryState.Running, r.State);
    }

    [Fact]
    public void Degraded_device_back_rejoins_after_debounce()
    {
        var r = Degraded();
        Assert.Equal(RecoveryAction.None, r.Evaluate(Probes(Up("B")), false, true, 5000));
        Assert.Equal(RecoveryState.Running, r.State);
        Assert.Equal(6000, r.NextCheckAt);
        Assert.Equal(RecoveryAction.Rejoin, r.Evaluate(Probes(Up("B")), false, false, 6000));
        Assert.Equal(new[] { "Cihaz B" }, r.Rejoined);
        Assert.Equal(RecoveryState.Waiting, r.State);
        Assert.Empty(r.RejoinIds);
    }

    [Fact]
    public void Degraded_device_flapping_restarts_the_debounce()
    {
        var r = Degraded();
        r.Evaluate(Probes(Up("B")), false, true, 5000);
        Assert.Equal(RecoveryAction.None, r.Evaluate(Probes(Up("B")), false, true, 5800));
        Assert.Equal(RecoveryAction.None, r.Evaluate(Probes(Up("B")), false, false, 6500));
        Assert.Equal(RecoveryAction.Rejoin, r.Evaluate(Probes(Up("B")), false, false, 6800));
    }

    [Fact]
    public void Degraded_device_gone_again_resets_pending_rejoin()
    {
        var r = Degraded();
        r.Evaluate(Probes(Up("B")), false, true, 5000);
        Assert.Equal(RecoveryAction.None, r.Evaluate(Probes(Gone("B")), false, true, 5500));
        Assert.Equal(RecoveryAction.None, r.Evaluate(Probes(Up("B")), false, true, 7000));
        Assert.Equal(RecoveryAction.Rejoin, r.Evaluate(Probes(Up("B")), false, false, 8000));
    }

    [Fact]
    public void Degraded_real_failure_still_stops()
    {
        var r = Degraded();
        Assert.Equal(RecoveryAction.Stop, r.Evaluate(new[] { Up("SRC", 8), Gone("A"), Gone("B") }, false, true, 500));
        Assert.Empty(r.RejoinIds);
    }

    [Fact]
    public void Normal_start_never_rejoins()
    {
        var r = Running();
        Assert.Empty(r.RejoinIds);
        Assert.Null(r.NextCheckAt);
    }
}
