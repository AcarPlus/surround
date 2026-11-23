# Esnek düzen sözleşmesi (X.Y.Z, roller, üst hoparlörler)

## Mantıksal kanallar

8 → 12 kanal. İlk 8 değişmez (WAVEFORMATEXTENSIBLE 7.1 sırası), sonra 4 üst şerit:

`FL FR FC LFE BL BR SL SR TFL TFR TBL TBR`

- Kaynaklar en fazla 8 kanal getirir; üst şeritler her zaman **türetilir**:
  - Upmix (stereo içerik): ortam (ambient) bileşeninin ~200 Hz üstü → TFL/TFR (ön ortam) ve TBL/TBR (arka ortam).
  - Yerel 7.1: FL/FR ortamı (yan/fark sinyali, dekorele) → TFL/TFR; SL/SR+BL/BR ortamı → TBL/TBR.
- Üst şeritler ek sinyaldir (diğer kanallardan enerji çalmaz), seviyesi `upmixOptions.heightDb` (-24..+6, varsayılan -3) ile.
- Hiçbir hoparlörün satırında yer almayan üst şerit hesaplanmaz (CPU) ve katlanmaz (yerel içerikte karşılığı yok).

## Roller (arayüz → hoparlör `source` satırı)

| Rol | Satır |
|---|---|
| Sol / Sağ / Orta | FL / FR / FC |
| Yan sol / Yan sağ | SL / SR |
| Arka sol / Arka sağ | BL / BR |
| Arka orta | BL 0.707 + BR 0.707 |
| Geniş sol / Geniş sağ | FL 0.707 + SL 0.707 / FR 0.707 + SR 0.707 |
| Subwoofer | LFE 1, `bassReceiver: true` |
| Üst ön sol / sağ, Üst arka sol / sağ | TFL / TFR / TBL / TBR |
| Üst orta | TFL, TFR, TBL, TBR × 0.5 |
| Özel (haritadan) | Dinleyiciye göre açıdan VBAP (aşağıda) |

Hoparlöre `role` alanı yazılır (yalnızca arayüz; motor yok sayar). Rol seçimi satırı üretir; kullanıcı satırı elle değiştirirse rol "Özel (elle)" olur.

## Özel (haritadan) — otomatik karışım

Hoparlör konumu (x, y) ve dinleyiciden açı θ (0° = ön, + = sağ). Zemin hoparlöründe nominal açılar:
FC 0°, FR +30°, SR +90°, BR +150°, BL −150°, SL −90°, FL −30°.
θ'yı çevreleyen iki komşu nominal kanal arasında sabit güçlü 2B VBAP (sin/cos pan). `elevated: true` (üst hoparlör) ise aynı yöntem üst şeritlerle: TFL −45°, TFR +45°, TBR +135°, TBL −135°. Hoparlör taşındıkça satır yeniden hesaplanır.

## Konuma göre dağıt (0.5.11) — kanaldan hoparlöre

Oda ekranındaki "Konuma göre dağıt" anahtarı (`positionalMix`, config kökünde) açıkken roller karışımı belirlemez:
her içerik kanalı kendi nominal açısında (yukarıdaki açılar) çalınır ve o açıya en yakın iki gerçek hoparlör arasında
sabit güçle (sin/cos) paylaştırılır (`lib/positional.ts`). Örnek: orta 0°, sağ 60° → FR (30°) ikisinden 0,707 + 0,707;
SR/BR 60°'nin ötesinde hoparlör olmadığından tamamen 60°'dekine. Her kanalın güç toplamı 1.

- "Özel (haritadan)"dan farkı: o rol hoparlörden kanala bakar (hoparlör kendi açısındaki kanalları örnekler); bir kanal
  iki hoparlörden fazla, başka biri hiç çıkmayabilir ve seviye korunmaz.
- İki komşu hoparlör arası 120°'den genişse (`MAX_PAIR_SPAN`) aradan hayali ses kurulmaz, kanal yakın olana gider
  (yalnız önde hoparlör varken arka kanal iki ön hoparlör arasında "önden" gelmesin).
- Aynı yöndeki (±1°) hoparlörler kanalı güçte eşit paylaşır. Sub (rol `sub`), sessize alınmış ve dinleyicinin
  üstündeki hoparlörler katılmaz; üst hoparlörler kendi halkasında aynı yöntemle.
- Motor değişmez: arayüz motora giden config'te katılan hoparlörlerin `source`'unu konumdan hesaplar, rol satırını
  `roleSource`'ta saklar; açılışta `source` oradan geri alınır. Mağazada (geri alma, rol) hep rol satırı durur.
- Hoparlör kartında gerçek karışım (ör. "FL %50 · SL %35", güç yüzdesi) ve sayıyla yön girişi (uzaklık korunur)
  vardır; yön mikrofonla ölçülemez, doğruluğu sahnedeki yerleşime bağlıdır.
- Tam kanal açısındaki hoparlör o kanalı tek başına çalar: standart yerleşimde ön/orta satırları rollerle aynıdır;
  araya düşen kanallar (ör. 5.1 düzende SL) iki komşu arasında yönünden duyulur.

## Düzen girişi

