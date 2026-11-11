import {
  flatEq,
  newPeqId,
  normalizePeq,
  type PeqBand,
  type Processing,
  type Speaker,
  type UserSoundPreset,
  type UserSpeakerPreset,
} from '../api/types'

/** Genel ses ön ayarları: yalnızca veri. Bant sırası: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz. */
export type SoundValues = Pick<
  Processing,
  'eq' | 'bassBoostDb' | 'clarityDb' | 'dynamicBoost' | 'ambience' | 'preampDb' | 'autoPreamp' | 'peq'
>

export interface SoundPreset {
  id: string
  label: string
  hint: string
  values: SoundValues
}

/*
 * Ayar ilkeleri: kesmek, artırmaktan iyidir (kafa payı ve bozulma); alçak bant artışları bas güçlendirmeyle üst üste
 * bindirilmez (en yüksek alçak EQ artışı + bassBoostDb ≤ 6 dB); ön kazanç motorca otomatik düşürülür (autoPreamp),
 * bu yüzden preampDb 0'da bırakılır (otomatik kapatılırsa kullanıcı kendi ayarlar).
 */
const mk = (v: Omit<SoundValues, 'preampDb' | 'autoPreamp' | 'peq'> & Partial<Pick<SoundValues, 'peq'>>): SoundValues => ({
  preampDb: 0,
  autoPreamp: true,
  peq: [],
  ...v,
})

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: 'flat',
    label: 'Düz',
    hint: 'Hiçbir değişiklik yapmaz.',
    values: mk({ eq: flatEq(), bassBoostDb: 0, clarityDb: 0, dynamicBoost: 0, ambience: 0 }),
  },
  {
    id: 'general',
    label: 'Genel',
    hint: 'Her şey için hafif bas ve netlik; çamurlu alt orta kısılır.',
    values: mk({ eq: [0, 0, 0, -1.5, -1.5, 0, 0, 1, 1.5, 1], bassBoostDb: 1, clarityDb: 1, dynamicBoost: 0.1, ambience: 0.15 }),
  },
  {
    id: 'film',
    label: 'Film',
    hint: 'Güçlü bas, geniş sahne, dengeli diyalog.',
    values: mk({ eq: [2, 2, 1, -1, -1.5, 0, 0.5, 1, 1, 0], bassBoostDb: 2, clarityDb: 1.5, dynamicBoost: 0.3, ambience: 0.3 }),
  },
  {
    id: 'game',
    label: 'Oyun',
    hint: 'Ayak sesi ve yön için parlak üst orta.',
    values: mk({ eq: [1, 0, -1, -2, -1.5, 0, 1, 2, 2, 1], bassBoostDb: 0, clarityDb: 2, dynamicBoost: 0.5, ambience: 0.3 }),
  },
  {
    id: 'game-competitive',
    label: 'Rekabetçi oyun',
    hint: 'Ayak sesi (2–5 kHz) öne çıkar, patlama/gümbürtü (60–200 Hz) kısılır.',
    values: mk({ eq: [-3, -4, -4, -2, -1, 0, 2, 3, 1, 0], bassBoostDb: 0, clarityDb: 2, dynamicBoost: 0.4, ambience: 0.2 }),
  },
  {
    id: 'music',
    label: 'Müzik',
    hint: 'Hafif “V” eğrisi: dolgun bas, açık tizler.',
    values: mk({ eq: [2, 2, 1, -1, -1.5, -1, 0, 1, 2, 2], bassBoostDb: 1, clarityDb: 0, dynamicBoost: 0, ambience: 0.1 }),
  },
  {
    id: 'speech',
    label: 'Konuşma',
    hint: 'Diyalog ve sesli içerik öne çıkar, uğultu azalır.',
    values: mk({ eq: [-8, -6, -3, -1, 0, 1, 2, 1, -1, -3], bassBoostDb: 0, clarityDb: 3, dynamicBoost: 0.3, ambience: 0 }),
  },
  {
    id: 'bass',
    label: 'Bas güçlendirme',
    hint: 'Belirgin alt frekans artışı.',
    values: mk({ eq: [3, 3, 2, 0, 0, 0, 0, 0, 0, 0], bassBoostDb: 3, clarityDb: 0, dynamicBoost: 0, ambience: 0 }),
  },
  {
    id: 'night',
    label: 'Gece',
    hint: 'Düşük sesle dinlerken: ses seviyesi dengelenir, detay kaybolmaz.',
    values: mk({ eq: [1, 1, 1, 0, -1, 0, 1, 1, 1, 0], bassBoostDb: 1, clarityDb: 2, dynamicBoost: 0.8, ambience: 0.2 }),
  },
  {
    id: 'loudness',
    label: 'Kısık ses (loudness)',
    hint: 'Kısık sesle dinlerken kulağın kaybettiği bas ve tizi hafifçe geri verir (iki raf).',
    values: mk({
      eq: flatEq(),
      bassBoostDb: 0,
      clarityDb: 0,
      dynamicBoost: 0,
      ambience: 0,
      peq: [
        { type: 'lowShelf', freqHz: 110, gainDb: 4, q: 0.7 },
        { type: 'highShelf', freqHz: 6000, gainDb: 3, q: 0.7 },
      ],
    }),
  },
]

