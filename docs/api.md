# UI <-> backend sınırı

Arayüz motora yalnızca `ui/src/api/client.ts` içindeki `SurroundApi` arayüzü üzerinden erişir.
`client.ts` içindeki `api` nesnesi, `window.chrome.webview` varsa (masaüstü uygulaması) `ui/src/api/bridge.ts`
köprüsünü, yoksa (`npm run dev`, tarayıcı) `ui/src/api/mock.ts` sahte verisini kullanır.

## Köprü protokolü (WebView2)
JSON-RPC, `postMessage` / `WebMessageReceived` üzerinden. Sayfa -> C#: `{ id, method, params: [] }` (konumsal argümanlar).
C# -> sayfa: `{ id, result }` ya da `{ id, error: { message, errors?: string[] } }`; itilen olaylar:
`{ event: "status" | "levels" | "engine" | "engineError" | "calibration", data }`. C# tarafı: `src/Surround.App/Bridge`.
`saveConfig` her zaman diske yazar; doğrulama hatası varsa (boş oda hariç) `errors` ile reddeder, çalışan motor
mühendislik alanları değiştiyse yeniden başlatılır (oda/konum gibi arayüz alanları yeniden başlatmaz).

## Tipler (`ui/src/api/types.ts`)
Motor yapılandırmasını yansıtır: `Source`, `Output`, `Speaker`, `Device`, `SinkStatus`, `Room`,
`Config` (= source, upmix, upmixOptions, outputs, speakers, room, processing), `EngineInfo` ve `LogicalChannel` (FL FR FC LFE BL BR SL SR TFL TFR TBL TBR; üst şeritler için bkz. docs/duzen.md).
Oda koordinatları metredir; (0,0) odanın sol-üst köşesi, y aşağı artar, "ön" planda yukarıdadır.
`deviceChannel` 1 tabanlıdır.

## Arayüz
| Metot | Açıklama |
|---|---|
| `listDevices()` | Çıkış (`render`) ve giriş (`capture`) cihazları |
| `getConfig()` / `saveConfig(cfg)` | Tüm yapılandırma. Arayüz değişiklikten ~400 ms sonra ve Başlat'ta kaydeder |
| `start()` / `stop()` | Motoru çalıştır / durdur |
| `getStatus()` | Çıkış başına `SinkStatus[]` (çalışmıyorsa boş) |
| `playTone(deviceId, channel)` | Test sesi |
| `onStatus(cb)` | Çalışırken ~250 ms'de bir durum (köprüde); unsubscribe döner |
| `onLevels(cb)` | Mantıksal kanal tepe seviyeleri (dBFS, `LevelFrame`: kanal adı → dB nesnesi), ~20 Hz; motorda upmix ve genel işleme sonrası, kanal katlamadan önce ölçülür. Biçim aynı, artık 12 anahtar (FL..SR + TFL TFR TBL TBR); hiçbir hoparlörün kullanmadığı üst şerit -90 gösterir |
| `onEngine(cb)` | `EngineInfo` (`upmix: "off" \| "stereo" \| "native"`, `sourceChannels`, `sourceRate`, `upmixLatencyMs`), durumla aynı sıklıkta; durunca bir kez `"off"` |
| `onEngineError(cb)` | Çalışma sırasında motor hataları (akış kopması, test sesi hatası vb.) |

| `getAppSettings()` | Uygulama ayarları (`app.json`, motor yapılandırmasından ayrı): `{ switchDefaultDevice, startWithWindows, startEngineOnLaunch, minimizeToTray }` (hepsi boolean; varsayılan `true, false, false, true`). Dahili `restore*` alanları dönmez |
| `calibrate(request)` | Mikrofonla hoparlör ölçümü (uzun sürer, ~2,4 sn × tekrar × hoparlör + 3 sn); bitince `CalibrationResult` döner. Ayrıntı: `docs/kalibrasyon.md` |
| `cancelCalibration()` | Süren kalibrasyonu durdurur, `null` döner; bekleyen `calibrate` "Kalibrasyon iptal edildi." ile reddedilir |
| `calibration` olayı | Kalibrasyon sırasında itilen `CalibrationProgress` |
| `saveAppSettings(settings)` | Verilen alanları kaydeder (eksik alan değişmez, bilinmeyen/`restore*` alanlar yok sayılır); başarıyla `null` döner. `startWithWindows` HKCU\...\Run altındaki `Surround` değerini yazar/siler (komut: `"<exe>" --tray`; Velopack kurulumunda güncellemelerden etkilenmeyen kök başlatıcı); yazılamazsa reddeder. Motor çalışırken `switchDefaultDevice` değişirse hemen uygulanır |

## Kalibrasyon (`calibrate`)
İstek (hoparlörler kayıtlı config.json içinde `id` ile aranır; bilinmeyen id hata verir):
```
{ micDeviceId: string, micLoopback?: boolean, speakerIds: string[], referenceSpeakerId?: string,
  repeats?: number, levelDb?: number, lowBandSpeakerIds?: string[] }
```
- `referenceSpeakerId` yoksa `speakerIds[0]`; listede değilse yine çalınır ve sonuçta yer alır. `repeats` 1–5 (varsayılan 2),
  `levelDb` süpürme tepe seviyesi −40…−6 dBFS (varsayılan −20). `micLoopback: true` test modudur: "mikrofon" bir çıkış cihazının loopback'idir.
- `lowBandSpeakerIds`: bas bandında (≈25–180 Hz) analiz edilecek hoparlörler (subwoofer). Alan yoksa yalnızca karışım satırı (`source`)
  sadece LFE olan hoparlörler bas bandında analiz edilir (`bassReceiver` dikkate alınmaz).
- Motor çalışıyorsa durdurulur, ölçümden sonra aynı yapılandırmayla yeniden başlatılır (varsayılan cihaz koruması bu sırada devrede kalır,
  böylece diğer uygulamaların sesi ölçümü bozmaz). Kalibrasyon sürerken `saveConfig`/`start`/`stop` çağrıları bitişi bekler. Aynı anda tek kalibrasyon.
- Kaynak cihazdaki hoparlörler (loopback modunda) kalibre edilemez; en fazla 12 hoparlör.

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
  yapılandırma geçerliyse motor otomatik başlar; başlayamazsa tepsi balonu gösterilir.
- Açılışta sıfır underrun: ilk saniyedeki underrun, DSP döngülerinin yavaş tier-0 JIT koduyla çalışmasından kaynaklanıyordu;
  `TieredPGO=false` ve `TieredCompilationQuickJitForLoops=false` (App ve Cli csproj) ile giderildi.
