# Upmix ve kanal katlama

Ucuz hoparlörlerde oyun ve filmleri gerçekten çevresel duyurmak için: stereo içerikten 7.1 üretmek (upmix) ve
hoparlörü olmayan kanalları kullanılan komşulara katlamak. Kod: `src/Surround.Engine/Dsp/` (`AdaptiveUpmix.cs`,
`GameUpmixer.cs`, `FilmUpmixer.cs`, `UpmixCommon.cs`, `Fft.cs`). Akıştaki yeri için bkz. docs/ses-isleme.md.

## Config

`upmix` (bool) açık/kapalı anahtarı olarak kalır (geriye uyum). Ayrıntılar `upmixOptions` altında; alan yoksa varsayılan.

| Alan | Tip / aralık | Varsayılan | Anlam | Canlı |
|---|---|---|---|---|
| `mode` | `"game"` \| `"film"` | `"film"` | Oyun: zaman alanı matris çözücü, ön kanallara gecikme yok. Film: STFT, ~21 ms | Hayır (yeniden başlatır) |
| `centerDb` | -12..+6 | 0 | Orta (diyalog) seviyesi | Evet |
| `surroundDb` | -12..+6 | 0 | Yan/arka kanallara yönlenen her şeyin seviyesi | Evet |
| `lfeEnabled` | bool | true | Orta sinyalden LFE türet | Evet |

Canlı alanlar `EngineFingerprint`'ten dışlanır, `SurroundEngine.UpdateLive` ile uygulanır; kazançlar 30 ms'de yumuşatılır.
Aralık dışı değerler `ConfigValidator` hatasıdır.

## Uyarlanır stereo algılama (`AdaptiveUpmix`, `StereoDetector`)

- 2 kanallı kaynak: upmix her zaman çalışır.
- 2'den fazla kanal (ör. 7.1 VB-Cable): FL/FR dışındaki kanalların tepe zarfı (10 ms bırakma) izlenir.
  - **Stereo** durumuna geçiş: zarf **-70 dBFS altında 300 ms** kalırsa.
  - **Yerel** duruma dönüş: zarf **-64 dBFS üstünde 5 ms** kalırsa.
  - Aradaki 6 dB ve farklı süreler histerezis sağlar; -67 dBFS gibi ara seviye durumu değiştirmez, 200 ms'lik
    boşluklar yerel durumu bozmaz.
- Durumlar arası **30 ms** smoothstep çapraz geçiş (iki yol ilişkili olduğundan kazançlar toplamı 1). Yerel yol,
  upmix'in gecikmesi kadar geciktirilir; böylece geçişte zaman kayması olmaz (film modunda tüm zincir sabit ~21 ms
  gecikir). Upmixer hep çalışır, geçişe sıcak başlar. Gerçek çok kanallı içerik geldiğinde dönüş ≈ 5 ms + 30 ms.
- Başlangıç durumu stereo; ilk çok kanallı örnekte 5 ms içinde yerele döner.
- Durum `EngineStatus.UpmixState` (`Off`/`Stereo`/`Native`) ve köprüde `engine` olayı (`upmix: "off" | "stereo" |
  "native"`) ile arayüze gider: "Upmix etkin (stereo içerik)" / "Yerel 7.1".

## Oyun modu (`GameUpmixer`)

Pro Logic II ruhunda, kendi tasarımımız; örnek başına, ön kanallara **0 örnek** ek gecikme.

1. **Yönlendirme dedektörü:** 150 Hz yüksek geçirenden geçmiş L/R'nin tek kutuplu (20 ms) kovaryansı
   `pLL, pRR, pLR`. L/R ekseni `(pL-pR)/(pL+pR)`, ön/arka ekseni `(p(L+R)-p(L-R))/(pL+pR) = 2pLR/(pL+pR)`; ikisi
   birlikte bir yön φ (0° sol, 90° orta, 180° sağ, -90° arka/ters faz) ve baskınlık (vektör boyu) verir. Bu, 2×2
   kovaryansın baş özvektörünün açısının iki katıdır.
2. **Ayrıştırma:** (L,R) baş yöne döndürülür: `s = cos(φ/2)·L + sin(φ/2)·R`, `a = -sin(φ/2)·L + cos(φ/2)·R`.
   Özdeğerler λ1 ≥ λ2 ile birincil `P = s·√(1-λ2/λ1)`; s'nin kalanı ve a geri döndürülerek ortam çifti (AL, AR) olur.
   Dönüş ortonormal: enerji örnek örnek korunur.