Oda ekranında "Düzen" kutusu: `X.Y` veya `X.Y.Z` (ör. `3.1`, `4.2`, `5.1.4`, `3.1.3`). X zemin, Y sub, Z üst hoparlör sayısı (her biri 0..16). Uygulama bu kadar hoparlör yuvası oluşturur, oda haritasına makul konumlara dizer ve varsayılan rol önerir; kullanıcı her birinin rolünü açılır listeden değiştirir. Mevcut hoparlörlerin cihaz/kanal/EQ ayarları rol sırasına göre korunur.

## Motor ayrıntıları (uygulamada netleşenler)

- `Channels.Count = 12`, `Channels.SourceCount = 8`. Kaynak eşlemesi (`MapForSourceChannels`) değişmedi; 8'den fazla kaynak kanalında ilk 8'i 7.1 olarak alınır, üst şeritlere kaynak hiçbir zaman yazmaz. Doğrulayıcı 12 adı (büyük/küçük harf duyarsız) kabul eder; bilinmeyen adda Türkçe hata 12 adın listesini verir.
- "Kullanılan" küme (susturulmamış hoparlör satırlarında katsayı ≠ 0) artık 12 elemanlı. Üst şerit hiçbir hoparlörde yoksa: türetici nesnesi hiç oluşturulmaz, genel işleme o şeridi atlar, şerit 0 kalır (ölçerde -90). Böylece eski (8 kanallı satırlı) config'ler bayt bayt aynı zemin sinyalini üretir.
- `ChannelFold`: üst şeritler ne katlanır ne de katlama hedefi olur (aday listeleri boş).
- Seviye: `upmixOptions.heightDb` (-24..+6, varsayılan -3; alan yoksa -3). Canlı (`UpdateLive`, 30 ms yumuşatma), `EngineFingerprint`'ten dışlı; aralık dışı `ConfigValidator` hatası (`upmixOptions.heightDb -24..6 aralığında olmalı`), DSP ayrıca kırpar (NaN → -3).
- Ortak: türetilen sinyal 200 Hz 2. derece Butterworth yüksek geçirenden geçer, yalnız üst şeritlere ait 3 kademeli all-pass ayrıştırıcılardan (g = 0,5; sol 1,3/3,7/6,7 ve 1,7/4,1/7,3 ms; sağ 1,5/3,9/7,1 ve 2,1/4,6/6,9 ms — zemin surround setlerinden farklı) ve surround'larla aynı 10 ms öncelik gecikmesinden geçer. Ek sinyaldir; zemin kanalları değişmez (test: üst şeritli ve şeritsiz düzenin zemin çıkışı örnek örnek aynı).
- Upmix (her iki mod, `HeightRenderer`): kaynak, surround'ları besleyen zaman alanı ortam çifti (AL, AR). Bir tarafta hem ön hem arka üst varsa tamamlayıcı çift: `ön = (H1 + H2)/2`, `arka = (H1 − H2)/2` (güçler toplamı = ortam gücü × kazanç²; `ön + arka = H1`, "Üst orta" hoparlöründe tarak yok); tek üst şerit varsa ona düz `H1`. 0 dB'de bir taraftaki üst şeritler birlikte o tarafın ortam gücü kadar taşır. `surroundDb` üst şeritlere uygulanmaz.
- Yerel / upmix kapalı (`NativeHeights`): ön ortam = yan sinyal `(FL − FR)/2` → TFL (+), TFR (−); arka ortam = `((SL + BL) − (SR + BR)) / (2√2)` → TBL (+), TBR (−); her şerit kendi ayrıştırıcısından. İlişkisiz FL/FR (her biri p gücünde) her üst şeride p/2 × kazanç² verir (upmix'te iki üst şeritli tarafla aynı). Ortalanmış (mono) ön içerik ön üst şerit üretmez.
- Uyarlanır upmix'te (çok kanallı kaynak) yerel yolun üst şeritleri gecikmeli yerel sinyalden hesaplanır ve upmix yoluyla aynı 30 ms çapraz geçişe girer; türetici upmix sırasında da çalışır (geçişte sıcak). Stereo algılayıcı yalnız kaynak şeritlerine (FC..SR) bakar; eşikler/süreler değişmedi. 2 kanallı kaynak + upmix açık: üst şeritler yalnız upmixer'dan. Upmix kapalı (veya mono kaynak): `NativeHeights` doğrudan motor zincirinde, upmix aşamasının yerinde.
- Genel işleme (`GlobalProcessor`) kullanılan üst şeritlere de aynı EQ/sıkıştırıcıyı uygular; `ambience` genişletmesi TFL/TFR ve TBL/TBR çiftlerine yalnız çiftin iki şeridi de kullanılıyorsa uygulanır.
- Köprü `levels` olayı aynı biçimde (ad → dBFS nesnesi), 12 anahtarla. CLI `run` başlangıçta türetilen üst şeritleri loglar (`Üst kanallar: TFL, TFR … türetiliyor (-3 dB)`).
- Ölçüm: CLI `run` (FxSound loopback, iki 2 kanallı çıkış, ön hoparlörlerde TFL/TFR 0,5, arkalarda TBL/TBR 0,5) her iki modda 8 sn'de 0 underrun (film modunda 4 koşudan birinde açılışta 1 underrun; üst şeritsiz aynı config'te de görülen başlangıç geçişi).
