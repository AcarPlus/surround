import { describe, expect, it } from 'vitest'
import { EQ_BANDS, defaultProcessing, normalizeProcessing } from '../api/types'
import {
  SOUND_PRESETS,
  SPEAKER_PRESETS,
  matchSoundPreset,
  soundPresetPatch,
  speakerPresetPatch,
} from './presets'

describe('presets', () => {
  it('tüm ön ayarlar aralık içinde ve 10 bant', () => {
    for (const p of SOUND_PRESETS) {
      expect(p.values.eq).toHaveLength(EQ_BANDS)
      expect(p.values.eq.every((v) => v >= -12 && v <= 12)).toBe(true)
      expect(p.values.bassBoostDb).toBeGreaterThanOrEqual(0)
      expect(p.values.bassBoostDb).toBeLessThanOrEqual(12)
      expect(p.values.clarityDb).toBeLessThanOrEqual(12)
      expect(p.values.dynamicBoost).toBeLessThanOrEqual(1)
      expect(p.values.ambience).toBeLessThanOrEqual(1)
      expect(p.values.preampDb).toBeGreaterThanOrEqual(-24)
      expect(p.values.preampDb).toBeLessThanOrEqual(12)
    }
    for (const p of SPEAKER_PRESETS) {
      expect(p.eq).toHaveLength(EQ_BANDS)
      expect(p.eq.every((v) => v >= -12 && v <= 12)).toBe(true)
    }
  })

  it('ön ayar uygulanınca etiket eşleşir, değer değişince Özel olur', () => {
    for (const p of SOUND_PRESETS) {
      const cur = { ...defaultProcessing(), ...soundPresetPatch(p.id) }
      expect(matchSoundPreset(cur)).toBe(p.id)
      expect(matchSoundPreset({ ...cur, ambience: cur.ambience + 0.05 })).toBe('custom')
    }
  })

  it('eksik processing varsayılanla tamamlanır', () => {
    const n = normalizeProcessing({ preampDb: -3, eq: [1, 2] })
    expect(n.enabled).toBe(true)
    expect(n.limiter).toBe(true)
    expect(n.preset).toBe('flat')
    expect(n.eq).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(normalizeProcessing(undefined)).toEqual(defaultProcessing())
  })

  it('hoparlör ön ayarı: uydu bas keser, düz yalnızca EQ sıfırlar', () => {
    const sat = speakerPresetPatch('small-satellite')!
    expect(sat.highPassHz).toBe(150)
    expect(sat.eqPreset).toBe('small-satellite')
    const flat = speakerPresetPatch('flat')!
    expect(flat.eq).toBeUndefined()
    expect('highPassHz' in flat).toBe(false)
    expect(speakerPresetPatch('subwoofer')!.bassReceiver).toBe(true)
  })
})
