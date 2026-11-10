# Surround

Windows'ta sistem sesini (en fazla 8 kanal) yakalayıp, aynı bilgisayardaki birden fazla ses cihazının
istenen kanallarına dağıtan çok hoparlörlü surround motoru. Hoparlör başına gecikme ve kazanç vardır;
ayrı cihazlar arasındaki saat kayması (drift) yeniden örnekleme ile telafi edilir.

Durum: ses motoru + komut satırı + testler + masaüstü uygulaması (WPF/WebView2 kabuğu, Velopack kurulum paketi).
Kurulum sihirbazı hoparlörleri "hangi cihaza ne bağlı" sorusuyla tanıtır; gecikme ve seviye mesafeden hesaplanır ya da
mikrofonla ölçülür (Kalibrasyon). Ekranlar ve arayüz davranışı: `docs/arayuz.md`.

## Masaüstü uygulaması

Arayüz (`ui/`, React) kendi pencerelinde açılır; tarayıcı kullanılmaz. `src/Surround.App` bir WPF kabuğudur:
derlenmiş arayüzü diskten `https://app.surround/` sanal adresiyle WebView2'ye yükler ve arayüzle
`window.chrome.webview` üzerinden JSON-RPC ile konuşur (`ui/src/api/bridge.ts` <-> `src/Surround.App/Bridge`).

### Derleme ve kurulum paketi

Gereksinimler: .NET 10 SDK, Node.js (npm). Depo kökünde:

```
powershell -ExecutionPolicy Bypass -File build.ps1
```

Sırasıyla: arayüz derlenir (`ui/node_modules` yoksa `npm ci`), `dotnet test`, `dotnet publish` (win-x64, self-contained,
`artifacts/publish`), ardından yerel araç `vpk` (Velopack) ile paketlenir. Kurulum dosyası:

```
artifacts/releases/Surround-win-Setup.exe
```

Sürüm `src/Surround.App/Surround.App.csproj` içindeki `<Version>` değerinden gelir (`-Version x.y.z` ile geçersiz kılınabilir;
`-SkipTests` testleri atlar). `artifacts/` git'e girmez. Kurulumdan sonra uygulama `%LocalAppData%\Surround\current` altında çalışır.
Yapılandırma kurulum kökünün dışında, `%AppData%\Surround\config.json` içindedir (kaldırma/güncelleme silmez). WebView2 önbelleği `%LocalAppData%\Surround\WebView2` altındadır.
Kurulum paketi, makinede yoksa Microsoft Edge WebView2 Runtime'ı da kurar.

Uygulama tek kopya çalışır: ikinci kez açılırsa var olan pencere öne gelir. Otomatik güncelleme henüz yok
(`Program.cs` içinde Velopack `UpdateManager` için işaretli bir TODO var).

İlk açılışta kaynak, varsayılan oynatma cihazının loopback'i olur; hoparlör yoktur (geri besleme koruması yüzünden).
Hoparlör yoksa kurulum sihirbazı kendiliğinden açılır.

### Geliştirme modu

Arayüzü tarayıcıda sahte veriyle denemek için:

```
npm --prefix ui install
npm --prefix ui run dev        # http://localhost:5173
```

Gerçek motorla ama canlı yenilemeli (HMR) çalışmak için Debug derlemesinde vite sunucusunu pencerede aç:

```
npm --prefix ui run dev
$env:SURROUND_DEV_URL = "http://localhost:5173"
dotnet run --project src/Surround.App
```

`SURROUND_DEV_URL` yalnızca Debug derlemede dikkate alınır. Debug'ta DevTools ve sağ tık menüsü açıktır; Release'te kapalıdır
(Ctrl+R, F5, Ctrl+P gibi tarayıcı kısayolları da kapalı). `ui/dist` yoksa uygulama bunu pencerede belirtir.

## Kurulum notu (VB-Cable)

Windows sesini yakalamak için sanal bir kablo gerekir (ör. VB-Cable):

1. VB-Cable'ı kurun. "CABLE Input" oynatma cihazı oluşur.
2. "CABLE Input"u Windows varsayılan oynatma cihazı yapın (uygulama bunu sizin yerinize değiştirmez).
3. Yapılandırmada `source.mode` değerini `loopback`, `deviceId` değerini "CABLE Input" yapın.
   Alternatif: `mode: "capture"` ile "CABLE Output" kayıt cihazı kullanılabilir.
4. Kaynak cihaz aynı zamanda çıkış olarak kullanılamaz (geri besleme koruması).

## Komutlar

```
dotnet run --project src/Surround.Cli -- devices [--all]
dotnet run --project src/Surround.Cli -- validate --config config.json
dotnet run --project src/Surround.Cli -- run --config config.json
dotnet run --project src/Surround.Cli -- tone --device <id> --channel <n> [--seconds 2]
dotnet test
```

- `devices`: cihazları, kimliklerini, formatlarını listeler; varsayılanı işaretler.
- `tone`: cihazın tek kanalında 440 Hz sinüs çalar (hoparlörleri kulakla tanımak için).
- `run`: motoru başlatır, her saniye durum yazar, Ctrl+C ile temiz kapanır.

Örnek yapılandırma: `config.example.json` (cihaz kimlikleri yer tutucudur; kendi kimliklerinizi `devices` ile alın).

## Yapılandırma özeti

- Mantıksal kanal sırası: FL, FR, FC, LFE, BL, BR, SL, SR (7.1).
- `outputs[].latencyMs`: cihazın bilinen gecikmesi. Hoparlörün etkin gecikmesi =
  (en büyük latencyMs − bu cihazın latencyMs) + `delayMs`.
- `outputs[].bufferMs`: sürücü tampon hedefi (varsayılan 40 ms).
- `speakers[].deviceChannel`: 1 tabanlı kanal numarası.

## Bilinen sınırlar

- Gecikme ölçümü (mikrofonla kalibrasyon) yok; Faz 3.
- Paylaşımlı modda WASAPI kullanılır; toplam gecikme yaklaşık bufferMs + 30 ms + sürücü.
- Loopback modunda sessizlikte paket gelmediği için kaynak cihaza sessiz bir oynatma akışı açılır.
