import { describe, expect, it } from 'vitest'
import { defaultUpmixOptions, normalizeUpmixOptions } from '../api/types'
import { upmixStateLabel } from './upmix'

describe('upmixOptions', () => {
  it('eksik alanları varsayılanla doldurur', () => {
    expect(normalizeUpmixOptions(undefined)).toEqual(defaultUpmixOptions())
    expect(normalizeUpmixOptions({ mode: 'game' })).toEqual({ ...defaultUpmixOptions(), mode: 'game' })
    expect(defaultUpmixOptions().mode).toBe('film')
  })

  it('geçersiz değerleri düzeltir ve aralığa kırpar', () => {
    const n = normalizeUpmixOptions({ mode: 'concert' as never, centerDb: 20, surroundDb: -40, lfeEnabled: 'x' as never })
    expect(n).toEqual({ mode: 'film', centerDb: 6, surroundDb: -12, lfeEnabled: true })
  })

  it('JSON gidiş-dönüşünde korunur', () => {
    const o = { mode: 'game' as const, centerDb: -3.5, surroundDb: 2, lfeEnabled: false }
    expect(normalizeUpmixOptions(JSON.parse(JSON.stringify(o)))).toEqual(o)
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
