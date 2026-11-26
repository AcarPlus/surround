import {
  normalizeProcessing,
  normalizeUpmixOptions,
  type Processing,
  type Profile,
  type UpmixOptions,
} from '../api/types'
import { matchSoundPreset, samePeq } from './presets'

/** Profilin kapsadığı ayarlar: ses işleme, upmix anahtarı ve upmix ayrıntıları. */
export interface ProfileState {
  processing: Processing
  upmix: boolean
  upmixOptions: UpmixOptions
}

export const MAX_PROFILE_NAME = 24

/**
 * Yerleşik profil tanımlarının sürümü. Artınca kullanıcının config'te kayıtlı (ya da "Profili güncelle" ile değiştirdiği)
 * eski Film/Oyun/Müzik kopyaları yeni tanımlarla değişir.
 * 2 (0.5.9): Flat'in temiz zinciri taban, üstüne küçük dokunuşlar. Eski tanımlar (gülümseme EQ'su + bas + netlik +
 * dinamik makeup + %30 genişlik) yüksek masterlarda tepeleri +1,4…+4,9 dBFS'e çıkarıp limiter'ı sürekli çalıştırıyordu.
 * 3 (0.7.0): Film ve Oyun, Düz/Müzik'ten zayıf ve ince geliyordu (motor ortayı ön hoparlörlerden çekiyordu; ölçümler
 * tests/Surround.Engine.Tests/ModeLoudnessTests.cs). Motor artık önleri olduğu gibi bırakıyor; profiller üstüne bas ve
 * tiz rafı ekler. Otomatik ön kazanç rafların tamamını ortadan keserdi (orta frekanslar Düz'ün altında kalırdı): sabit
 * −1 dB ön kazanç + hafif dinamik; ender tepeleri cihaz limiter'ı tutar.
 * 4 (0.7.1): Geri bildirim: modlar sesi kısıyor ve "kesik" geliyor, Müzik Flat'in aynısı. Sıkıştırıcı (−9,6 dB eşik, 5/150 ms)
 * yüksek masterlarda sürekli çalışıp pompalıyordu ve −1 dB ön kazanç ortaları Düz'ün altına itiyordu: Film/Oyun artık
 * 0 dB ön kazanç, sıkıştırıcı yok, daha ılımlı raflar. Müzik kendi karakterini aldı: "V" (100 Hz bas rafı +3, 350 Hz
 * −1,5, 8 kHz hava rafı +2,5) ve daha geniş stereo (ambience 0,25), yine doğrudan dağıtım. Ölçümler
 * tests/Surround.Engine.Tests/ModeLoudnessTests.cs (REV 4).
 * 5 (0.7.2): Geri bildirim: modlar hâlâ birbirinin aynısı. Her mod belirgin karakter aldı: Film bas +4 / diyalog +3,
 * Oyun 2–5 kHz +4 / gümbürtü −2 / geniş, Müzik bas +4 / hava +3 / geniş. Her çift en az 2,5 dB ayrışır (ölçüm testi).
 */
export const BUILTIN_PROFILES_REV = 5

type Band = { type: 'lowShelf' | 'peak' | 'highShelf'; freqHz: number; gainDb: number; q: number }

/**
 * Yerleşik mod zinciri: 0 dB ön kazanç, sıkıştırıcı yok, birkaç parametrik bant ve stereo genişlik (C# testindeki
 * `ModeChain.Film/Game/Music` ile aynı). Artışların tepelerini cihaz limiter'ı (−0,1 dBFS, programa bağlı bırakma) tutar.
 */
const chain = (id: string, ambience: number, bands: (Band & { key: string })[]): Processing => {
  const p = normalizeProcessing({
    enabled: true,
    autoPreamp: false,
    preampDb: 0,
    limiter: true,
    dynamicBoost: 0,
    ambience,
    peq: bands.map(({ key, ...b }) => ({ id: `${id}-${key}`, ...b })),
  })
  p.preset = matchSoundPreset(p)
  return p
}

