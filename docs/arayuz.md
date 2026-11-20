# Arayüz (v3, 0.5.0)

Masaüstü arayüzü `ui/` altındadır (React + Zustand). Bu belge ekranları ve arayüze özgü davranışları özetler;
motor sözleşmesi için `docs/api.md`, ölçüm yöntemi için `docs/kalibrasyon.md`.

Tek uygulama: herkesin kullanabileceği kadar sade, isteyene ayrıntılı. Basit/Gelişmiş kip yok (0.4.0'daki `uiMode`,
Kolay kurulum ve Ölçmeden başla 0.5.0'da kaldırıldı; config'teki eski `uiMode` alanı yok sayılır).

## Ekranlar
| Ekran | İçerik |
|---|---|
| Oda (ana ekran) | Odanın kendisi: düzen çipleri, oda sahnesi, altta canlı seviye şeridi. Aşağıya bakın. |
| Ses | Upmix (stereo → çevresel; "Arka kanallar": gecikme, tiz kesme, ayrıştırma) ve genel ses işleme (ön ayar + kendi ön ayarların, karakter, otomatik ön kazanç, frekans yanıtı eğrisi, 10 bant EQ, parametrik bantlar, A/B, limiter) |
| Ölçüm | Mikrofonla/telefonla tek akış ölçüm (hazırlık → 5 nokta → sonuç → uygula), mikrofon yoksa kulakla seviye eşitleme |
| Ayarlar | Profiller, Windows ile bütünleşme, kurulum sihirbazı, yedek indir/yükle |

Üst çubuk: logo, Başlat/Durdur, profil seçimi (ilk üç profil tek dokunuşla — Film / Oyun / Müzik — diğerleri oklu menüde),
motorun ne yaptığı (upmix durumu), geri al/yinele, ana ses düzeyi, **tek durum işareti** ve tema. Ekranlar geniş pencerede
ortalanır (`.screen-page`).

## VB-Cable kapısı (`components/CableGate.tsx`)
Surround sesi VB-Cable'dan alır; o olmadan çalışmaz. VB-Cable yoksa ya da Windows'ta 2 kanal ayarlıysa uygulamanın tek ekranı
bu kapıdır, atlama yolu yoktur. Tek tık (`useCableAutoSetup` → `api.cableSetup`): resmi siteden indirir, imzasını doğrular,
kurar (bir UAC onayı), 7.1 yapar, kaynak ve "Windows varsayılan çıkışını çevir" ayarını açar. Yeniden başlatma gerekirse söyler.
VB-Cable lisansı gereği Setup'a gömülmez; bu yüzden kurulum ilk açılışta yapılır.

Kaynak her zaman VB-Cable'dır ve arayüzden seçilmez: cihaz listesi her yenilendiğinde `followCable()` kaynağı kabloya
(loopback) çevirir (geri alma geçmişine girmez). Ayrı bir Bağlantı ekranı yoktur.

## Oda (ana ekran)
- **Sahne** (`components/RoomStage.tsx`): odanın kuşbakışı planı (oda boyutuna oranlı), hoparlörler, dinleyici ("Sen").
  Hoparlörler ve dinleyici sürüklenir; ok tuşları 5 cm, Delete siler. Hoparlör düğümünde kanal kısaltması, altında adı.
- **Hoparlör paneli** (`components/SpeakerPopover.tsx`): hoparlöre dokununca yanında açılır — çalan cihaz (kaynak ve sanal
  kablolar hariç tüm çıkışlar, Bluetooth dahil) ve kanal (2 kanallı cihazda Sol/Sağ; çakışma uyarısı), seviye (elle değişince
  otomatik kazanç kapanır), gecikme, mesafe, ölçüm durumu, test sesi, sustur, kaldır (iki dokunuşla). "Tüm ayarlar" sağdan
  ayrıntılı Denetçiyi (`components/Inspector.tsx`: Genel / Ses / Gelişmiş sekmeleri) çekmece olarak açar.
- **Düzen çipleri** (`components/LayoutPicker.tsx`): 2.0, 2.1, 3.1, 5.1, 7.1, 5.1.2, 7.1.4 ve "Başka…" (X.Y veya X.Y.Z).
  Hiç hoparlör silinmeyecekse hemen uygulanır, silinecekse önizlemeli onay ister. Elle kurulan düzen şablona uymuyorsa
  "Özel · X.Y.Z" görünür.
