# Mikrofonla kalibrasyon

Dinleme noktasındaki bir mikrofonla her hoparlörün referans hoparlöre göre **varış zamanı** (ms) ve **seviyesi** (dB) ölçülür;
arayüz bunlardan `delayMs` / `gainDb` önerir. Kod: `src/Surround.Engine/Calibration`, köprü: `calibrate` / `cancelCalibration`
(bkz. docs/api.md), komut satırı: `surround calibrate`.

## Neden gerçek çıkış yolundan?
Test sinyali normal çalmadaki yoldan geçer: cihaz başına `OutputSink` (yapılandırılmış `bufferMs`, halka tampon, sürüklenme telafili
yeniden örnekleyici, sınırlayıcı). Böylece cihazların farklı çıkış gecikmeleri ölçüme girer; `delayMs`'in telafi etmesi gereken de budur.
Kaynak yakalama yerine programı mikrofonun kendisi saatler (her mikrofon paketi kadar program karesi üretilir), tıpkı normalde kaynağın saatlediği gibi.

Her hoparlör kendi mantıksal şeridinden 0 dB ile çalınır: hoparlörün `delayMs`, `latencyMs` telafisi, `gainDb`, EQ, yüksek geçiren,
bas yolu, genel işleme ve upmix **devre dışıdır**. Sınırlayıcı yapılandırıldığı gibi kalır (−20 dBFS'te hiç devreye girmez; gecikmesi her cihazda aynı).

## Ölçüm programı
1. Isınma (1 sn) — çıkışlar dolar.
2. Gürültü (1,2 sn sessizlik) — mikrofon gürültü tabanı.
3. Her adımda: referans hoparlörde süpürme, tam 1,0 sn sonra test hoparlöründe süpürme (adım 2,4 sn). Hoparlörler sırayla, tüm tur `repeats` kez.

Süpürme: üstel sinüs süpürmesi 20 Hz → 16 kHz (en çok 0,45·örnekleme hızı), 0,6 sn, yumuşak giriş/çıkış, tepe `levelDb` (varsayılan −20 dBFS).

## Analiz
- Her süpürme mikrofonun kendi örnekleme hızında yeniden üretilen süpürmeyle **ters evrişim** yapılır (FFT, düzenlenmiş spektral bölme),
  bant sınırlı analitik dürtü yanıtının zarfı alınır. Bantlar: zamanlama 150 Hz – ~0,9·üst sınır, seviye 200 Hz – 6 kHz, bas 25–180 Hz.
- **Varış = doğrudan sesin başlangıcı**, en büyük tepe değil (yansıma daha güçlü olabilir): pencere maksimumunun %35'ini aşan ilk örnek
  (maksimumdan en çok 20 ms — basta 60 ms — öncesinde aranır), sonra o ilk tepenin üstü parabolik ara değerlemeyle örnek altı hassasiyette.
- **Göreli varış** = (test varışı − kendi itme anı) − (referans varışı − kendi itme anı), aynı adım içinde. Mikrofon/motor başlangıç
  belirsizliği ve yavaş saat kayması böylece düşer.
- **Halka gecikmesi telafisi**: ölçüm sırasında sürüklenme denetleyicisi çok yavaş çalışır (süpürme boyunca oran sabit kalsın diye);
  cihaz başına halkadaki gecikme, mikrofon ve oynatma geri çağrılarının zaman damgalarına oturtulan doğrularla izlenir ve normal çalmadaki
  hedefe (`bufferMs`) göre fark çıkarılır. Yani sonuç, cihazın kararlı durumdaki gecikmesini yansıtır.
- **Seviye** = seviye bandındaki dürtü yanıtının ilk kısmının enerjisi (başlangıçtan −2…+5 ms; basta −10…+40 ms), bant genişliğine bölünmüş
  (bas hoparlörü ile tam bant hoparlör de karşılaştırılabilsin diye ortalama spektral yoğunluk).
- Tekrarların **medyanı** raporlanır; `spreadMs` = maks − min. Alt akış/taşma olan adımlar atlanır.
- **SNR**: zarf tepesi / gürültü; gürültü, sessiz giriş bölümünün ve süpürmenin kendi yanıtındaki geç (sinyalsiz) bölümün büyüğüdür
  (gürültü engelleyici ENC mikrofonlar sessizlikte sayısal sıfır verebilir; giriş bölümü o zaman −120 dBFS görünür).
- Uyarılar (`message`): SNR < 15 dB ("Sinyal çok zayıf"), sinyal algılanamadı, mikrofon kırpıldı, tekrarlar tutarsız
  (> 0,5 ms; basta > 3 ms), bas bandında ölçüldü. SNR < 10 dB ise `ok: false`.

## Bas hoparlörleri
`lowBandSpeakerIds` verilirse yalnızca onlar, verilmezse karışım satırı sadece LFE olanlar bas bandında ölçülür. Bir adımda referans ya da test
bas hoparlörüyse ikisinin zamanlaması da bas bandında karşılaştırılır (`lowBand: true`); bu ölçüm hoparlörün ve odanın grup gecikmesini içerir,
daha az güvenilirdir.

## Test modu (mikrofonsuz)
`micLoopback: true` (CLI: `--mic-loopback`) ile "mikrofon" bir çıkış cihazının loopback'idir. Aynı cihazdaki iki hoparlör arasında varış
≈ 0 ms, seviye ≈ 0 dB çıkmalıdır (saf sayısal yol); yapılandırmadaki farklı `delayMs`/`gainDb` sonuca girmemelidir. Kanallar ortalanarak tek
kanala indirilir. Başka cihazdaki hoparlörler bu modda duyulmaz ("algılanamadı").

## Sınırlar
- Normal çalmada her cihazın gecikmesi, kaynak paketleri ile çıkış geri çağrılarının faz ilişkisine göre en çok bir yakalama paketi
  (~10 ms) kadar yavaşça oynayabilir (motorun sürüklenme denetleyicisi halkanın geri çağrı anındaki doluluğunu izler). Kalibrasyon bunun
  ortalamasını ölçer; bu oynama motorun kendi özelliğidir.
- Ham (RAW, işlemesiz) mikrofon akışı istenmez; ENC'li mikrofonlarda süpürme genelde geçer, SNR ve `spreadMs` kontrol edilmeli.
- Loopback kaynak cihazındaki hoparlörler (Windows'un doğrudan çaldıkları) ölçülemez: atlanır, sonuçta `ok: false` ve
  "Kaynak cihazdaki hoparlör ölçülemez." ile yer alır; referans kaynak cihazda olamaz. En fazla 12 hoparlör.

## Telefonla (QR kod)
Mikrofonu olmayan ya da kulaklık mikrofonu dinleme noktasına uzanmayan kullanıcılar için telefon mikrofonu kullanılır
(kod: `src/Surround.Engine/Phone`, `Calibration/ExternalAlignment.cs`; köprü: `phoneLink*`, bkz. docs/api.md).

- **Bağlantı:** Surround yerel ağda küçük bir HTTPS sunucusu açar (port 47810, doluysa sonraki 9). Telefon tarayıcıları
  mikrofonu yalnızca güvenli bağlamda (HTTPS) verir; sertifika kendinden imzalıdır (`%AppData%\Surround\phone-cert.pfx`,
  ECDSA P-256, 2 yıl, SAN = bu PC'nin yerel IPv4 adresleri; adres değişince yenilenir). Telefon ilk açılışta bir kez
  "bağlantı gizli değil" uyarısı gösterir. Her yol QR'daki rastgele belirteci (`/c/<token>`) taşır; diğeri 404.
  Windows Güvenlik Duvarı (özellikle ağ "Ortak" işaretliyse) bağlantıyı sessizce düşürür; telefonda "yanıt vermesi çok
  uzun sürdü" görünür. `PhoneFirewall.IsAllowed` bunu kural tablosundan algılar (`firewall: false`), QR panelindeki
  "İzin ver" (`phoneLinkAllowFirewall`) tek UAC onayıyla bu programın tüm kurallarını (Windows'un iptal edilen sorudan
  sonra eklediği engelleme kuralları dahil) siler ve tek bir kural ekler: gelen TCP 47810–47819, yalnız yerel alt ağ,
  tüm profiller.
- **Telefon sayfası** (`Phone/phone.html`, gömülü): `getUserMedia` (yankı giderme, gürültü bastırma, otomatik kazanç
  KAPALI istenir; tarayıcı kapatmazsa `hello` ile bildirilir ve sonuçta not olarak görünür), ekran uyanık tutulur
  (Wake Lock). Durumu 250–600 ms'de bir yoklar: `record` → kaydı başlatır ve `api/recording` ile onaylar; `upload` →
  0,5 sn sonra durur, ham float32 mono'yu `api/upload?rate=` ile gönderir. Telefondaki "Ölçümü başlat" PC arayüzüne
  `phoneStart` olayı olarak gider; ölçümü (hoparlörler, referans, konum) PC belirler.
- **Saat:** program, mikrofon yerine ilk çıkış cihazının loopback'iyle saatlenir (o cihaz programı çaldığı için paketleri
  onun hızında gelir). Telefon kaydı ayrı bir saattedir; `ExternalAlignment` önce süpürme desenini (her adımda referans
  + 1 sn sonra test) 1 ms kutulara indirgenmiş geniş bant zarfında kaydırarak başlangıcı bulur (desenin tamamı yalnızca
  doğru yerde oturur; bir adım/tur kayması en az bir adımı kaybeder), sonra her adımın referans tepesinden sağlam bir
  doğru (Theil–Sen) geçirip hız oranını çıkarır (telefon–PC farkı tipik ±100 ppm). Eşleme, her itmeyi referansın
  varışından 0,4 sn önceye koyar; varış penceresi 0,8 sn (diğer hoparlörler referanstan ±0,4 sn farklı olabilir:
  Bluetooth ~330 ms dahil). Sonuç yine adım içi göreli farktır.
- **Hata:** telefon bağlı değilse, 15 sn içinde kayda başlamazsa ya da 60 sn içinde kayıt gelmezse ölçüm durur;
  kayıtta desen bulunamazsa "ölçüm sesi bulunamadı". Referans seviyesi adımlar arasında 2 dB'den fazla oynarsa
  "otomatik kazanç açık olabilir" uyarısı verilir.

## Frekans yanıtı ve tını eşleme
`responses: true` (telefonla her zaman) ile her süpürmenin dürtü yanıtı direkt sesten 2 ms önce başlayıp 60 ms düz +
20 ms sönümle kapılanır, FFT'si 1/6 oktav güç ortalamasıyla 100 Hz'den 1/12 oktav ızgaraya (89 nokta, ~16 kHz)
indirilir; tekrarlar güçte ortalanır (`responseDb`, `responseHz`). Kazanç ve `roomEq` hariçtir. Kapı, direkt ses ve erken
yansımaları (koltuktaki tınıyı belirleyen kısım) tutar, odanın geç kuyruğunu (her hoparlörde ortak) atar.

Arayüz (`ui/src/lib/roomEq.ts`) bunlardan `speaker.roomEq` önerir:
- 1, 3 ya da 5 konumda ölçülür (ilki dinleme noktası; gecikme/seviye oradan), yanıtlar konumlar arasında güçte ortalanır.
- Eğriler 500 Hz–4 kHz ortalamasına hizalanır (seviye kazançla ayrıca eşitlenir). Aynı mikrofonla ölçüldüğü için
  mikrofonun rengi farkta düşer: mutlak düz eğri değil hoparlörler arası eşleşme hedeflenir.
- Hedef: referans hoparlörün eğrisi (ona EQ yok) ya da hepsinin ortalaması.
- Eşleme bandı: 150 Hz (bas yönetimi varsa kesimin 1,3 katı) ile 12 kHz arası, ayrıca hoparlörün kendi düşüş
  noktaları (500 Hz altında −6 dB, 4 kHz üstünde −10 dB) dışarıda. Subwoofer eşlenmez.
- Açgözlü tepe yerleştirme: en büyük kalan hatanın yerine bir tepe bandı, genişliği yarı yükseklikten; frekans/kazanç/Q
  küçük ızgarada iyileştirilir; en çok 8 bant, 1 dB altı hata için bant eklenmez; sonra kazançlar birlikte ayarlanır.
  Yükseltme toplamda en çok +6 dB (çukur doldurmak hoparlörü zorlar), kısma en çok −12 dB.

## Doğrulama
`applyCorrections: true` ile hoparlörler `delayMs` (motorun etkin gecikmesi), `gainDb` ve `roomEq` açıkken çalınır.
Sonuçta `residualArrivalMs` / `residualLevelDb` şu an duyulan farktır; `arrivalMs` / `levelDb` / `responseDb` ise
bilinen düzeltmeler geri çıkarılarak düzeltmesiz değere çevrilir (`verified: true`), böylece aynı öneri mantığı yeniden
çalışır. Arayüz ±0,5 ms / ±1 dB içini "iyi" sayar; tını için mevcut `roomEq` ile sapmayı gösterir ve gerekirse yeni
öneriyi uygulatır. Hepsi eşleşene kadar tekrarlanabilir.
