# UI <-> backend sınırı

Arayüz motora yalnızca `ui/src/api/client.ts` içindeki `SurroundApi` arayüzü üzerinden erişir.
`client.ts` içindeki `api` nesnesi, `window.chrome.webview` varsa (masaüstü uygulaması) `ui/src/api/bridge.ts`
köprüsünü, yoksa (`npm run dev`, tarayıcı) `ui/src/api/mock.ts` sahte verisini kullanır.

## Köprü protokolü (WebView2)
JSON-RPC, `postMessage` / `WebMessageReceived` üzerinden. Sayfa -> C#: `{ id, method, params: [] }` (konumsal argümanlar).
C# -> sayfa: `{ id, result }` ya da `{ id, error: { message, errors?: string[] } }`; itilen olaylar:
`{ event: "status" | "levels" | "engineError", data }`. C# tarafı: `src/Surround.App/Bridge`.
`saveConfig` her zaman diske yazar; doğrulama hatası varsa (boş oda hariç) `errors` ile reddeder, çalışan motor
mühendislik alanları değiştiyse yeniden başlatılır (oda/konum gibi arayüz alanları yeniden başlatmaz).

## Tipler (`ui/src/api/types.ts`)
Motor yapılandırmasını yansıtır: `Source`, `Output`, `Speaker`, `Device`, `SinkStatus`, `Room`,
`Config` (= source, upmix, outputs, speakers, room) ve `LogicalChannel` (FL FR FC LFE BL BR SL SR).
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
| `onLevels(cb)` | Mantıksal kanal tepe seviyeleri (dBFS, `LevelFrame`), ~20 Hz; motorda upmix sonrası ölçülür |
| `onEngineError(cb)` | Çalışma sırasında motor hataları (akış kopması, test sesi hatası vb.) |

## Arayüze özgü durum (config'e yazılmaz)
- Hoparlör başına "Otomatik" gecikme/kazanç bayrakları (`auto`). Otomatikken `delayMs`/`gainDb`
  değerleri geometriden hesaplanıp `Speaker` içine yazılır; yani motor her zaman nihai sayıyı görür.
- Hesap: `delay = (dMax - d) / 343 * 1000` ms, `gain = 20*log10(d / dMax)` dB (`ui/src/lib/geometry.ts`).
- Önizleme: adrese `?nocable` eklenirse mock VB-Cable'sız çalışır (Kaynak ekranındaki uyarıyı görmek için).
