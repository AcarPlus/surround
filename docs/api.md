# UI <-> backend sınırı

Arayüz motora yalnızca `ui/src/api/client.ts` içindeki `SurroundApi` arayüzü üzerinden erişir.
`client.ts` içindeki `api` nesnesi, `window.chrome.webview` varsa (masaüstü uygulaması) `ui/src/api/bridge.ts`
köprüsünü, yoksa (`npm run dev`, tarayıcı) `ui/src/api/mock.ts` sahte verisini kullanır.

## Köprü protokolü (WebView2)
JSON-RPC, `postMessage` / `WebMessageReceived` üzerinden. Sayfa -> C#: `{ id, method, params: [] }` (konumsal argümanlar).
C# -> sayfa: `{ id, result }` ya da `{ id, error: { message, errors?: string[] } }`; itilen olaylar:
`{ event: "status" | "levels" | "engine" | "engineError" | "engineState" | "calibration" | "profileApplied" | "phoneLink" | "phoneStart", data }`. C# tarafı: `src/Surround.App/Bridge`.
`saveConfig` her zaman diske yazar; doğrulama hatası varsa (boş oda hariç) `errors` ile reddeder, çalışan motor
mühendislik alanları değiştiyse yeniden başlatılır (oda/konum gibi arayüz alanları yeniden başlatmaz).

## Tipler (`ui/src/api/types.ts`)
Motor yapılandırmasını yansıtır: `Source`, `Output`, `Speaker`, `Device`, `SinkStatus`, `Room`,
`Config` (= source, upmix, upmixOptions, outputs, speakers, room, processing; arayüz kök alanları: profiles, activeProfileId, userSoundPresets, userSpeakerPresets, abBypass, setupDone, uiMode, lastCalibration — motor yok sayar ve korur), `EngineInfo`, `EngineState` ve `LogicalChannel` (FL FR FC LFE BL BR SL SR TFL TFR TBL TBR; üst şeritler için bkz. docs/duzen.md).
Oda koordinatları metredir; (0,0) odanın sol-üst köşesi, y aşağı artar, "ön" planda yukarıdadır.
`deviceChannel` 1 tabanlıdır.

## Arayüz
| Metot | Açıklama |
|---|---|
| `listDevices()` | Çıkış (`render`) ve giriş (`capture`) cihazları: `{ id, name, kind, flow, channels, sampleRate, isDefault, handsFree }`. `kind`: `multichannel` (>2 kanal), `local`, `bluetooth` (uç nokta numaralandırıcısı `BTH*` ya da ad sezgisi; `handsFree` = Hands-Free/HFP uç noktası, düşük kalite mono), `network` (ayrılmış, henüz üretilmez) |
| `getConfig()` / `saveConfig(cfg)` | Tüm yapılandırma. Arayüz değişiklikten ~400 ms sonra ve Başlat'ta kaydeder |
| `start()` / `stop()` | Motoru çalıştır / durdur |
| `getStatus()` | Çıkış başına `SinkStatus[]` (çalışmıyorsa boş) |
| `playTone(deviceId, channel)` | Test sesi |
| `cableSetup()` | Tek tıkla VB-Cable (README, "İndirme ve tek tıkla kurulum"): yoksa indirir, imzasını doğrular, tek UAC ile kurar; 7.1 yapar; `switchDefaultDevice`'ı açar. Döner: `{ state: "done", deviceId, channels, installed }` ya da `{ state: "reboot", installed }` (Windows yeniden başlamalı). Aynı anda iki kez çağrılırsa hata |
| `onStatus(cb)` | Çalışırken ~250 ms'de bir durum (köprüde); unsubscribe döner |
| `onLevels(cb)` | Mantıksal kanal tepe seviyeleri (dBFS, `LevelFrame`: kanal adı → dB nesnesi), ~20 Hz; motorda upmix ve genel işleme sonrası, kanal katlamadan önce ölçülür. Biçim aynı, artık 12 anahtar (FL..SR + TFL TFR TBL TBR); hiçbir hoparlörün kullanmadığı üst şerit -90 gösterir |
| `onEngine(cb)` | `EngineInfo` (`upmix: "off" \| "stereo" \| "native"`, `sourceChannels`, `sourceRate`, `upmixLatencyMs`), durumla aynı sıklıkta; her duruşta (kalibrasyonun durdurması ve başarısız yeniden başlatma dahil) `"off"` (`sourceRate: 0`) ve boş `status` |
| `onEngineError(cb)` | Çalışma sırasında motor hataları (akış kopması, test sesi hatası vb.) |
| `getEngineState()` / `onEngineState(cb)` | Çalışma durumu `EngineState` = `{ state: "running" \| "waiting" \| "stopped", missing: string[], message?: string }` (`engineState` olayı). Olay her geçişte (Başlat, Durdur, cihaz bekleme, otomatik yeniden başlama) ve bekleme sırasında eksik listesi/neden değişince gelir; kalibrasyonun geçici durdurması `running` sayılır. `missing`: eksik cihazların adları (yalnızca `waiting`); `message` yalnızca eksik cihaz dışındaki bir nedenle beklerken gelir. Ayrıntı: aşağıda "Cihaz değişince" |
| `onProfileApplied(cb)` | `profileApplied` olayı, `data = { id }`: tepsi menüsünden (Profil ▸) bir profil seçildi. Backend profilin `processing` / `upmix` / `upmixOptions` alanlarını ve `activeProfileId`'yi kayıtlı yapılandırmaya zaten yazdı (çalışıyorsa sese de uyguladı); arayüz aynı profili `selectProfile` ile seçer (geri alınabilir, bildirim gösterir). Tepsi menüsü her `saveConfig` sonrası kayıttaki `profiles` listesinden yenilenir; liste boşsa menüde görünmez. |

