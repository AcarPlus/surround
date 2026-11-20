# Arayüz (v2)

Masaüstü arayüzü `ui/` altındadır (React + Zustand). Bu belge ekranları ve arayüze özgü davranışları özetler;
motor sözleşmesi için `docs/api.md`, ölçüm yöntemi için `docs/kalibrasyon.md`.

## Ekranlar
| Ekran | İçerik |
|---|---|
| Ana sayfa | Büyük Başlat/Durdur, profil kartları, **Sistem kontrolü** (`ui/src/lib/health.ts`), oda önizlemesi, hoparlör listesi (test sesi, sustur) |
| Oda | Oda planı (sürükle, ok tuşları 5 cm, Delete), hoparlör ekle (rol menüsü), düzen şablonu (önizlemeli), "Mesafeden hesapla", "Sırayla çal"; sağda sekmeli hoparlör paneli (Genel / Ses / Gelişmiş) |
| Ses | Upmix (stereo → çevresel; "Arka kanallar": gecikme, tiz kesme, ayrıştırma) ve genel ses işleme (ön ayar + kendi ön ayarların, karakter, otomatik ön kazanç, frekans yanıtı eğrisi, 10 bant EQ, parametrik bantlar, A/B, limiter) |
| Kalibrasyon | Mikrofonla ölçüm (hazırlık → ölçüm → sonuç tablosu → uygula), mikrofon yoksa kulakla seviye eşitleme |
| Bağlantı | VB-Cable rehberi, kaynak seçimi, kanal seviye ölçerleri, çıkış cihazlarının tampon/ek gecikme ve canlı durumu, düşük gecikme |
| Ayarlar | Profiller, Windows ile bütünleşme, kurulum sihirbazı, yedek indir/yükle |

## Kurulum sihirbazı (`ui/src/lib/setup.ts`)
Düzen sayısı (5.1, 7.1 …) yerine gerçek bağlantıdan yola çıkar: kaynak ve sanal kablo uçları dışındaki her çıkış cihazı için
"ne bağlı?" sorulur — 2.1 set (sol/sağ + dahili sub, bas alıcısı), stereo çift (yeri, tipi, sol/sağ ters), tek hoparlör
(rol) ya da çok kanallı sistem (kanal başına rol, Windows sırası FL FR FC LFE BL BR SL SR varsayılan). Her kanal için test
sesi vardır. Sihirbaz yeniden açılınca cevaplar mevcut hoparlörlerden çıkarılır. Uygularken aynı cihaz + kanaldaki hoparlör
korunur (kimlik, konum, EQ, gecikme/kazanç, kalibrasyon); rolü değişirse yeni rol/karışım/ad alır, gecikme/kazancı otomatiğe
döner, yalnızca tarafı değiştiyse standart konuma taşınır; ön ayarı değiştiyse yeniden uygulanır. Sihirbazın listelemediği
cihazlardaki hoparlörler (çıkarılmış cihaz vb.) olduğu gibi kalır; yeni hoparlörler rolün standart açısına, dinleyicinin
duvara uzaklığıyla sınırlı yarıçapa yerleştirilir. Hiç hoparlör yoksa ilk açılışta kendiliğinden açılır.

## Basit / Gelişmiş mod
Uygulama iki kipte çalışır; ayar `uiMode: 'simple' | 'advanced'` olarak config'te saklanır (arayüze özgü alan, motor yok sayar ve korur;
eksikse **Basit**, yeni kurulumun varsayılanı da Basit). Geçiş Ayarlar'daki "Gelişmiş mod" anahtarından ya da Basit ekrandaki
"Gelişmiş mod" bağlantısından yapılır; tüm geçişler `ui/src/lib/mode.ts` → `canUseAdvanced()` üzerinden geçer (ileride lisansa
bağlanacaksa kontrol yalnızca orada). Kip geri alma geçmişine girmez.

