import {
  normalizeProcessing,
  normalizeUpmixOptions,
  type Processing,
  type Profile,
  type UpmixOptions,
} from '../api/types'
import { matchSoundPreset, samePeq, soundPresetPatch } from './presets'

/** Profilin kapsadığı ayarlar: ses işleme, upmix anahtarı ve upmix ayrıntıları. */
export interface ProfileState {
  processing: Processing
  upmix: boolean
  upmixOptions: UpmixOptions
}

export const MAX_PROFILE_NAME = 24

const soundProcessing = (presetId: string, extra: Partial<Processing> = {}): Processing => {
  const p = normalizeProcessing({ ...soundPresetPatch(presetId), ...extra })
  p.preset = matchSoundPreset(p)
  return p
}

/** Yerleşik profil tanımları (sıra, arayüzdeki sıradır). Her çağrıda yeni kopya döner. */
export function builtinProfiles(): Profile[] {
  return [
    {
      id: 'builtin-film',
      name: 'Film',
      builtin: true,
      processing: soundProcessing('film'),
      upmix: true,
      upmixOptions: normalizeUpmixOptions({ mode: 'film', centerDb: 2 }),
    },
    {
      id: 'builtin-game',
      name: 'Oyun',
      builtin: true,
      processing: soundProcessing('game'),
      upmix: true,
      upmixOptions: normalizeUpmixOptions({ mode: 'game' }),
    },
    {
      id: 'builtin-music',
      name: 'Müzik',
      builtin: true,
      processing: soundProcessing('music'),
      upmix: true,
      upmixOptions: normalizeUpmixOptions({ mode: 'film', surroundDb: -4, heightDb: -6 }),
    },
    {
      // Hiçbir şey değiştirmez: ses işleme (EQ, bas, netlik, dinamik) baştan sona atlanır; upmix "doğrudan" modda:
      // çözümleme yok, stereo içerik her hoparlöre olduğu gibi kopyalanır (orta = (L+R)/2) ki hiçbir hoparlör susmasın;
      // gerçek çok kanallı içerik dokunulmadan geçer. 32-bit kayan nokta. Hoparlör başı düzeltmeler (gecikme, seviye,
      // tını eşleme, bas yönetimi) kalır: onlar sesi değil hoparlörleri eşitler.
      id: 'builtin-flat',
      name: 'Flat',
      builtin: true,
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
      })
    }
  }
  // Flat sabittir (tanımı "hiçbir şeyi değiştirme"); kayıtlı eski bir kopyası yeni tanımı gölgelemesin.
  const builtins = builtinProfiles().map((b) => (b.id === 'builtin-flat' ? b : (stored.find((s) => s.id === b.id) ?? b)))
  return [...builtins, ...stored.filter((s) => !s.builtin)]
}

export const newProfileId = (): string => `profile-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