| `getAppSettings()` | Uygulama ayarları (`app.json`, motor yapılandırmasından ayrı): `{ switchDefaultDevice, startWithWindows, startEngineOnLaunch, minimizeToTray }` (hepsi boolean; varsayılan `true, false, false, true`). Dahili `restore*` alanları dönmez |
| `calibrate(request)` | Mikrofonla hoparlör ölçümü (uzun sürer, ~2,4 sn × tekrar × hoparlör + 3 sn); bitince `CalibrationResult` döner. Ayrıntı: `docs/kalibrasyon.md` |
| `cancelCalibration()` | Süren kalibrasyonu (analiz aşaması dahil) durdurur, `null` döner; bekleyen `calibrate` "Kalibrasyon iptal edildi." ile reddedilir |
| `phoneLinkStart()` | Telefon mikrofonu için yerel ağda HTTPS bağlantısını açar (açıksa aynısı); `PhoneLinkStatus { running, url, urls, connected, state, device?, note?, error? }` döner. `url` QR koduna konur. Ayrıntı: `docs/kalibrasyon.md` "Telefonla" |
| `phoneLinkStop()` / `phoneLinkStatus()` | Bağlantıyı kapatır / durumu döner |
| `phoneLinkPrompt(text \| null)` | Telefon ekranında yönerge (ör. sonraki ölçüm konumu) |
| `onPhoneLink(cb)` / `onPhoneStart(cb)` | `phoneLink` olayı (durum değişti: bağlandı/koptu, kayıt durumu); `phoneStart` olayı (telefonda "Ölçümü başlat"a basıldı; arayüz ölçümü başlatır) |
| `calibration` olayı | Kalibrasyon sırasında itilen `CalibrationProgress` |
| `getVolume()` | Ana ses düzeyi `VolumeState { available, level, muted, db }`: loopback kaynağının Windows ses düzeyi (`level` 0..1 = Windows kaydırıcısı, `db` cihazın eğrisindeki karşılığı). Kaynak loopback değilse `available: false`. Ayrıntı: aşağıda "Ses düzeyi" |
| `setVolume(level)` / `setMute(muted)` | Kaynağın Windows ses düzeyini / sessizini yazar (0'dan büyük düzey sessizi de kaldırır); yeni `VolumeState` döner |
| `onVolume(cb)` | `volume` olayı: ses tuşları, görev çubuğu kaydırıcısı, sayfa ya da kaydedilen yapılandırmada kaynak değişti |
| `getUpdate()` / `checkUpdate()` | Otomatik güncelleme `UpdateState { state, current, version?, progress, message? }`; `state`: `unsupported` (kurulu kopya değil), `idle`, `checking`, `downloading` (`progress` 0..100), `ready` (indirildi), `error`. `checkUpdate` hemen denetler ve varsa indirir |
| `applyUpdate()` | `ready` iken: uygulama düzgünce kapanır (motor durur, varsayılan çıkış geri yüklenir), Velopack güncellemeyi kurar ve yeni sürümü açar. `ready` değilse reddeder |
| `onUpdate(cb)` | `update` olayı: güncelleme durumu değişti |
| `saveAppSettings(settings)` | Verilen alanları kaydeder (eksik alan değişmez, bilinmeyen/`restore*` alanlar yok sayılır); başarıyla `null` döner. `startWithWindows` HKCU\...\Run altındaki `Surround` değerini yazar/siler (komut: `"<exe>" --tray`; Velopack kurulumunda güncellemelerden etkilenmeyen kök başlatıcı); yazılamazsa reddeder. Motor çalışırken `switchDefaultDevice` değişirse hemen uygulanır |

## Kalibrasyon (`calibrate`)
İstek (hoparlörler kayıtlı config.json içinde `id` ile aranır; bilinmeyen id hata verir):
```
{ micDeviceId: string, micLoopback?: boolean, speakerIds: string[], referenceSpeakerId?: string,
  repeats?: number, levelDb?: number, lowBandSpeakerIds?: string[],
  applyCorrections?: boolean, responses?: boolean }
```
`micDeviceId: "phone"`: telefon mikrofonu (önce `phoneLinkStart`, telefon bağlı olmalı). `responses`: frekans yanıtları da
ölçülür (`responseDb` + `responseHz`; telefonla her zaman). `applyCorrections`: doğrulama — hoparlörler delay/gain/roomEq
açıkken çalar; sonuç düzeltmesiz değere çevrilir, şu an duyulan fark `residualArrivalMs`/`residualLevelDb`, `verified: true`.
Hoparlör alanı `roomEq` (en çok 8 parametrik bant): kalibrasyonun tını düzeltmesi, kullanıcının `peq`'inden sonra; canlı
güncellenir.
- `referenceSpeakerId` yoksa `speakerIds[0]`; listede değilse yine çalınır ve sonuçta yer alır. `repeats` 1–5 (varsayılan 2),
  `levelDb` süpürme tepe seviyesi −40…−6 dBFS (varsayılan −20). `micLoopback: true` test modudur: "mikrofon" bir çıkış cihazının loopback'idir.
- `lowBandSpeakerIds`: bas bandında (≈25–180 Hz) analiz edilecek hoparlörler (subwoofer). Alan yoksa yalnızca karışım satırı (`source`)
  sadece LFE olan hoparlörler bas bandında analiz edilir (`bassReceiver` dikkate alınmaz).
- Motor çalışıyorsa durdurulur, ölçümden sonra aynı yapılandırmayla yeniden başlatılır (varsayılan cihaz koruması bu sırada devrede kalır,
  böylece diğer uygulamaların sesi ölçümü bozmaz). Durdurma `engine` `"off"` olayıyla bildirilir; yeniden başlatma başarısız olursa
  motor durmuş kalır (`"off"` + `engineError`) ve varsayılan cihaz geri yüklenir. Ölçüm sırasında değişen `switchDefaultDevice`
  yeniden başlatmada uygulanır. Kalibrasyon sürerken `saveConfig`/`start`/`stop` çağrıları bitişi bekler. Aynı anda tek kalibrasyon.
- Kaynak cihazdaki hoparlörler (loopback modunda) ölçülemez: çalıştırma diğerleriyle sürer, onlar sonuçta `ok: false`,
  `message: "Kaynak cihazdaki hoparlör ölçülemez."` ile döner. Referans kaynak cihazdaysa (ya da hepsi oradaysa) hata verir;
  `referenceSpeakerId` yoksa referans ilk ölçülebilir hoparlördür. En fazla 12 hoparlör.

Tipler (camelCase):
```
CalibrationProgress = { phase: 'preparing'|'noise'|'measuring'|'analyzing'|'done', speakerId?: string, index: number, total: number, message: string }
CalibrationResult = {
  referenceSpeakerId: string, micDeviceId: string,
  noiseFloorDb: number,        // dBFS, sessiz giriş bölümünde (ENC'li mikrofonlar -120'ye kadar düşebilir)
  micClipped: boolean,
  speakers: Array<{ speakerId: string, ok: boolean,
    arrivalMs: number,         // referansa göre (negatif = önce); delayMs ve latencyMs telafisi hariç
    levelDb: number,           // referansa göre; gainDb hariç
    snrDb: number, spreadMs: number /* tekrarlar arası maks−min */, lowBand: boolean, message?: string }>
}
```
`index`/`total`: ölçüm adımları (tekrar × ölçülen hoparlör); `measuring` ve `analyzing` için 1 tabanlı geçerli adım, `done` için `total`,
diğerlerinde 0. `message` (hoparlör) yalnızca uyarı varsa gelir. Referansın kendi satırı `arrivalMs = 0`, `levelDb = 0`.
Ölçüm yapılandırılmış gecikme/kazanç olmadan yapıldığı için yeni değerler mevcutların yerine geçer (üstüne eklenmez):
`delayMs = max(arrivalMs) - arrivalMs` (en geç gelen 0), `gainDb = min(levelDb) - levelDb` (en sessiz 0, diğerleri kısılır).
`outputs[].latencyMs` sıfır değilse etkin gecikmeye ayrıca eklendiğini hesaba katın. `ok: false` olan hoparlörün değerleri 0'dır, kullanılmamalı.

## Arayüze özgü durum (config'e yazılmaz)
- Hoparlör başına "Otomatik" gecikme/kazanç bayrakları (`auto`). Otomatikken `delayMs`/`gainDb`
  değerleri geometriden hesaplanıp `Speaker` içine yazılır; yani motor her zaman nihai sayıyı görür.
- Hesap: `delay = (dMax - d) / 343 * 1000` ms, `gain = 20*log10(d / dMax)` dB (`ui/src/lib/geometry.ts`).
- Önizleme: adrese `?nocable` eklenirse mock VB-Cable'sız çalışır (Kaynak ekranındaki uyarıyı görmek için).
  `?bekle`: Başlat'tan 5 sn sonra bir çıkış cihazı "çıkarılır" (`waiting`), 5 sn sonra geri gelir (`running`).

## Cihaz değişince (otomatik kurtarma)
Motor çalışırken bir cihaz çıkarılır/devre dışı kalırsa, kaynağın ya da bir çıkışın Windows biçimi değişirse (ör. VB-Cable 7.1 yapıldı)
veya bir yakalama/oynatma akışı koparsa (`AUDCLNT_E_DEVICE_INVALIDATED` vb.) motor durdurulur ve `waiting` durumuna geçilir;
gereken tüm cihazlar ~1 sn kesintisiz yerinde olunca kayıtlı yapılandırmayla (`config.json`, Başlat'ın kullandığı) kendiliğinden
yeniden başlar ve `running` gelir.
- Gereken cihazlar: kaynak + en az bir hoparlörü yönlendirilen çıkışlar (loopback'te kaynak cihazdaki hoparlörler sayılmaz).
  Çalışırken motorun açtığı cihazlar, beklerken kayıtlı yapılandırmanınkiler izlenir: beklerken eksik cihazın hoparlörleri silinirse
  (`saveConfig`) kalanlarla yeniden başlar. Eksik çıkışı atlayıp kalanlarla çalışmaya devam etme (kısmi çalışma) yoktur.
- Kaynak: Windows uç nokta bildirimleri (durum, ekleme/çıkarma, `PKEY_AudioEngine_DeviceFormat`; varsayılan cihaz değişimi yok sayılır)
  ve akış hataları. Bildirimler yalnızca not alınır; değerlendirme ve motor işlemleri başlat/durdur/`saveConfig`/kalibrasyonla aynı
  kilit altında, motor iş parçacığında yapılır. Eksik cihaz varken bildirim kaçarsa diye 3 sn'de bir yeniden bakılır. Aynı biçimi
  bildiren olay yeniden başlatmaz.
- Yeniden başlatma başarısız olursa (doğrulama hatası, cihaz meşgul) `waiting` sürer, `message` hatayı söyler ve bekleme 2, 4, 8 … 30 sn'ye
  uzar; otomatik başlatılan motor 10 sn içinde yine koparsa da bekleme uzar. Cihaz gerçekten gidip gelince bekleme yine ~1 sn'dir.
- Beklerken varsayılan çıkış cihazı koruması devrede kalır (Windows varsayılanı kaynakta kalır); Durdur beklemeyi bitirir ve varsayılanı
  her zamanki gibi geri yükler. Beklerken `start()` bir şey yapmaz. Bekleme başlarken `engine` `"off"` ve boş `status` gelir;
  akış koptuysa ayrıca `engineError` gelir. Tepsi "Surround — cihaz bekleniyor" gösterir ve menüsü "Durdur"dur.
- Başlatırken (`start()`, tepsiden Başlat, `startEngineOnLaunch` / `--tray` açılışı) gereken bir cihaz (çıkış ya da kaynak) henüz yoksa
  hata verilmez: motor aynı şekilde `waiting` olur (eksik cihaz adları `missing` içinde), cihazlar gelince yukarıdaki kurallarla
  kendiliğinden başlar; Durdur beklemeyi bitirir. Bu sırada `saveConfig` de eksik cihaz yüzünden hata vermez. Yapılandırma hataları
  (geçersiz ayar, hoparlörü olmayan çıkış vb.) ve mevcut cihazın uygunsuzluğu (yanlış tür, az kanal) eskisi gibi hata olarak döner.
  Başlangıçta bekleme varsayılan çıkış korumasını devreye sokmaz (yalnızca önceki çökmeden kalan bir geri yükleme bekliyorsa yapılır).

## Ses düzeyi
WASAPI loopback, Windows'un cihaz ses düzeyini ve sessizini uygulamadan önceki karışımı yakalar (ölçüldü: VB-Cable'da %100, %30
ve sessizde yakalanan sinyal aynı). Bu yüzden motor, loopback kaynağının uç nokta ses düzeyini (`IAudioEndpointVolume`) izler ve
kendisi uygular: genel işlemeden (dinamik güçlendirmenin telafi kazancı kısılan sesi geri yükseltmesin diye) sonra, seviye
ölçerlerinden, bas yolundan ve hoparlörlerden önce. Kazanç = Windows'un bildirdiği dB (`MasterVolumeLevel`, ör. %50 ≈ −10,5 dB),
sessiz ya da %0'da 0; hiçbir zaman yükseltme yok. Değişiklik blok boyunca doğrusal rampayla uygulanır (tık yok). Böylece klavyedeki
ses tuşları, görev çubuğu kaydırıcısı ve üst çubuktaki kaydırıcı aynı değeri değiştirir. `capture` kaynağında izlenmez.
Kalibrasyon motoru kullanmaz, ses düzeyinden etkilenmez.

## Otomatik güncelleme
Kurulu kopya (Velopack) açıldıktan ~20 sn sonra ve 6 saatte bir `https://github.com/AcarPlus/surround` sürümlerini denetler
(`releases.win.json`), yeni sürümü arka planda indirir ve `update` olayıyla bildirir; pencere gizliyse tepsi balonu da çıkar.
Kurulum kullanıcıya bırakılır: "Yeniden başlat ve güncelle" ya da hiçbir şey yapmamak (indirilen sürüm bir sonraki açılışta
`VelopackApp` tarafından kendiliğinden kurulur). Geliştirme derlemesinde (`dotnet run`) `unsupported` döner. Yayın: build.ps1
çıktısındaki `Surround-*-full.nupkg`, `RELEASES`, `releases.win.json`, `assets.win.json`, Setup ve Portable aynı GitHub
sürümüne yüklenir.

## Uygulama davranışı (masaüstü kabuğu)
- **Varsayılan çıkış cihazı** (`switchDefaultDevice`): kaynak `loopback` ise motor başlayınca (ve kaynak değişerek yeniden başlayınca)
  kaynak cihaz Windows'un varsayılan çıkışı (Konsol, Multimedya, İletişim) yapılır; önceki varsayılan `app.json` içine
  (`restoreDeviceId`, `restoreCommunicationsId`, `restoreSourceId`) yazılır. Motor durunca, uygulamadan çıkınca (pencere, tepsi
  "Çıkış", oturum kapanışı) geri yüklenir. Çökme olursa sonraki açılışta motor başlatılmıyorsa geri yüklenir. Kullanıcı bu arada
  bir rolü başka cihaza çevirmişse o rol elleşilmez; eski cihaz artık yoksa atlanır. COM hataları arayüze fırlatılmaz, `engineError` olarak bildirilir.
- **Tepsi**: simge her zaman görünür (tooltip "Surround — çalışıyor/durdu"); çift tık pencereyi gösterir; menü Göster, Başlat/Durdur, Çıkış.
  `minimizeToTray` açıkken pencereyi kapatmak gizler (ilk seferde "Surround arka planda çalışıyor" balonu), Çıkış gerçekten kapatır.
  Tepsiden başlat/durdur yapılınca arayüz `status`/`engine` olaylarıyla durumu görür.
- `--tray` bağımsız değişkeni: pencere açılmadan tepsiye başlar (WebView ilk gösterimde oluşturulur). `startEngineOnLaunch` açıksa
  yapılandırma geçerliyse motor otomatik başlar (cihaz eksikse bekler); yapılandırma hatasıyla başlayamazsa tepsi balonu gösterilir.
- Açılışta sıfır underrun: ilk saniyedeki underrun, DSP döngülerinin yavaş tier-0 JIT koduyla çalışmasından kaynaklanıyordu;
  `TieredPGO=false` ve `TieredCompilationQuickJitForLoops=false` (App ve Cli csproj) ile giderildi.