- **Gelişmiş**: yukarıda anlatılan arayüz (gezinme, tüm ekranlar, Denetçi, kurulum sihirbazı ilk açılışta kendiliğinden açılır).
- **Basit** (`screens/SimpleHome.tsx`): üstte uygulama adı + Ayarlar dişlisi; Başlat/Durdur, ana ses, **Film / Oyun / Müzik**
  (ses ön ayarları `film`, `game`, `music`), tek satır durum (hoparlör sayısı, ölçüldü mü, çalışıyor mu, sorun varsa düzelt düğmesi) ve iki kurulum girişi.
  Hoparlör yoksa yalnızca bu iki giriş gösterilir. İlk açılışta kurulum sihirbazı kendiliğinden **açılmaz**.
  - **Kolay kurulum** (`easySetupOpen`, `openEasySetup()`, `closeEasySetup()`, `cancelEasySetup()`; `screens/EasySetup.tsx` +
    `EasySetupSteps.tsx`, saf mantık `lib/easySetup.ts`): rehberli, ölçümlü kurulum; aşağıya bakın.
  - **Ölçmeden başla** (`quickStartOpen`, `openQuickStart()`, `closeQuickStart()`; `screens/QuickStart.tsx`, mantık `lib/quickStart.ts`):
    kaynak, sanal kablo ve kulaklık dışındaki her çıkış stereo çift olur (çok kanallı cihaz varsayılan rolleriyle; cihaz başına işaret
    kutusu); her hoparlörün test sesi çalınır ve **oda kadranına** (`components/TapDial.tsx`) dokunularak yeri söylenir. Açı en yakın
    zemin rolüne çevrilir (`lib/tapPlace.ts`: `nearestRole`, `angleToPosition`; subwoofer ve üst hoparlörler rolünü korur), konum
    standart yerleşim yarıçapına konur. "Atla" standart yeri korur. Uygulanırken gecikme 0, kazanç 0 (otomatik hesap kapalı), oda EQ'su yok;
    `applySetup(r, { autoForNew: false, silent: true })` kullanılır, `setupDone` işaretlenir ve motor başlatılır.
    Kaynak (VB-Cable yokken varsayılan hoparlör) listeden düştüğü için liste boş kalırsa (`blockedBySource`) nedeni ve tek tıkla
    VB-Cable kurulumu gösterilir.

### Kolay kurulum
Adımlar: **Ses kaynağı → Hoparlörler → Mikrofon → Konum → Ölçüm → Oda düzeltmesi → Bitti** (ilerleme göstergesi, Geri/İleri).
Açılırken yapılandırma ve geri alma geçmişi kontrol noktası olarak saklanır; **Vazgeç** (X / Esc, Bitti dışındaki her adımda)
kaynak, hoparlör ve ölçüm değişikliklerini geri alır (`cancelEasySetup`), Bitti (`closeEasySetup`) korur.
1. *Ses kaynağı*: `sourceState` → VB-Cable yok / kurulu ama 7.1 ya da kaynak değil / hazır. Tek tıkla kur ya da ayarla
   (`CableInstallCard` → `useCableAutoSetup` → `api.cableSetup`; Bağlantı ekranındaki rehberle ortak). Yönetici onayı, yeniden
   başlatma ve hata sade dille anlatılır; "stereo ile devam et" ile atlanabilir. Elle adımlar için `CableSetup`.
2. *Hoparlörler*: Ölçmeden başla ile aynı varsayımlar (`quickStartDevices`/`quickStartKits`, `DeviceChecklist`).
3. *Mikrofon*: "Telefonum" (QR, `PhonePanel`/`usePhoneLink`; sertifika uyarısı için çizimli "Gelişmiş → Devam et",
   bağlanmazsa `FirewallFix`) ya da bilgisayar/kulaklık mikrofonu. Son seçim tarayıcıda (`surround.easyMic`) hatırlanır.
4. *Konum*: her hoparlör çalınır, kadrana dokunulur (`components/TapPlace.tsx`: `useTapPlace` + `TapPlaceView`, Ölçmeden başla ile ortak).
5. *Ölçüm*: plan önce uygulanır (`buildQuickStart` → `applySetup(…, { autoForNew: false, silent: true })`), sonra Gelişmiş ekranla
   aynı ölçüm (`useCalibrationRun` + `calibrationRequest`, gecikme + seviye + frekans yanıtı, 1 konum, "Orta" seviye).
   `checkMeasurement`: ölçülemeyen ya da SNR < 15 dB hoparlör **uygulanmaz** ve kullanıcıya söylenir (tekrar ölç — bir kademe
   yüksek sesle; ya da onlar olmadan devam). Mikrofon kırpıldıysa bir kademe kısık; mikrofon ortada değil şüphesi de gösterilir.
   Sorun yoksa doğrudan sonraki adıma geçilir. Telefondaki "Ölçümü başlat" da çalışır.