/** Film: bas +4 dB, diyalog (2 kHz) +3 dB, biraz geniş. */
const filmProcessing = (): Processing =>
  chain('film', 0.15, [
    { key: 'bass', type: 'lowShelf', freqHz: 90, gainDb: 4, q: 0.7 },
    { key: 'dialog', type: 'peak', freqHz: 2000, gainDb: 3, q: 1 },
  ])

/** Oyun: ayak sesi/konum (2–5 kHz) +4 dB, gümbürtü −2 dB, geniş sahne. */
const gameProcessing = (): Processing =>
  chain('game', 0.4, [
    { key: 'rumble', type: 'lowShelf', freqHz: 80, gainDb: -2, q: 0.7 },
    { key: 'cues', type: 'peak', freqHz: 3200, gainDb: 4, q: 0.7 },
  ])

/** Müzik: "V" eğrisi (bas +4, hava +3, alt orta −1,5) ve geniş sahne. */
const musicProcessing = (): Processing =>
  chain('music', 0.35, [
    { key: 'bass', type: 'lowShelf', freqHz: 90, gainDb: 4, q: 0.7 },
    { key: 'lowmid', type: 'peak', freqHz: 350, gainDb: -1.5, q: 1 },
    { key: 'air', type: 'highShelf', freqHz: 6000, gainDb: 3, q: 0.7 },
  ])

/** Yerleşik profil tanımları (sıra, arayüzdeki sıradır). Her çağrıda yeni kopya döner. */
export function builtinProfiles(): Profile[] {
  return [
    {
      // Dolgun ve sinematik: önler olduğu gibi, diyalog ortaya ayrıca (+1 dB) ve 2 kHz'te +3 dB; bas +4 dB; arka
      // dağınıklık azaltılmış (daha az "fazlı").
      id: 'builtin-film',
      name: 'Film',
      builtin: true,
      rev: BUILTIN_PROFILES_REV,
      processing: filmProcessing(),
      upmix: true,
      upmixOptions: normalizeUpmixOptions({ mode: 'film', centerDb: 1, diffusion: 0.6 }),
    },
    {
      // Gecikmesiz (oyun modu matris çözücü): ayak sesi/konum için 2–5 kHz +4 dB, gümbürtü −2 dB, geniş sahne.
      id: 'builtin-game',
      name: 'Oyun',
      builtin: true,
      rev: BUILTIN_PROFILES_REV,
      processing: gameProcessing(),
      upmix: true,
      upmixOptions: normalizeUpmixOptions({ mode: 'game', diffusion: 0.6 }),
    },
    {
      // Müzik stereo karışımı için yapılır: Flat'in doğrudan dağıtımı (çözümleme yok) + "V" eğrisi ve daha geniş sahne.
      id: 'builtin-music',
      name: 'Müzik',
      builtin: true,
      rev: BUILTIN_PROFILES_REV,
      processing: musicProcessing(),
      upmix: true,
      upmixOptions: normalizeUpmixOptions({ mode: 'direct' }),
    },
    {
      // Hiçbir şey değiştirmez: ses işleme (EQ, bas, netlik, dinamik) baştan sona atlanır; upmix "doğrudan" modda:
      // çözümleme yok, stereo içerik her hoparlöre olduğu gibi kopyalanır (orta = (L+R)/2) ki hiçbir hoparlör susmasın;
      // gerçek çok kanallı içerik dokunulmadan geçer. 32-bit kayan nokta. Hoparlör başı düzeltmeler (gecikme, seviye,
      // tını eşleme, bas yönetimi) kalır: onlar sesi değil hoparlörleri eşitler.
      id: 'builtin-flat',
      name: 'Flat',
      builtin: true,
      rev: BUILTIN_PROFILES_REV,
      // Güvenlik limiter'ı açık: yalnız −1 dBFS'i aşan tepelerde çalışır (ör. oda EQ'su artışları), yoksa ses kırpılır.
      processing: { ...normalizeProcessing({ enabled: false, limiter: true }), preset: 'flat' },
      upmix: true,
      upmixOptions: normalizeUpmixOptions({ mode: 'direct' }),
    },
  ]
}

export const builtinProfile = (id: string): Profile | undefined => builtinProfiles().find((p) => p.id === id)