export const CUSTOM_ID = 'custom'
export const CUSTOM_LABEL = 'Özel'

export const soundPresetLabel = (id: string): string =>
  SOUND_PRESETS.find((p) => p.id === id)?.label ?? CUSTOM_LABEL

/** Ön ayar parametrik bantlarının kimlikli kopyası. */
const clonePeq = (peq: readonly PeqBand[] | undefined): PeqBand[] => (peq ?? []).map((b) => ({ ...b, id: b.id ?? newPeqId() }))

/** Ön ayar değerlerinin kopyası (paylaşılan diziyi değiştirmemek için). */
export function soundPresetPatch(id: string): Partial<Processing> | null {
  const p = SOUND_PRESETS.find((v) => v.id === id)
  return p ? { ...p.values, eq: [...p.values.eq], peq: clonePeq(p.values.peq), preset: p.id } : null
}

/* ---------- Hoparlör ön ayarları ---------- */

export interface SpeakerPreset {
  id: string
  label: string
  /** Tanımlı olmayan alanlar hoparlörde olduğu gibi kalır. */
  eq: number[]
  highPassHz?: number
  bassReceiver?: boolean
}

export const SPEAKER_PRESETS: SpeakerPreset[] = [
  { id: 'flat', label: 'Düz', eq: flatEq() },
  {
    id: 'small-satellite',
    label: 'Küçük/ucuz uydu',
    eq: [0, 0, 0, -1, -2.5, 0, 1, 2, 1.5, 0],
    highPassHz: 150,
    bassReceiver: false,
  },
  {
    id: 'desktop-front',
    label: 'Masaüstü 2.1 önü',
    eq: [0, 0, 0, 0, -1, -1.5, -1, 0, 1, 1],
    highPassHz: 0,
    bassReceiver: true,
  },
  {
    id: 'subwoofer',
    label: 'Subwoofer',
    eq: [1, 1, 0, -3, -6, -9, -12, -12, -12, -12],
    highPassHz: 0,
    bassReceiver: true,
  },
  {
    id: 'center',
    label: 'Orta (diyalog)',
    eq: [-3, -2, -1, 0, 1, 2, 3, 2, 0, 0],
  },
]

export const speakerPresetLabel = (id: string | undefined): string =>
  SPEAKER_PRESETS.find((p) => p.id === id)?.label ?? CUSTOM_LABEL