3. **Birincil yönlendirme:** P, çember üzerindeki kullanılabilir iki komşu hoparlör arasında sabit güçle (sin/cos)
   kaydırılır: FL 0°, FC 90°, FR 180°, SR 210°, BR 250°, BL 290°, SL 330°. Tam sola kaydırılmış ses (φ = 0) FL'de
   kalır, ortalanmış diyalog FC'ye gider. Özvektörün işareti belirsiz olduğundan (e ve -e) sağ taraf düğümleri R'nin,
   sol taraf düğümleri L'nin polaritesini alır; her düğümün kazancı kendi referansının döndüğü noktada sıfırdır, yani
   tam sağ civarında tıklama/faz dönmesi olmaz.
4. **Ortam:** gücünün %40'ı FL/FR'de kalır, %60'ı yan/arka kanallara: tamamlayıcı all-pass ayrıştırıcılar + 10 ms
   öncelik (precedence) gecikmesi (aşağıda). FL/FR'de birincil ve ortam aynı `s` bileşenini taşıdığından katsayıları
   güç toplamı olarak birleştirilir (eşevreli toplanıp enerji eklemesin diye).
5. **Seviye denetimleri:** P, tam 7.1 çemberindeki konumuna göre ölçeklenir (`centerDb` FC payı, `surroundDb`
   yan/arka payı), böylece orta hoparlör yokken de diyalog seviyesi çalışır. `surroundDb` ortamın yan/arka kısmına da
   uygulanır.

Sınırlama: geniş bant tek yön tahmini, aynı anda birden çok baskın kaynak varken (ör. tam sol gitar + orta vokal)
bir kısmı ortama ve karşı tarafa sızdırır (ölçüm: ~%5 FR, ~%15 surround). Kaliteli seçenek film modudur.

## Film modu (`FilmUpmixer`)