- **Hoparlör ekle**: kullanılmayan standart rollerin yuvaları (sol, orta, sağ, sub, yan, arka, arka orta, dört üst) sahnede
  "+" olarak belirir; dokununca o rol eklenir (`addSpeaker(role)`). Nadir roller (geniş, üst orta, rolsüz) "Diğer…" menüsünde.
- **Oda menüsü** (sağ üst, oda ölçüsü): oda boyutu, "Gecikme ve seviyeyi mesafeden hesapla", "Kurulumu baştan yap".
- **Canlı seviye şeridi**: her hoparlörün çaldığı kanalın seviyesi (LED tarzı), kaynak, yayılım (upmix durumu), ek gecikme, kesinti.
- Arkada hoparlör yoksa sahnede sessiz bir ipucu çıkar.

### Görsel dil ("Gece" teması)
Lacivert-siyah zemin, çivit mavisi vurgu (`--accent`), cihaz renkleri vurgudan ayrı (`--dev-0..5`). Motor çalışırken arayüz sese
tepki verir; canlı seviyeler `lib/useLevels.ts` (`useLevels`, `speakerLevel`, `frameEnergy`) ile okunur:
ortam ışığı (`.ambient`, uygulama kökündeki `--energy` ile parlar), cam paneller (`.glass`), hoparlörlerin zemin ışığı
(`.light-pool`), hoparlörden dinleyiciye akan ışınlar ve parçacıklar (`.beam-flow`, `.particle`), hoparlör çevresinde seviye yayı
(`.level-arc`) ve zar titreşimi, bas vuruşunda şok dalgası (`.shockwave`; LFE ya da genel enerji kendi ortalamasının belirgin
üstüne sıçrayınca), dinleyici çevresinde **ses pusulası** (kanalların nominal açılarına göre yön göstergesi), üst çubukta akan
ışık (`.run-line`). `prefers-reduced-motion` açıkken sürekli animasyonlar durur. Uygulama simgesi `tools/make-icon.ps1` ile üretilir.