6. *Oda düzeltmesi*: `gentleRoomEq` = `matchSpeakers(…, { target: 'average', limits: GENTLE_ROOM_EQ_LIMITS })` — yalnızca kısma,
   toplamda en çok −6 dB, en çok 4 bant (docs/kalibrasyon.md). Kapatılabilir (kapalıysa eski oda EQ'su kaldırılır).
   Uygulama: `easyPatches` → `applyCalibration(…, { silent: true })`.
7. *Bitti*: sade özet (`easySummary`), motor başlatılır, bildirim.

Hoparlörler varsa Basit ana sayfadaki **Yeniden ölç / Hoparlörleri ölç** (`openEasySetup({ step: 'mic' })`) yalnızca
Mikrofon → Ölçüm → Oda düzeltmesi → Bitti adımlarını açar; Basit kipte sistem kontrolünün "kalibrasyon" ve "kurulum" düzeltmeleri de
Kolay kurulumu açar.

## Geri al / yinele
Yapılandırmayı değiştiren her eylem (`commit`) önceki durumu geçmişe yazar (en fazla 100 adım). Aynı türden art arda gelen
değişiklikler (sürükleme, kaydırıcı) 0,9 sn içinde tek adım sayılır. Ctrl+Z / Ctrl+Y (veya Ctrl+Shift+Z), üst çubuktaki
düğmeler ve silme/düzen/kurulum/kalibrasyon bildirimlerindeki "Geri al". Metin kutusundayken tarayıcının kendi geri alması
çalışır. Geçmiş oturuma özgüdür (diske yazılmaz).

## Sistem kontrolü
Saf fonksiyon; seviyeler hata / uyarı / bilgi. Örnekler: hoparlör yok, kaynak cihaz yok ya da VB-Cable değil, VB-Cable
stereo ayarlı, hoparlörün cihazı bağlı değil / kanal yok / kaynak cihaza çıkıyor (geri besleme), aynı kanala iki hoparlör,
bas kesiliyor ama bas alıcısı yok, tek taraflı surround (bir yanda arka/yan yok → o yanın ortam sesi önde kalır), ön çift eksik,
stereo kaynakta upmix kapalı, sessizdeki hoparlörler, çalışırken kesinti (tamponu büyüt), cihaz bekleniyor (motor bir cihaz
değişikliğiyle durdu, eksik cihazlar listelenir; bkz. docs/api.md "Cihaz değişince"), kalibrasyon yapılmadı, Bluetooth
hoparlör (gecikmesi ölçülmeli; Hands-Free uç noktası uyarısı). Düzeltme
düğmeleri `fixHealth` eylemine bağlanır. Gezinmedeki Ana sayfa simgesi hata/uyarı sayısını gösterir.

## Bluetooth hoparlörler
`kind: "bluetooth"` cihazlar (Beats Pill vb.) sihirbazda "Bluetooth" rozeti ve gecikme notuyla görünür (~150–250 ms; kalibrasyon
ölçer, diğer hoparlörleri ona göre bekletir). Sihirbaz yeni Bluetooth çıkışını `bufferMs: 150` ile açar. Düşük gecikme modu
Bluetooth'u ağ cihazı gibi devre dışı bırakır. Hands-Free (HFP) uç noktası düşük kalite/mono olduğu için uyarı üretir.

## Arayüze özgü config alanları (motor yok sayar)
`speakers[].calibratedAt` (ISO; değerler ölçümden geldi), `setupDone`, `uiMode`, `lastCalibration: { at, micDeviceId, speakers }`.
Hiçbir hoparlörün kullanmadığı `outputs` kaydedilmez.

## Önizleme (tarayıcı, sahte veri)
`npm --prefix ui run dev` → `http://localhost:5173`. Sorgu parametreleri: `?masaustu` (iki Realtek çıkışı + VB-Cable +
kulaklık mikrofonu, boş kurulum → sihirbaz açılır), `?bos` (boş kurulum), `?zayif` (kalibrasyonda son hoparlör zayıf sinyal; "Yüksek" ölçüm sesiyle düzelir),
`?nocable` (VB-Cable yok; tek tıkla kurulum başarılı olur ve kablo belirir), `?yenidenbaslat` / `?kablohata` (kurulum yeniden başlatma
ister / yönetici onayı reddedilir), `?tekcikis` (VB-Cable yok, tek hoparlör çıkışı: liste boş kalır), `?duvar` (telefon güvenlik
duvarına takılır), `?cable2ch`, `?gelismis` (Gelişmiş kip; varsayılan Basit), `?bekle` (Başlat'tan 5 sn sonra bir çıkış "çıkarılır", 5 sn sonra döner: üst çubukta "Cihaz bekleniyor").
Cihaz beklerken (`runState: 'waiting'`) üst çubuktaki durum etiketi uyarı renginde eksik cihazları yazar, Başlat düğmesi
"Durdur" olur (beklemeyi bitirir).

## Gelişmiş EQ (Ses ekranı ve Denetçi)

- **Eğri** (`ui/src/components/EqCurve.tsx`): gerçek birleşik genlik yanıtı (dB, log frekans 20 Hz–20 kHz): 10 bant + bas + netlik + parametrik + etkin ön kazanç.
  Hesap `ui/src/lib/eqCurve.ts`'te, motorun RBJ biquad formüllerinin (frekanslar, Q, raf türleri) birebir aynasıdır; C# ile hesaplanmış referans noktalarla sınanır
  (`eqCurve.test.ts` ↔ `PeqTests.ReferenceResponseForTheUiMirror`). Beyaz noktalar 10 bandın kazancıdır: dikey sürükle (0,5 dB adım), çift tık sıfırlar,
  klavye ↑/↓ 0,5 dB, PgUp/PgDn 3 dB, Home sıfırlar. Elmaslar parametrik bantlardır: yatay = frekans, dikey = kazanç, tekerlek = Q;
  klavye ↑/↓ kazanç, ←/→ frekans (1/12 oktav), +/− Q. Denetçide (hoparlör EQ'su) aynı bileşen kompakt boyuttadır.
- **Parametrik bantlar** (`PeqEditor`): katlanabilir; en fazla 6 bant, tür (tepe / alçak raf / yüksek raf), frekans, kazanç, Q, aç/kapat. Config: `processing.peq`, `speakers[].peq` (bkz. docs/ses-isleme.md).
- **Kendi ön ayarların**: "Ön ayarı kaydet" (ad ≤ 24 karakter, en fazla 20), seçiliyken üzerine yaz / yeniden adlandır / sil. Genel ses ön ayarları çip olarak yerleşiklerin yanında;
  hoparlör EQ ön ayarları Denetçide listede "Kendi ön ayarların" grubunda. Config kökünde `userSoundPresets` ve `userSpeakerPresets` (diziler) olarak saklanır; yedek dışa/içe aktarma (`exportConfig`/`importConfig`) bunları kendiliğinden taşır.
  `processing.preset` / `speaker.eqPreset` değeri `user:<id>`'dir. Şema: `ui/src/api/types.ts` (`UserSoundPreset`, `UserSpeakerPreset`).
- **Otomatik ön kazanç**: `processing.autoPreamp`; açıkken ön kazanç motorca `-max(0, birleşik tepe)` olarak hesaplanır (arayüz aynı değeri salt okunur gösterir). Yeni yerleşik ön ayarlarda açık, eski config'lerde kapalı.
- **A/B (işlemesiz dinle)**: basılı tutunca (ya da kısa tıklayınca aç/kapat) `processing.enabled: false` motora gider; ayar değişmez ve geri alma geçmişine yazılmaz.
  Ayrı bir canlı-uygulama köprüsü olmadığından değişiklik `saveConfig` ile gider; config'e `abBypass: true` işareti de yazılır, uygulama A/B açıkken kapanırsa açılışta işleme geri açılır.
  Ekrandan çıkınca A/B kapanır.
