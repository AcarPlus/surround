using System.Collections.Concurrent;
using System.Diagnostics;
using Surround.Engine;
using Surround.Engine.Config;

namespace Surround.Desktop.Bridge;

public sealed record SinkStatusDto(string DeviceId, double FillMs, double CorrPpm, long Underruns, long Overruns);

/// <summary>Engine-wide state for the UI. <paramref name="Upmix"/>: "off" | "stereo" | "native".</summary>
public sealed record EngineInfoDto(string Upmix, int SourceChannels, int SourceRate, double UpmixLatencyMs);

/// <summary>
/// Owns the audio engine on a dedicated (MTA) thread. All engine creation/disposal happens there, and the
/// same thread samples status (~250 ms) and peak levels (~20 Hz) while the engine runs, so the engine is never
/// touched concurrently. Events are raised on that thread; subscribers must marshal as needed.
/// </summary>
public sealed class EngineHost : IDisposable
{
    private const int LevelPeriodMs = 50;
    private const int StatusPeriodMs = 250;

    private readonly ConcurrentQueue<Action> _commands = new();
    private readonly AutoResetEvent _wake = new(false);
    private readonly Thread _thread;
    private volatile bool _quit;

    // Worker-thread state
    private SurroundEngine? _engine;
    private SurroundConfig? _config;

    private volatile bool _running;
    private volatile IReadOnlyList<SinkStatusDto> _lastStatus = Array.Empty<SinkStatusDto>();

    public event Action<IReadOnlyList<SinkStatusDto>>? StatusChanged;
    /// <summary>Raised with every status sample (and once with "off" on stop).</summary>
    public event Action<EngineInfoDto>? InfoChanged;
    /// <summary>dBFS per logical channel, FL..SR order, -90 floor.</summary>
    public event Action<float[]>? LevelsChanged;
    public event Action<string>? Error;

    public EngineHost()
    {
        _thread = new Thread(Run) { Name = "Surround.Engine", IsBackground = true };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
    }

    public bool IsRunning => _running;

    /// <summary>Lets other components (e.g. tone playback) surface a failure through the same channel.</summary>
    public void ReportError(string message) => Error?.Invoke(message);

    public IReadOnlyList<SinkStatusDto> LastStatus => _running ? _lastStatus : Array.Empty<SinkStatusDto>();

    /// <summary>Starts the engine, or restarts it with the new config if already running.</summary>
    public Task StartAsync(SurroundConfig cfg) => Enqueue(() => StartCore(cfg));

    public Task StopAsync() => Enqueue(StopCore);

    /// <summary>Applies processing / speaker EQ changes to the running engine without a restart (no-op when stopped).</summary>
    public Task UpdateLiveAsync(SurroundConfig cfg) => Enqueue(() =>
    {
        if (_engine is null) return;
        _engine.UpdateLive(cfg);
        _config = cfg;
    });

    private Task Enqueue(Action action)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if (_quit) { tcs.SetResult(); return tcs.Task; }
        _commands.Enqueue(() =>
        {
            try { action(); tcs.SetResult(); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        _wake.Set();
        return tcs.Task;
    }

    // ---- worker thread ----

    private void Run()
    {
        var sw = Stopwatch.StartNew();
        long nextLevels = 0, nextStatus = 0;
        while (!_quit)
        {
            _wake.WaitOne(LevelPeriodMs);
            while (_commands.TryDequeue(out var cmd)) cmd();
            if (_quit) break;

            if (_engine is null) continue;
            long now = sw.ElapsedMilliseconds;
            try
            {
                if (now >= nextLevels)
                {
                    nextLevels = now + LevelPeriodMs;
                    var db = new float[Channels.Count];
                    _engine.DrainLevels(db);
                    LevelsChanged?.Invoke(db);
                }
                if (now >= nextStatus)
                {
                    nextStatus = now + StatusPeriodMs;
                    var st = Snapshot(_engine, _config!, out var info);
                    _lastStatus = st;
                    StatusChanged?.Invoke(st);
                    InfoChanged?.Invoke(info);
                }
            }
            catch (Exception ex)
            {
                Error?.Invoke($"Durum okunamadı: {ex.Message}");
            }
        }
        StopCore();
    }

    private void StartCore(SurroundConfig cfg)
    {
        var previous = _config;
        bool wasRunning = _engine is not null;
        if (wasRunning) StopCore();

        try
        {
            _engine = CreateAndStart(cfg);
            _config = cfg;
            _running = true;
        }
        catch
        {
            _engine = null;
            _config = null;
            _running = false;
            // A failed restart must not leave the user in silence: fall back to the previous working config.
            if (wasRunning && previous is not null)
            {
                try
                {
                    _engine = CreateAndStart(previous);
                    _config = previous;
                    _running = true;
                    Error?.Invoke("Yeni yapılandırma başlatılamadı; önceki yapılandırmayla devam ediliyor.");
                }
                catch { _engine = null; _config = null; }
            }
            throw;
        }
    }

    private SurroundEngine CreateAndStart(SurroundConfig cfg)
    {
        var engine = new SurroundEngine(cfg, msg =>
        {
            if (msg.StartsWith("Uyarı", StringComparison.Ordinal)) Error?.Invoke(msg);
        });
        engine.Error += msg => Error?.Invoke(msg);
        engine.Start();
        return engine;
    }

    private void StopCore()
    {
        var engine = _engine;
        _engine = null;
        _config = null;
        _running = false;
        _lastStatus = Array.Empty<SinkStatusDto>();
        if (engine is null) return;
        try { engine.Dispose(); }
        catch (Exception ex) { Error?.Invoke($"Motor durdurulurken hata: {ex.Message}"); }
        // One last all-silent frame so the meters fall to the floor.
        var floor = new float[Channels.Count];
        Array.Fill(floor, -90f);
        LevelsChanged?.Invoke(floor);
        StatusChanged?.Invoke(Array.Empty<SinkStatusDto>());
        InfoChanged?.Invoke(new EngineInfoDto("off", 0, 0, 0));
    }

    private static IReadOnlyList<SinkStatusDto> Snapshot(SurroundEngine engine, SurroundConfig cfg, out EngineInfoDto info)
    {
        var st = engine.GetStatus();
        string up = st.UpmixState switch
        {
            Surround.Engine.Dsp.UpmixState.Stereo => "stereo",
            Surround.Engine.Dsp.UpmixState.Native => "native",
            _ => "off",
        };
        info = new EngineInfoDto(up, st.SourceChannels, st.SourceRate,
            st.SourceRate > 0 ? Math.Round(st.UpmixLatencyFrames * 1000.0 / st.SourceRate, 1) : 0);
        var list = new List<SinkStatusDto>(st.Sinks.Count);
        // Engine sinks are created in cfg.Outputs order.
        for (int i = 0; i < st.Sinks.Count && i < cfg.Outputs.Count; i++)
        {
            var s = st.Sinks[i];
            list.Add(new SinkStatusDto(cfg.Outputs[i].DeviceId, Math.Round(s.FillMs, 1), Math.Round(s.CorrectionPpm, 1), s.Underruns, s.Overruns));
        }
        return list;
    }

    public void Dispose()
    {
        if (_quit) return;
        _quit = true;
        _wake.Set();
        if (!_thread.Join(4000)) Debug.WriteLine("Surround.Engine thread did not exit in time.");
        _wake.Dispose();
    }
}
