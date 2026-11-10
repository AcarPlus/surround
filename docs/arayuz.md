# Arayüz (v2)

Masaüstü arayüzü `ui/` altındadır (React + Zustand). Bu belge ekranları ve arayüze özgü davranışları özetler;
motor sözleşmesi için `docs/api.md`, ölçüm yöntemi için `docs/kalibrasyon.md`.

## Ekranlar
| Ekran | İçerik |
|---|---|
| Ana sayfa | Büyük Başlat/Durdur, profil kartları, **Sistem kontrolü** (`ui/src/lib/health.ts`), oda önizlemesi, hoparlör listesi (test sesi, sustur) |
| Oda | Oda planı (sürükle, ok tuşları 5 cm, Delete), hoparlör ekle (rol menüsü), düzen şablonu (önizlemeli), "Mesafeden hesapla", "Sırayla çal"; sağda sekmeli hoparlör paneli (Genel / Ses / Gelişmiş) |
| Ses | Upmix (stereo → çevresel) ve genel ses işleme (ön ayar, karakter, 10 bant EQ, limiter) |
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
`speakers[].calibratedAt` (ISO; değerler ölçümden geldi), `setupDone`, `lastCalibration: { at, micDeviceId, speakers }`.
Hiçbir hoparlörün kullanmadığı `outputs` kaydedilmez.

## Önizleme (tarayıcı, sahte veri)
`npm --prefix ui run dev` → `http://localhost:5173`. Sorgu parametreleri: `?masaustu` (iki Realtek çıkışı + VB-Cable +
kulaklık mikrofonu, boş kurulum → sihirbaz açılır), `?bos` (boş kurulum), `?zayif` (kalibrasyonda son hoparlör zayıf sinyal),
`?nocable`, `?cable2ch`, `?bekle` (Başlat'tan 5 sn sonra bir çıkış "çıkarılır", 5 sn sonra döner: üst çubukta "Cihaz bekleniyor").
Cihaz beklerken (`runState: 'waiting'`) üst çubuktaki durum etiketi uyarı renginde eksik cihazları yazar, Başlat düğmesi
"Durdur" olur (beklemeyi bitirir).
