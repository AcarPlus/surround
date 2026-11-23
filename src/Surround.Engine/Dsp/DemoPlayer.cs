namespace Surround.Engine.Dsp;

/// <summary>Demo sahneleri (arayüzdeki "Ses turu"). Kimlikler arayüzle ortak: ui/src/lib/demo.ts.</summary>
public enum DemoScene { Orbit, PingPong, Flyby, Speakers }

/// <summary>
/// Telifsiz, tamamen sentezlenen hareketli ses kaynağı: sesin odada döndüğünü, sağa sola gittiğini duymak için.
/// Kaynak bir yön (azimut; 0° = ön, + = sağ) boyunca ilerler ve 7.1 zemin kanallarına sabit güçlü komşu çift panlamayla
/// (FL −30, FC 0, FR 30, SR 90, BR 150, BL −150, SL −90) yazılır; sonra gerçek içerik gibi zincirin geri kalanından
/// (ses işleme, katlama, konuma göre dağıtım, hoparlör düzeltmeleri) geçer. Çalarken kaynak sesi susturulur.
/// Yörüngeler <see cref="Azimuth"/>'tadır; arayüz aynı formülle animasyon çizer (ui/src/lib/demo.ts — ikisi birlikte
/// değişmeli). Ses iş parçacığında çalışır; ayırma yapmaz.
/// </summary>
public sealed class DemoPlayer
{
    private static readonly (int Ch, double Deg)[] Ring =
    {
        (Channels.BL, -150), (Channels.SL, -90), (Channels.FL, -30), (Channels.FC, 0),
        (Channels.FR, 30), (Channels.SR, 90), (Channels.BR, 150),
    };

    private const float Level = 0.32f;
    private readonly int _fs;
    private readonly float[] _g = new float[Channels.Count], _gPrev = new float[Channels.Count];
    private long _n;
    private uint _rng = 0x9E3779B9;
    // Sentez durumu.
    private double _bp1, _bp2, _lp, _hp;
    private int _lastEvent = -1;
    private double _evT = 1e9;
    private double _evF;

    public DemoScene Scene { get; }
    public double DurationSeconds => Duration(Scene);
    public bool Finished => _n >= (long)(DurationSeconds * _fs);

    public DemoPlayer(DemoScene scene, int sampleRate)
    {
        Scene = scene;
        _fs = sampleRate;
        Pan(Azimuth(scene, 0), _gPrev);
    }

    public static double Duration(DemoScene s) => s switch
    {
        DemoScene.Orbit => 20,
        DemoScene.PingPong => 16,
        DemoScene.Flyby => 16,
        _ => 8.4,
    };

    /// <summary>Sahnenin t saniyedeki yönü (derece, −180..180). Arayüzdeki <c>demoAzimuth</c> ile aynı.</summary>
    public static double Azimuth(DemoScene s, double t)
    {
        switch (s)
        {
            case DemoScene.Orbit:
                // Önden başlar, 10 sn'de bir tam tur saat yönünde.
                return Norm(36.0 * t);
            case DemoScene.PingPong:
                // Sol ↔ sağ (−90 ↔ +90), 2 sn'de bir yön değişir; uçlarda yumuşak.
                return -90 * Math.Cos(Math.PI * t / 2);
            case DemoScene.Flyby:
            {
                // 8 sn'lik iki geçiş: önden sağ yandan arkaya, sonra arkadan sol yandan öne.
                double u = t % 8 / 8, e = 0.5 - 0.5 * Math.Cos(Math.PI * Math.Min(1, u * 1.25));
                return t < 8 ? 180 * e : Norm(180 + 180 * e);
            }
            default:
            {
                // Kanal kanal: her biri 1,2 sn (FL, FC, FR, SR, BR, BL, SL).
                int i = Math.Min(6, (int)(t / 1.2));
                return new double[] { -30, 0, 30, 90, 150, -150, -90 }[i];
            }
        }
    }

    private static double Norm(double d)
    {
        d %= 360;
        if (d > 180) d -= 360;
        if (d <= -180) d += 360;
        return d;
    }

    /// <summary>Komşu iki kanal arasında sabit güçlü pan (karelerin toplamı 1).</summary>
    public static void Pan(double az, float[] g)
    {
        Array.Clear(g);
        double a = Norm(az);
        for (int i = 0; i < Ring.Length; i++)
        {
            var (c0, d0) = Ring[i];
            var (c1, d1) = Ring[(i + 1) % Ring.Length];
            double span = (d1 - d0 + 360) % 360;
            double off = (a - d0 + 360) % 360;
            if (off <= span)
            {
                double t = span == 0 ? 0 : off / span;
                g[c0] = (float)Math.Cos(t * Math.PI / 2);
                g[c1] = (float)Math.Sin(t * Math.PI / 2);
                return;
            }
        }
    }

    private float Noise()
    {
        _rng ^= _rng << 13; _rng ^= _rng >> 17; _rng ^= _rng << 5;
        return _rng / (float)uint.MaxValue * 2f - 1f;
    }

