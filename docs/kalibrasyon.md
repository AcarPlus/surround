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
