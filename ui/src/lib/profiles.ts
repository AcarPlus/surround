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
 */
export const BUILTIN_PROFILES_REV = 2

const gentle = (v: Partial<Processing>): Processing => {
  const p = normalizeProcessing({ enabled: true, autoPreamp: true, limiter: true, ...v })
  p.preset = matchSoundPreset(p)
  return p
}

/** Yerleşik profil tanımları (sıra, arayüzdeki sıradır). Her çağrıda yeni kopya döner. */
export function builtinProfiles(): Profile[] {
  return [
    {
      // Diyalog önde: film modu orta kanalı ayıklar (+1 dB), hafif bas ve netlik, sessiz konuşmayı biraz toparlayan
      // hafif dinamik; ortam genişletme yok, arka dağınıklık azaltılmış (daha az "fazlı").
      id: 'builtin-film',
      name: 'Film',
      builtin: true,
      rev: BUILTIN_PROFILES_REV,
      processing: gentle({ bassBoostDb: 2, clarityDb: 1.5, dynamicBoost: 0.15 }),
      upmix: true,
      upmixOptions: normalizeUpmixOptions({ mode: 'film', centerDb: 1, diffusion: 0.6 }),
    },
    {
      // Düşük gecikme (oyun modu matris çözücü) ve ayrıntı: ayak sesi/konum için netlik, ölçülü bas.
      id: 'builtin-game',
      name: 'Oyun',
      builtin: true,
      rev: BUILTIN_PROFILES_REV,
      processing: gentle({ bassBoostDb: 1, clarityDb: 2, dynamicBoost: 0.2 }),
      upmix: true,
      upmixOptions: normalizeUpmixOptions({ mode: 'game', diffusion: 0.6 }),
    },
    {
      // Müzik stereo karışımı için yapılır: Flat'in doğrudan dağıtımı (çözümleme yok) + biraz sıcaklık ve parlaklık.
      id: 'builtin-music',
      name: 'Müzik',
      builtin: true,
      rev: BUILTIN_PROFILES_REV,
      processing: gentle({ bassBoostDb: 1.5, clarityDb: 1 }),
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