    private static readonly double[] Scale = { 220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33 };

    /// <summary>Kaynak sinyalinin bir örneği (t saniye).</summary>
    private float Sample(double t)
    {
        double dt = 1.0 / _fs;
        switch (Scene)
        {
            case DemoScene.Orbit:
            {
                // Pentatonik arpej, 4 nota/sn: tını yön için tiz ayrıntı taşır (ataklı, parlak).
                int ev = (int)(t * 4);
                if (ev != _lastEvent) { _lastEvent = ev; _evT = 0; _evF = Scale[(ev * 3 + ev / 8) % Scale.Length] * (ev % 16 < 8 ? 1 : 2); }
                double x = _evT, env = Math.Exp(-x * 5) * Math.Min(1, x * 300);
                double v = env * (Math.Sin(2 * Math.PI * _evF * x) + 0.35 * Math.Sin(4 * Math.PI * _evF * x) + 0.12 * Math.Sin(8 * Math.PI * _evF * x))
                           + Math.Exp(-x * 60) * 0.25 * Noise();
                _evT += dt;
                return (float)(0.55 * v);
            }
            case DemoScene.PingPong:
            {
                // Uçlarda "tok" vuruş (gürültü patlaması + 900 Hz), yolda hafif çalkalama sesi.
                int ev = (int)Math.Floor(t / 2);
                if (ev != _lastEvent) { _lastEvent = ev; _evT = 0; }
                double x = _evT;
                double knock = Math.Exp(-x * 40) * (Math.Sin(2 * Math.PI * 900 * x) + 0.8 * Noise()) * Math.Min(1, x * 500);
                double n = Noise();
                _hp = 0.85 * (_hp + n - _lp); _lp = n; // basit yüksek geçiren
                double shaker = _hp * 0.18 * (0.5 + 0.5 * Math.Sin(2 * Math.PI * 7 * t)) * Math.Sin(Math.PI * (t % 2) / 2);
                _evT += dt;
                return (float)(0.8 * knock + shaker);
            }
            case DemoScene.Flyby:
            {
                // Vınlama: süpürülen bant geçiren gürültü (yaklaşırken parlaklaşır), altta alçak uğultu.
                double u = t % 8 / 8;
                double env = Math.Sin(Math.PI * Math.Min(1, u * 1.25));
                double fc = 300 + 2700 * env;
                double f = 2 * Math.Sin(Math.PI * fc / _fs);
                double n = Noise();
                _bp1 += f * _bp2; double hp = n - _bp1 - 0.5 * _bp2; _bp2 += f * hp; // durum değişkenli filtre
                double rumble = Math.Sin(2 * Math.PI * (55 + 20 * env) * t) * 0.3;
                return (float)(env * env * (0.8 * _bp2 + rumble));
            }
            default:
            {
                // Çan: her kanalda bir kez, uyumsuz kısmilerle (yön ve kanal kolay ayırt edilir).
                int ev = (int)(t / 1.2);
                if (ev != _lastEvent) { _lastEvent = ev; _evT = 0; _evF = 660 * Math.Pow(2, (ev % 7) / 12.0); }
                double x = _evT, env = Math.Exp(-x * 3.2) * Math.Min(1, x * 400);
                double v = env * (Math.Sin(2 * Math.PI * _evF * x) + 0.5 * Math.Sin(2 * Math.PI * _evF * 2.76 * x) + 0.25 * Math.Sin(2 * Math.PI * _evF * 5.4 * x));
                _evT += dt;
                return (float)(0.6 * v);
            }
        }
    }

    /// <summary>
    /// Mantıksal karelerin (FL..TBR) yerine demo sinyalini yazar. Kazançlar blok başında ve sonunda hesaplanıp blok
    /// boyunca doğrusal geçer (fermuar sesi yok).
    /// </summary>
    public void Process(Span<float> logical, int frames)
    {
        const int Ch = Channels.Count;
        logical[..(frames * Ch)].Clear();
        long total = (long)(DurationSeconds * _fs);
        double tEnd = (double)(_n + frames) / _fs;
        Pan(Azimuth(Scene, Math.Min(tEnd, DurationSeconds)), _g);
        for (int f = 0; f < frames; f++)
        {
            if (_n >= total) break;
            double t = (double)_n / _fs;
            // Başta/sonda 50 ms yumuşak giriş/çıkış.
            double fade = Math.Min(1, Math.Min(t, DurationSeconds - t) / 0.05);
            float s = Sample(t) * Level * (float)fade;
            float k = frames > 1 ? (float)f / (frames - 1) : 1f;
            int b = f * Ch;
            foreach (var (c, _) in Ring)
            {
                float g = _gPrev[c] + (_g[c] - _gPrev[c]) * k;
                if (g != 0f) logical[b + c] = s * g;
            }
            _n++;
        }
        Array.Copy(_g, _gPrev, Channels.Count);
    }
}