## Kurulum sihirbazı (`ui/src/lib/setup.ts`, `screens/SetupWizard.tsx`)
Tek kurulum akışı: **Hoparlörler → Yerleşim → Bitti** (VB-Cable'ı kapı halleder). Düzen sayısı yerine gerçek bağlantıdan yola
çıkar: kaynak ve sanal kablo uçları dışındaki her çıkış cihazı için "ne bağlı?" sorulur — 2.1 set (sol/sağ + dahili sub, bas
alıcısı), stereo çift (yeri, tipi, sol/sağ ters), tek hoparlör (rol) ya da çok kanallı sistem (kanal başına rol, Windows sırası
FL FR FC LFE BL BR SL SR varsayılan). Her kanal için test sesi vardır. Sihirbaz yeniden açılınca cevaplar mevcut hoparlörlerden
çıkarılır. Uygularken aynı cihaz + kanaldaki hoparlör korunur (kimlik, konum, EQ, gecikme/kazanç, kalibrasyon); rolü değişirse
yeni rol/karışım/ad alır, gecikme/kazancı otomatiğe döner, yalnızca tarafı değiştiyse standart konuma taşınır. Sihirbazın
listelemediği cihazlardaki hoparlörler olduğu gibi kalır; yeni hoparlörler rolün standart açısına yerleştirilir. Bitti adımı
"Sırayla dinle", "Odayı ölç" ve Başlat sunar. Hiç hoparlör yoksa ve kurulum yapılmamışsa ilk açılışta kendiliğinden açılır.

## Bildirimler
Kullanıcı boğulmasın diye en aza indirilmiştir:
- **Durum işareti** (üst çubuk): yalnızca sistem kontrolünün hata/uyarıları (`checkHealth` sonucundan `info` düzeyi
  süzülür) ve motor durumu. Sorun yoksa "Her şey yolunda" / "Hazır". Kesinti ancak 10'u bulunca işareti sarıya çevirir.
  Tıklayınca sorunlar düzeltme düğmeleriyle (`fixHealth`) açılır. Gezinmede rozet yoktur.
- Bildirim (toast) yalnızca hatalarda, silmede (Geri al düğmesiyle), boş kanal uyarısında, yedek yüklemede ve VB-Cable
  kurulunca çıkar; kaydetme, geri alma, kurulum/kalibrasyon tamam gibi başarı bildirimleri yoktur.

## Çıkış tamponu
Kullanıcıya tampon ayarı gösterilmez: motor çalışırken bir cihazda son büyütmeden bu yana en az 3 kesinti olursa o cihazın
`bufferMs`'i kendiliğinden 20 ms büyür (en çok 200 ms, iki büyütme arası en az 15 sn; geri alma geçmişine girmez).

## Geri al / yinele
Yapılandırmayı değiştiren her eylem (`commit`) önceki durumu geçmişe yazar (en fazla 100 adım). Aynı türden art arda gelen
değişiklikler (sürükleme, kaydırıcı) 0,9 sn içinde tek adım sayılır. Ctrl+Z / Ctrl+Y (veya Ctrl+Shift+Z), üst çubuktaki
düğmeler ve silme bildirimindeki "Geri al". Metin kutusundayken tarayıcının kendi geri alması çalışır. Geçmiş oturuma özgüdür.

## Sistem kontrolü
Saf fonksiyon (`ui/src/lib/health.ts`); seviyeler hata / uyarı / bilgi. Örnekler: hoparlör yok, kaynak cihaz yok ya da VB-Cable
değil, VB-Cable stereo ayarlı, hoparlörün cihazı bağlı değil / kanal yok / kaynak cihaza çıkıyor (geri besleme), aynı kanala iki
hoparlör, bas kesiliyor ama bas alıcısı yok, tek taraflı surround, ön çift eksik, stereo kaynakta upmix kapalı, sessizdeki
hoparlörler, çalışırken kesinti, cihaz bekleniyor (bkz. docs/api.md "Cihaz değişince"), Bluetooth hoparlör. Arayüz yalnızca
hata ve uyarıları gösterir.

## Bluetooth hoparlörler
`kind: "bluetooth"` cihazlar (Beats Pill vb.) sihirbazda "Bluetooth" rozeti ve gecikme notuyla, hoparlör panelinin cihaz
listesinde "· Bluetooth" ile görünür (~150–250 ms; ölçüm bunu ölçer, diğer hoparlörleri ona göre bekletir). Sihirbaz yeni
Bluetooth çıkışını `bufferMs: 150` ile açar. Store'daki `lowLatency` (Bluetooth/ağ cihazlarını dışarıda bırakır) 0.5.0'da
varsayılan kapalıdır ve arayüzde anahtarı yoktur. Hands-Free (HFP) uç noktası düşük kalite/mono olduğu için uyarı üretir.

## Arayüze özgü config alanları (motor yok sayar)
`speakers[].calibratedAt` (ISO; değerler ölçümden geldi), `setupDone`, `lastCalibration: { at, micDeviceId, speakers }`.
Hiçbir hoparlörün kullanmadığı `outputs` kaydedilmez.

## Önizleme (tarayıcı, sahte veri)
`npm --prefix ui run dev` → `http://localhost:5173`. Sorgu parametreleri: `?masaustu` (iki Realtek çıkışı + VB-Cable +
kulaklık mikrofonu, boş kurulum → sihirbaz açılır), `?bos` (boş kurulum), `?zayif` (ölçümde son hoparlör zayıf sinyal; otomatik
seviye yükseltmesiyle düzelir), `?nocable` (VB-Cable yok → kapı; tek tıkla kurulum başarılı olur ve kablo belirir),
`?yenidenbaslat` / `?kablohata` (kurulum yeniden başlatma ister / yönetici onayı reddedilir), `?tekcikis`, `?duvar` (telefon
güvenlik duvarına takılır), `?cable2ch` (kablo 2 kanal → kapı "7.1 yap"), `?bekle` (Başlat'tan 5 sn sonra bir çıkış "çıkarılır",
5 sn sonra döner: durum işareti "Bekleniyor").
Cihaz beklerken (`runState: 'waiting'`) Başlat düğmesi "Durdur" olur (beklemeyi bitirir).

## Gelişmiş EQ (Ses ekranı ve hoparlörün "Tüm ayarlar" çekmecesi)

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
