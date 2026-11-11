import { describe, expect, it } from 'vitest'
import { defaultUpmixOptions, normalizeUpmixOptions } from '../api/types'
import { upmixStateLabel } from './upmix'

describe('upmixOptions', () => {
  it('eksik alanları varsayılanla doldurur', () => {
    expect(normalizeUpmixOptions(undefined)).toEqual(defaultUpmixOptions())
    expect(normalizeUpmixOptions({ mode: 'game' })).toEqual({ ...defaultUpmixOptions(), mode: 'game' })
    expect(defaultUpmixOptions().mode).toBe('film')
    expect(defaultUpmixOptions().heightDb).toBe(-3)
  })

  it('geçersiz değerleri düzeltir ve aralığa kırpar', () => {
    const n = normalizeUpmixOptions({ mode: 'concert' as never, centerDb: 20, surroundDb: -40, lfeEnabled: 'x' as never, heightDb: 30 })
    expect(n).toEqual({ ...defaultUpmixOptions(), mode: 'film', centerDb: 6, surroundDb: -12, lfeEnabled: true, heightDb: 6 })
  })

  it('JSON gidiş-dönüşünde korunur', () => {
    const o = {
      mode: 'game' as const,
      centerDb: -3.5,
      surroundDb: 2,
      lfeEnabled: false,
      heightDb: -9,
      surroundDelayMs: 4,
      surroundHighCutHz: 6500,
      diffusion: 0.3,
    }
    expect(normalizeUpmixOptions(JSON.parse(JSON.stringify(o)))).toEqual(o)
  })
})

describe('arka kanal ayarları', () => {
  it('varsayılanlar motorla aynı: 10 ms, tiz kesme kapalı, ayrıştırma 1', () => {
    const d = defaultUpmixOptions()
    expect([d.surroundDelayMs, d.surroundHighCutHz, d.diffusion]).toEqual([10, 0, 1])
    // Alanları olmayan eski config aynı değerleri alır.
    const old = normalizeUpmixOptions({ mode: 'film', centerDb: 2, surroundDb: 0, lfeEnabled: true, heightDb: -3 })
    expect([old.surroundDelayMs, old.surroundHighCutHz, old.diffusion]).toEqual([10, 0, 1])
  })

  it('aralıklara kırpar; 3000 altı kesme değeri 3000 olur, 0 / bozuk kapalı kalır', () => {
    expect(normalizeUpmixOptions({ surroundDelayMs: 99 }).surroundDelayMs).toBe(25)
    expect(normalizeUpmixOptions({ surroundDelayMs: -4 }).surroundDelayMs).toBe(0)
    expect(normalizeUpmixOptions({ surroundDelayMs: Number.NaN }).surroundDelayMs).toBe(10)
    expect(normalizeUpmixOptions({ surroundHighCutHz: 1200 }).surroundHighCutHz).toBe(3000)
    expect(normalizeUpmixOptions({ surroundHighCutHz: 99999 }).surroundHighCutHz).toBe(16000)
    expect(normalizeUpmixOptions({ surroundHighCutHz: 0 }).surroundHighCutHz).toBe(0)
    expect(normalizeUpmixOptions({ surroundHighCutHz: -5 }).surroundHighCutHz).toBe(0)
    expect(normalizeUpmixOptions({ diffusion: 2 }).diffusion).toBe(1)
    expect(normalizeUpmixOptions({ diffusion: -1 }).diffusion).toBe(0)
  })
})

describe('upmixStateLabel', () => {
  it('durumu Türkçe gösterir', () => {
    expect(upmixStateLabel({ upmix: 'stereo', sourceChannels: 8 })).toBe('Upmix etkin (stereo içerik)')
    expect(upmixStateLabel({ upmix: 'native', sourceChannels: 8 })).toBe('Yerel 7.1')
    expect(upmixStateLabel({ upmix: 'native', sourceChannels: 16 })).toBe('Yerel 7.1')
    expect(upmixStateLabel({ upmix: 'native', sourceChannels: 6 })).toBe('Yerel 5.1')
    expect(upmixStateLabel({ upmix: 'off', sourceChannels: 2 })).toBe('Upmix kapalı')
  })
})