STFT: kare N = 1024 (≤ 50 kHz; üstünde 2048), atlama N/4, karekök-Hann analiz/sentez, örtüşerek toplama.
**Gecikme tam N örnek = 21,3 ms @ 48 kHz.** FFT: kendi tahsissiz radix-2 karmaşık FFT'miz (`Fft.cs`); L ve R tek
karmaşık FFT'de (L + iR) dönüştürülür, 5 gerçek çıkış (FL, FR, FC, AL, AR) üç ters FFT'de ikişerli paketlenir
(FC yoksa onun FFT'si atlanır).

Her frekans kutusunda (bin), 35 ms zaman + 3 kutu frekans yumuşatmalı karmaşık kovaryans `pLL, pRR, E[L·R*]`:
1. **Tutarlılık yanlılık düzeltmesi:** sınırlı ortalamada ilişkisiz sinyal bile |γ|² ≈ 1/16 gösterir;
   `γ'² = (γ² - 1/16)/(1 - 1/16)` bunu 0'a, tam tutarlıyı 1'de tutar.
2. **Birincil/ortam ayrıştırma:** baş özvektör `v = (cos θ, sin θ·e^-iΔ)` (Δ kanallar arası faz); `s = vᴴx`,
   `a = v⊥ᴴx`; birincil `s·√(1-λ2/λ1)`, kalan geri döndürülüp ortam çifti. Üniter: kutu kutu enerji korunur.
3. **Orta çıkarma:** birincilin eş fazlı kısmı (ağırlık `max(0, cos Δ)`) kaydırma indeksi 2θ ile FL/FC/FR'ye sabit
   güçle kaydırılır (`FL = max(cos2θ,0)`, `FC = sin2θ`, `FR = max(-cos2θ,0)`); ters fazlı kısım FL/FR'de pasif kalır.
   FL L'nin, FR R'nin fazında, FC ikisinin ortasında (√conj(e^iΔ)) üretilir. FC yoksa birincil düz stereo
   kaydırma olarak FL/FR'de kalır (`centerDb` yine etkili).
4. **Ortam:** %40 FL/FR'de (oyun modundaki güç toplamı birleştirmesiyle), kalan zaman alanına dönüp aynı
   tamamlayıcı ayrıştırıcılardan SL/SR ve BL/BR'ye.
5. **LFE:** orta sinyalin (L+R)/2 LR4 120 Hz alçak geçireni, STFT yoluna hizalanacak kadar (N) geciktirilmiş.

## Ortak: yan/arka işleyici (`SurroundRenderer`)

Her taraf için iki farklı 3 kademeli Schroeder all-pass zinciri (g = 0,5; sol: 1,9/4,4/7,9 ve 2,7/5,3/9,1 ms;
sağ: 2,3/4,9/8,3 ve 3,1/5,9/9,7 ms). Tamamlayıcı çift: `yan = (H1·A + H2·A)/2`, `arka = (H1·A − H2·A)/2`.
Güçlerin toplamı girişin gücüne eşit; ayrıca `yan + arka = H1·A` (düz genlik), yani katlanan bir düzende hiçbir şey
kaybolmaz ve tarak süzgeci oluşmaz. Sol/sağ ve yan/arka hep farklı süzgeç alır. Tarafta tek surround hoparlör varsa
oraya düz `H1·A` gider. Tüm yan/arka çıkışlar 10 ms gecikir (öncelik etkisi görüntüyü önde tutar).
Durum değişkenleri 1e-20 altında sıfırlanır (sessizlikte denormal yok; `Biquad` da 1e-25 altında temizler).

## Düzen farkındalığı ve kanal katlama (`ChannelFold`)

Başlangıçta, susturulmamış hoparlörlerin karışım satırlarından (katsayı ≠ 0; bası kesilen hoparlörler de sayılır)
"kullanılan" kanallar çıkarılır. Kullanılmayan her kanal, aşağıdaki ilk kullanılabilir hedef grubuna sabit güçle
(tek hedef: 1, iki hedef: -3 dB) taşınır; genel işleme ve ölçerlerden sonra, bas yolundan önce:

| Kanal | Hedef sırası |
|---|---|
| FC | FL+FR → SL+SR → BL+BR |
| SL / SR | BL / BR → FL / FR → FC → karşı yan |
| BL / BR | SL / SR → FL / FR → FC → karşı arka |
| FL / FR | FC → SL / SR → BL / BR → karşı ön |
| LFE | katlanmaz; bas alıcısı kuralı (docs/ses-isleme.md) |

Örnek (FL/FR 2.1 ön + BL/BR arka uydu düzeni): `FC→FL (-3 dB), FC→FR (-3 dB), SL→BL, SR→BR`. Yerel 7.1 oyun
seslerinin SL/SR'si BL/BR'den, FC diyaloğu FL+FR'den çıkar.

Upmixer'lar aynı "kullanılan" kümeyi `UpmixLayout` olarak alır ve yalnızca kullanılabilir kanallara yönlendirir:
ortalanmış bir kaynak FC yokken doğrudan FL/FR arasında kaydırılır (katlama eşevreli iki kopyayı toplayıp +3 dB
hatası yapmasın diye), tek surround hoparlörlü tarafta tamamlayıcı çift yerine düz `H1·A` kullanılır, hiç surround
yoksa ortamın tamamı önde kalır. Katlama upmix çıkışında bu yüzden boşta kalır; yerel çok kanallı içerik içinse esastır.

## LFE kuralı (çift sayım yok)

- Yerel çok kanallı kaynakta (2'den fazla kanal) LFE, satırında LFE olmayan bas alıcılarına eklenir (upmix açık
  olsa da, çünkü içerik her an yerele dönebilir).
- Upmix'in türettiği LFE yalnızca **satırında LFE olan bir hoparlör varsa** üretilir (`UpmixLayout.LfeAllowed`).
  2.1 ön hoparlörleri bas alıcısı olan düzende türetilmiş LFE yoktur: ön sinyal basını zaten taşır, alıcıya ikinci
  kez katlanmaz. Bu düzende `lfeEnabled` etkisizdir. (Nadir karışık durum: hem LFE'ye atanmış bir sub hem de
  LFE'siz bir alıcı varsa, türetilmiş LFE o alıcıya da katlanır.)

## Ölçümler (Release, 48 kHz)

| | Oyun | Film |
|---|---|---|
| Ön kanal gecikmesi | 0 | 1024 örnek = 21,3 ms |
| Yan/arka ek gecikme | +10 ms (öncelik) | +10 ms |
| CPU (bir çekirdek, upmixer) | ~%0,5 | ~%0,9 |
| Enerji (çıkış/giriş, LFE hariç) | ±0,05 dB | ±0,06 dB |
| İlişkisiz stereo → surround payı | ~%60 | ~%42 |
| Ortalanmış mono → FC | %100 | %100 |
| Tam sol → FL | %100 | %100 |

CLI `run` (FxSound loopback kaynağı, iki çıkış, işleme açık) her iki modda 8 sn'de 0 underrun.
