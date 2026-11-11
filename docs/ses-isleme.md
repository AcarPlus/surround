# Ses işleme sözleşmesi (EQ, bas yönetimi, limiter)

Motor (C#) ile arayüz (TS) arasındaki config alanları. JSON camelCase. Alan yoksa varsayılan geçerli.

## Ses akışı

```
yakalama → mantıksal 12 kanal (map: kaynak en fazla 7.1 doldurur; üst şeritler türetilir, bkz. docs/duzen.md)
         → upmix (açıksa; çok kanallı kaynakta yalnızca içerik stereo iken, bkz. docs/upmix.md)
         → [genel işleme: preamp, 10 bant EQ, bas güçlendirme, netlik, dinamik güçlendirme, ortam]  (tüm kanallara aynı ayar, dinamik bağlı; kullanılmayan üst şeritler atlanır)
         → seviye ölçerleri
         → kanal katlama: hiçbir hoparlörün çalmadığı kanallar komşulara (FC→FL+FR, SL→BL, …)
         → bas yolu: highPassHz'li hoparlörlerden kesilen bas → bassReceiver hoparlörlere
         → hoparlör satırı (karışım × kazanç) → hoparlör EQ'su → yüksek geçiren → gecikme
         → cihaz başına limiter (-1 dBFS) → ring → drift → cihaz
```

## `processing` (SurroundConfig kökünde)

| Alan | Tip / aralık | Varsayılan | Anlam |
|---|---|---|---|
| `enabled` | bool | true | false → genel işleme atlanır (limiter hariç) |
| `preset` | string | "flat" | Yalnızca arayüz etiketi; motor yok sayar |
| `preampDb` | -24..+12 | 0 | Giriş kazancı |
| `eq` | 10 × dB, -12..+12 | sıfırlar | Bantlar: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz. Uçlar raf (shelf), ortadakiler tepe (peaking, Q≈1.4) |
| `bassBoostDb` | 0..12 | 0 | ~100 Hz alçak raf |
| `clarityDb` | 0..12 | 0 | Varlık/netlik: ~3,5 kHz tepe + ~10 kHz yüksek raf (yarısı) |
| `dynamicBoost` | 0..1 | 0 | Sıkıştırma miktarı + otomatik makyaj kazancı (gece/yüksek ses hissi) |
| `ambience` | 0..1 | 0 | Çiftlerde (FL/FR, BL/BR, SL/SR, ikisi de kullanılıyorsa TFL/TFR ve TBL/TBR) M/S genişletme |
| `limiter` | bool | true | Her çıkış cihazında tepe sınırlayıcı, -1 dBFS tavan |

## Hoparlör alanları (speakers[])

| Alan | Tip | Varsayılan | Anlam |
|---|---|---|---|
| `eq` | 10 × dB veya yok | düz | Hoparlöre özel 10 bant EQ (aynı bantlar) |
| `eqPreset` | string | yok | Yalnızca arayüz etiketi |
| `highPassHz` | 0 veya 40..250 | 0 | Küçük hoparlör: bu frekansın altı kesilir (LR4), kesilen bas `bassReceiver`'lara gider |
| `bassReceiver` | bool | false | Dahili sub (2.1 amfisi) ya da gerçek sub: kesilen bası ve (yerel çok kanallı kaynakta) LFE'yi alır |

Bas kuralları:
- Kesilen bas tüm alıcılara eşit bölünür (toplam seviye korunur). Alıcı yoksa bas kaybolur, motor uyarı loglar.
- LFE, satırında LFE olmayan alıcılara kaynak 2 kanaldan fazlaysa eklenir (upmix açık olsa da: içerik her an gerçek çok kanallıya dönebilir). Upmix'in türettiği LFE yalnızca satırında LFE olan bir hoparlör varsa üretilir; böylece alıcılar (ör. 2.1 ön hoparlörler) ön sinyalin basını iki kez almaz.
- Kanal katlama LFE'ye dokunmaz; LFE yalnızca bu kurala göre dağıtılır.

## Canlı güncelleme

`processing`, hoparlör `eq`/`eqPreset` ve `upmixOptions.centerDb`/`surroundDb`/`heightDb`/`lfeEnabled`/`surroundDelayMs`/`surroundHighCutHz`/`diffusion` değişiklikleri motoru yeniden başlatmaz (`EngineFingerprint` bunları dışlar); `SurroundEngine.UpdateLive(cfg)` ile kesintisiz uygulanır. `highPassHz`/`bassReceiver` ve `upmixOptions.mode` değişikliği yeniden başlatır.

## Köprü

- `openSoundPanel()` → Windows ses denetim masasını açar (`mmsys.cpl`), VB-Cable'ı 7.1 yapmak için.

## Motor ayrıntıları (uygulamada netleşenler)

- Aralık dışı değerler `ConfigValidator` hatası verir (Türkçe mesaj); DSP ayrıca savunmacı olarak kırpar. `eq` tam 10 eleman olmalı. Bir hoparlör aynı anda `highPassHz > 0` ve `bassReceiver` olamaz.
- Susturulmuş (`mute`) hoparlörler bas kaynağı/alıcısı sayılmaz.
- Kesilen bas, kesilen hoparlörün kendi `gainDb`'siyle bas yoluna girer; alıcının `gainDb`'si bas yoluna uygulanmaz (yalnızca kendi satırına ve katlanan LFE'ye).
- LFE katlama: kaynak 2 kanaldan fazlaysa (upmix durumundan bağımsız), satırında LFE olmayan her alıcıya `1 / (LFE'siz alıcı sayısı)` katsayıyla eklenir.
- `dynamicBoost` a: eşik `-6 - 24a` dB, oran `1 + 3a`, yumuşak diz 6 dB, atak 5 ms / bırakma 150 ms, makyaj = 0 dBFS'deki kısmanın yarısı. Tüm kanallar tek dedektör.
- `ambience` a: yan (S) kazancı `1 + a`.
- Limiter: 1 ms ileri bakış (kapalıyken de aynı gecikme korunur, çıkışlar hizalı kalır), 80 ms bırakma, cihaz kanallarına bağlı tek kazanç.
- Seviye ölçerleri upmix ve genel işlemeden sonraki, katlamadan önceki sinyali gösterir (ör. SL hoparlörü olmasa da SL içeriği görünür).
- Kanal katlama planı başlangıçta, susturulmamış hoparlörlerin karışım satırlarından (katsayı ≠ 0; bası kesilen hoparlörler de sayılır) çıkarılır; hoparlör değişikliği zaten yeniden başlatır. Ayrıntı: docs/upmix.md.
- Kaynak 8'den fazla kanal sunarsa (ör. 16 kanallı VB-Cable) ilk 8 kanal 7.1 sırasıyla alınır, gerisi yok sayılır.