/** Hoparlöre uygulanacak değişiklik. Düz EQ `undefined` olarak saklanır (config'te hiç yazılmaz). */
export function speakerPresetPatch(id: string): Partial<Speaker> | null {
  const p = SPEAKER_PRESETS.find((v) => v.id === id)
  if (!p) return null
  const patch: Partial<Speaker> = {
    eq: p.eq.every((v) => v === 0) ? undefined : [...p.eq],
    eqPreset: p.id,
  }
  if (p.highPassHz !== undefined) patch.highPassHz = p.highPassHz || undefined
  if (p.bassReceiver !== undefined) patch.bassReceiver = p.bassReceiver || undefined
  return patch
}

/** Kullanıcı ön ayarlarının `processing.preset` / `speaker.eqPreset` değeri. */
export const USER_PREFIX = 'user:'
export const userPresetKey = (id: string): string => `${USER_PREFIX}${id}`
export const isUserPresetKey = (k: string | undefined): k is string => !!k && k.startsWith(USER_PREFIX)
export const MAX_PRESET_NAME = 24
export const MAX_USER_PRESETS = 20

export const newUserPresetId = (): string => `up-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Ad kırpılır ve kısaltılır; boşsa null. */
export function cleanPresetName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, ' ').slice(0, MAX_PRESET_NAME).trim()
  return n || null
}

const peqKey = (b: PeqBand) => `${b.type}|${b.freqHz}|${b.gainDb}|${b.q}|${b.enabled === false ? 0 : 1}`

/** Parametrik listeler (kimlik hariç) aynı mı? */
export function samePeq(a: readonly PeqBand[] | undefined, b: readonly PeqBand[] | undefined): boolean {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((v, i) => peqKey(v) === peqKey(y[i]))
}

/** Hoparlörün etiket değeri: kayıtlı ön ayar yoksa EQ düzse 'flat', değilse 'custom'. */
export function speakerPresetValue(sp: Speaker, user: readonly UserSpeakerPreset[] = []): string {
  if (sp.eqPreset && SPEAKER_PRESETS.some((p) => p.id === sp.eqPreset)) return sp.eqPreset
  if (isUserPresetKey(sp.eqPreset) && user.some((u) => userPresetKey(u.id) === sp.eqPreset)) return sp.eqPreset
  return (sp.eq && sp.eq.some((v) => v !== 0)) || (sp.peq && sp.peq.length > 0) ? CUSTOM_ID : 'flat'
}

/** Yerleşik ya da kullanıcı ön ayarı olmayan ayar mı (`speakerPresetPatch` için ortak etiket sorgusu). */
export function speakerPresetName(id: string | undefined, user: readonly UserSpeakerPreset[] = []): string {
  if (isUserPresetKey(id)) return user.find((u) => userPresetKey(u.id) === id)?.name ?? CUSTOM_LABEL
  return speakerPresetLabel(id)
}

/**
 * Değerler bir ön ayarla birebir aynıysa onun kimliği (kullanıcı ön ayarları `user:<id>`), değilse 'custom'.
 * Yerleşikler önce aranır.
 */
export function matchSoundPreset(p: Processing, user: readonly UserSoundPreset[] = []): string {
  const same = (v: SoundValues) =>
    v.bassBoostDb === p.bassBoostDb &&
    v.clarityDb === p.clarityDb &&
    v.dynamicBoost === p.dynamicBoost &&
    v.ambience === p.ambience &&
    v.autoPreamp === !!p.autoPreamp &&
    // Otomatik ön kazançta preampDb etkisizdir.
    (v.autoPreamp || v.preampDb === p.preampDb) &&
    v.eq.every((x, i) => x === p.eq[i]) &&
    samePeq(v.peq, p.peq)
  const hit = SOUND_PRESETS.find((s) => same(s.values))
  if (hit) return hit.id
  const u = user.find((v) => same(userSoundValues(v)))
  return u ? userPresetKey(u.id) : CUSTOM_ID
}

/* ---------- Kullanıcı ön ayarları ---------- */

export const userSoundValues = (u: UserSoundPreset): SoundValues => ({
  eq: u.eq,
  peq: u.peq ?? [],
  bassBoostDb: u.bassBoostDb,
  clarityDb: u.clarityDb,
  dynamicBoost: u.dynamicBoost,
  ambience: u.ambience,
  preampDb: u.preampDb,
  autoPreamp: u.autoPreamp,
})

/** Geçerli genel ses ayarlarından kullanıcı ön ayarı (derin kopya). */
export function makeUserSoundPreset(p: Processing, name: string, id = newUserPresetId()): UserSoundPreset {
  return {
    id,
    name,
    eq: [...p.eq],
    ...(p.peq.length ? { peq: p.peq.map((b) => ({ ...b })) } : {}),
    bassBoostDb: p.bassBoostDb,
    clarityDb: p.clarityDb,
    dynamicBoost: p.dynamicBoost,
    ambience: p.ambience,
    preampDb: p.preampDb,
    autoPreamp: p.autoPreamp,
  }
}

/** Kullanıcı ön ayarını uygularken yazılacak alanlar. */
export function userSoundPatch(u: UserSoundPreset): Partial<Processing> {
  return { ...userSoundValues(u), eq: [...u.eq], peq: clonePeq(u.peq), preset: userPresetKey(u.id) }
}

export function makeUserSpeakerPreset(sp: Speaker, name: string, id = newUserPresetId()): UserSpeakerPreset {
  return {
    id,
    name,
    eq: sp.eq ? [...sp.eq] : flatEq(),
    ...(sp.peq?.length ? { peq: sp.peq.map((b) => ({ ...b })) } : {}),
  }
}

/** Hoparlöre uygulanacak değişiklik (yalnızca EQ ve parametrik bantlar; bas ayarlarına dokunmaz). */
export function userSpeakerPatch(u: UserSpeakerPreset): Partial<Speaker> {
  return {
    eq: u.eq.every((v) => v === 0) ? undefined : [...u.eq],
    peq: u.peq?.length ? clonePeq(u.peq) : undefined,
    eqPreset: userPresetKey(u.id),
  }
}

const cleanEq = (raw: unknown): number[] =>
  flatEq().map((_, i) => {
    const v = Array.isArray(raw) ? raw[i] : 0
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(12, Math.max(-12, v)) : 0
  })

const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d

/** Config'ten okunan kullanıcı ses ön ayarlarını doğrular (bozuk kayıtlar atılır, eksik alanlar tamamlanır). */
export function normalizeUserSoundPresets(raw: unknown): UserSoundPreset[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: UserSoundPreset[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object' || out.length >= MAX_USER_PRESETS) continue
    const o = r as Partial<UserSoundPreset>
    const name = typeof o.name === 'string' ? cleanPresetName(o.name) : null
    if (typeof o.id !== 'string' || !o.id || !name || seen.has(o.id)) continue
    seen.add(o.id)
    const peq = normalizePeq(o.peq)
    out.push({
      id: o.id,
      name,
      eq: cleanEq(o.eq),
      ...(peq ? { peq } : {}),
      bassBoostDb: num(o.bassBoostDb, 0, 0, 12),
      clarityDb: num(o.clarityDb, 0, 0, 12),
      dynamicBoost: num(o.dynamicBoost, 0, 0, 1),
      ambience: num(o.ambience, 0, 0, 1),
      preampDb: num(o.preampDb, 0, -24, 12),
      autoPreamp: o.autoPreamp === true,
    })
  }
  return out
}

export function normalizeUserSpeakerPresets(raw: unknown): UserSpeakerPreset[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: UserSpeakerPreset[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object' || out.length >= MAX_USER_PRESETS) continue
    const o = r as Partial<UserSpeakerPreset>
    const name = typeof o.name === 'string' ? cleanPresetName(o.name) : null
    if (typeof o.id !== 'string' || !o.id || !name || seen.has(o.id)) continue
    seen.add(o.id)
    const peq = normalizePeq(o.peq)
    out.push({ id: o.id, name, eq: cleanEq(o.eq), ...(peq ? { peq } : {}) })
  }
  return out
}

