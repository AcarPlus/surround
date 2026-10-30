import { flatEq, type Processing, type Speaker } from '../api/types'

/** Genel ses ön ayarları: yalnızca veri. Bant sırası: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz. */
export type SoundValues = Pick<
  Processing,
  'eq' | 'bassBoostDb' | 'clarityDb' | 'dynamicBoost' | 'ambience' | 'preampDb'
>

export interface SoundPreset {
  id: string
  label: string
  hint: string
  values: SoundValues
}

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: 'flat',
    label: 'Düz',
    hint: 'Hiçbir değişiklik yapmaz.',
    values: { eq: flatEq(), bassBoostDb: 0, clarityDb: 0, dynamicBoost: 0, ambience: 0, preampDb: 0 },
  },
  {
    id: 'general',
    label: 'Genel',
    hint: 'Her şey için hafif bas ve netlik.',
    values: { eq: [2, 2, 1, 0, -1, 0, 1, 2, 2, 2], bassBoostDb: 2, clarityDb: 2, dynamicBoost: 0.1, ambience: 0.15, preampDb: -3 },
  },
  {
    id: 'film',
    label: 'Film',
    hint: 'Güçlü bas, geniş sahne, dengeli diyalog.',
    values: { eq: [4, 4, 2, 0, -1, 0, 1, 2, 2, 1], bassBoostDb: 4, clarityDb: 2, dynamicBoost: 0.35, ambience: 0.35, preampDb: -5 },
  },
  {
    id: 'game',
    label: 'Oyun',
    hint: 'Ayak sesi ve yön için parlak üst orta.',
    values: { eq: [2, 2, 0, -1, -1, 1, 3, 4, 3, 2], bassBoostDb: 2, clarityDb: 4, dynamicBoost: 0.2, ambience: 0.3, preampDb: -4 },
  },
  {
    id: 'music',
    label: 'Müzik',
    hint: 'Hafif “V” eğrisi: dolgun bas, açık tizler.',
    values: { eq: [3, 3, 2, 0, -1, -1, 0, 2, 3, 3], bassBoostDb: 3, clarityDb: 2, dynamicBoost: 0, ambience: 0.1, preampDb: -3 },
  },
  {
    id: 'speech',
    label: 'Konuşma',
    hint: 'Diyalog ve sesli içerik öne çıkar, uğultu azalır.',
    values: { eq: [-6, -4, -2, 0, 1, 3, 4, 2, 0, -2], bassBoostDb: 0, clarityDb: 4, dynamicBoost: 0.3, ambience: 0, preampDb: -2 },
  },
  {
    id: 'bass',
    label: 'Bas güçlendirme',
    hint: 'Belirgin alt frekans artışı.',
    values: { eq: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0], bassBoostDb: 8, clarityDb: 0, dynamicBoost: 0, ambience: 0, preampDb: -9 },
  },
  {
    id: 'night',
    label: 'Gece',
    hint: 'Düşük sesle dinlerken: ses seviyesi dengelenir, detay kaybolmaz.',
    values: { eq: [2, 2, 1, 0, 0, 1, 2, 2, 1, 0], bassBoostDb: 3, clarityDb: 3, dynamicBoost: 0.8, ambience: 0.2, preampDb: -4 },
  },
]

export const CUSTOM_ID = 'custom'
export const CUSTOM_LABEL = 'Özel'

export const soundPresetLabel = (id: string): string =>
  SOUND_PRESETS.find((p) => p.id === id)?.label ?? CUSTOM_LABEL

/** Ön ayar değerlerinin kopyası (paylaşılan diziyi değiştirmemek için). */
export function soundPresetPatch(id: string): Partial<Processing> | null {
  const p = SOUND_PRESETS.find((v) => v.id === id)
  return p ? { ...p.values, eq: [...p.values.eq], preset: p.id } : null
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

/** Hoparlörün etiket değeri: kayıtlı ön ayar yoksa EQ düzse 'flat', değilse 'custom'. */
export function speakerPresetValue(sp: Speaker): string {
  if (sp.eqPreset && SPEAKER_PRESETS.some((p) => p.id === sp.eqPreset)) return sp.eqPreset
  return sp.eq && sp.eq.some((v) => v !== 0) ? CUSTOM_ID : 'flat'
}

/** Değerler bir ön ayarla birebir aynıysa onun kimliği, değilse 'custom'. */
export function matchSoundPreset(p: Processing): string {
  const hit = SOUND_PRESETS.find(
    (s) =>
      s.values.bassBoostDb === p.bassBoostDb &&
      s.values.clarityDb === p.clarityDb &&
      s.values.dynamicBoost === p.dynamicBoost &&
      s.values.ambience === p.ambience &&
      s.values.preampDb === p.preampDb &&
      s.values.eq.every((v, i) => v === p.eq[i]),
  )
  return hit?.id ?? CUSTOM_ID
}