const clone = (s: ProfileState): ProfileState => ({
  processing: { ...s.processing, eq: [...s.processing.eq], peq: s.processing.peq.map((b) => ({ ...b })) },
  upmix: s.upmix,
  upmixOptions: { ...s.upmixOptions },
})

/** Geçerli ayarlardan profil içeriği (derin kopya). */
export function snapshotState(s: ProfileState): ProfileState {
  return clone(s)
}

/** Profili uygularken yazılacak alanlar (tek commit için). */
export function profilePatch(p: Profile): ProfileState {
  return clone({
    processing: normalizeProcessing(p.processing),
    upmix: p.upmix,
    upmixOptions: normalizeUpmixOptions(p.upmixOptions),
  })
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

/**
 * Geçerli ayarlar profilden farklı mı? Ses işleme etiketi (`preset`) karşılaştırılmaz;
 * yalnızca sesi değiştiren değerler, açma/kapama anahtarları ve upmix alanları sayılır.
 */
export function isProfileModified(profile: Profile, cur: ProfileState): boolean {
  const a = normalizeProcessing(profile.processing)
  const b = cur.processing
  if (a.enabled !== b.enabled || a.limiter !== b.limiter) return true
  if ((!a.autoPreamp && !near(a.preampDb, b.preampDb)) || !near(a.bassBoostDb, b.bassBoostDb) || !near(a.clarityDb, b.clarityDb)) return true
  if (!near(a.dynamicBoost, b.dynamicBoost) || !near(a.ambience, b.ambience)) return true
  if (a.eq.some((v, i) => !near(v, b.eq[i] ?? 0))) return true
  if (a.autoPreamp !== b.autoPreamp || !samePeq(a.peq, b.peq)) return true
  if (profile.upmix !== cur.upmix) return true
  const u = normalizeUpmixOptions(profile.upmixOptions)
  const v = cur.upmixOptions
  return (
    u.mode !== v.mode ||
    u.lfeEnabled !== v.lfeEnabled ||
    !near(u.centerDb, v.centerDb) ||
    !near(u.surroundDb, v.surroundDb) ||
    !near(u.heightDb, v.heightDb) ||
    !near(u.surroundDelayMs, v.surroundDelayMs) ||
    !near(u.surroundHighCutHz, v.surroundHighCutHz) ||
    !near(u.diffusion, v.diffusion)
  )
}

/** Ad kırpılır ve kısaltılır; boşsa null. */
export function cleanProfileName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, ' ').slice(0, MAX_PROFILE_NAME).trim()
  return n || null
}

/**
 * Config'ten okunan profil listesini doğrular: bozuk kayıtlar atılır, eksik alanlar tamamlanır,
 * yerleşik profiller (eksikse varsayılanıyla) her zaman başta yer alır.
 */
export function normalizeProfiles(raw: unknown): Profile[] {
  const seen = new Set<string>()
  const stored: Profile[] = []
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue
      const o = r as Partial<Profile>
      const name = typeof o.name === 'string' ? cleanProfileName(o.name) : null
      if (typeof o.id !== 'string' || !o.id || !name || seen.has(o.id)) continue
      seen.add(o.id)
      stored.push({
        id: o.id,
        name: builtinProfile(o.id)?.name ?? name,
        builtin: !!builtinProfile(o.id),
        processing: normalizeProcessing(o.processing),
        upmix: typeof o.upmix === 'boolean' ? o.upmix : true,
        upmixOptions: normalizeUpmixOptions(o.upmixOptions),
        ...(typeof o.rev === 'number' ? { rev: o.rev } : {}),
      })
    }
  }
  // Flat sabittir (tanımı "hiçbir şeyi değiştirme"); diğerlerinin kayıtlı kopyası yalnız güncel sürümdeyse geçerli.
  const builtins = builtinProfiles().map((b) => {
    if (b.id === 'builtin-flat') return b
    const s = stored.find((v) => v.id === b.id)
    return s && (s.rev ?? 1) >= BUILTIN_PROFILES_REV ? s : b
  })
  return [...builtins, ...stored.filter((s) => !s.builtin)]
}

export const newProfileId = (): string => `profile-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
