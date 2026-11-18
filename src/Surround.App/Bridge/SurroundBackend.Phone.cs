using System.Globalization;
using System.Text.Json;
using Surround.Engine.Calibration;
using Surround.Engine.Config;
using Surround.Engine.Phone;

namespace Surround.Desktop.Bridge;

/// <summary>Phone microphone link (docs/kalibrasyon.md, "Telefonla"): page methods and the phone-side progress.</summary>
public sealed partial class SurroundBackend
{
    private PhoneLink? _phone;
    private readonly object _phoneLock = new();

    /// <summary>The phone link's state changed (connection, recording state), on a worker thread.</summary>
    public event Action<PhoneLinkStatus>? PhoneStatus;
    /// <summary>"Start" was pressed on the phone; the page starts the measurement it has set up.</summary>
    public event Action? PhoneStartRequested;

    public static string PhoneCertFile => Path.Combine(AppPaths.DataDir, "phone-cert.pfx");

    private PhoneLink Phone()
    {
        lock (_phoneLock)
        {
            if (_phone != null) return _phone;
            var p = new PhoneLink(PhoneCertFile, AppLog.Info);
            p.StatusChanged += s => PhoneStatus?.Invoke(s);
            p.StartRequested += () => PhoneStartRequested?.Invoke();
            return _phone = p;
        }
    }

    private async Task<object?> PhoneLinkAsync(string method, JsonElement args)
    {
        switch (method)
        {
            case "phoneLinkStart":
                try { return await Task.Run(() => Phone().Start()); }
                catch (Exception ex) { throw new BridgeException($"Telefon bağlantısı açılamadı: {ex.Message}"); }
            case "phoneLinkStop":
                lock (_phoneLock) _phone?.Stop();
                return null;
            case "phoneLinkStatus":
                lock (_phoneLock) return _phone?.Status() ?? new PhoneLinkStatus(false, null, Array.Empty<string>(), false, PhoneState.Ready, null, null, null);
            case "phoneLinkPrompt":
                var a = Arg(args, 0);
                lock (_phoneLock) _phone?.SetPrompt(a.ValueKind == JsonValueKind.String ? a.GetString() : null);
                return null;
        }
        throw new BridgeException($"Bilinmeyen yöntem: {method}");
    }

    private IExternalMicrophone? PhoneFor(CalibrationRequest req)
    {
        if (!req.IsPhone) return null;
        lock (_phoneLock)
        {
            if (_phone is not { Running: true }) throw new BridgeException("Telefon bağlantısı açık değil. Kalibrasyon ekranından QR kodu açın.");
            return _phone;
        }
    }

    private void PhoneProgress(CalibrationRequest req, CalibrationProgress p)
    {
        if (!req.IsPhone) return;
        double frac(int i) => p.Total > 0 ? Math.Clamp((i - 0.5) / p.Total, 0, 1) : 0;
        int pct = p.Phase switch
        {
            CalibrationPhase.Measuring => (int)(85 * frac(p.Index)),
            CalibrationPhase.Analyzing => 85 + (int)(15 * frac(p.Index)),
            CalibrationPhase.Done => 100,
            _ => 2,
        };
        lock (_phoneLock) _phone?.SetProgress(p.Message, pct);
    }

    private void PhoneResult(CalibrationRequest req, SurroundConfig cfg, CalibrationResult? r, string? error)
    {
        if (!req.IsPhone) return;
        lock (_phoneLock) _phone?.SetResult(r is null ? null : PhoneSummary(cfg, r), error);
    }

    /// <summary>A few lines for the phone screen: each speaker's arrival and level against the reference.</summary>
    internal static string PhoneSummary(SurroundConfig cfg, CalibrationResult r)
    {
        var ci = CultureInfo.GetCultureInfo("tr-TR");
        string Name(string id) => cfg.Speakers.FirstOrDefault(s => CalibrationRunner.IdOf(s) == id)?.Name is { Length: > 0 } n ? n : id;
        var lines = new List<string> { r.Verified ? "Doğrulama (düzeltmeler açıkken):" : "Ölçüm:" };
        foreach (var s in r.Speakers)
        {
            if (s.SpeakerId == r.ReferenceSpeakerId) { lines.Add($"• {Name(s.SpeakerId)}: referans"); continue; }
            if (!s.Ok) { lines.Add($"• {Name(s.SpeakerId)}: ölçülemedi"); continue; }
            double ms = s.ResidualArrivalMs ?? s.ArrivalMs, db = s.ResidualLevelDb ?? s.LevelDb;
            lines.Add(string.Format(ci, "• {0}: {1:+0.0;-0.0;0} ms, {2:+0.0;-0.0;0} dB", Name(s.SpeakerId), ms, db));
        }
        lines.Add("Ayrıntılar ve uygulama bilgisayarda.");
        return string.Join("\n", lines);
    }

    private void DisposePhone()
    {
        lock (_phoneLock) { _phone?.Dispose(); _phone = null; }
    }
}
