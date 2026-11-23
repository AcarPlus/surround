import { describe, expect, it } from 'vitest'
import { layoutSlots } from './layout'
import { polarToPoint } from './geometry'
import { suggestRole } from './roles'

const L = { x: 2.5, y: 3 }
const at = (role: string, angle: number, r = 2) => ({ role, source: {}, ...polarToPoint(L, angle, r) })

describe('suggestRole', () => {
  it('düzen seçicinin her yerleşimi kendi rolünde kalır (öneri yok)', () => {
    for (let floor = 1; floor <= 9; floor++)
      for (const height of [0, 2, 4])
        for (const sub of [0, 1, 2])
          for (const s of layoutSlots({ floor, sub, height }, L))
            expect(suggestRole({ ...s, source: {} }, L), `${floor}.${sub}.${height} ${s.role}`).toBeNull()
  })

  it('arka sol sağ yana taşınınca yan sağ önerir', () => {
    expect(suggestRole(at('back-left', 90), L)).toBe('side-right')
  })

  it('ön sol ortaya taşınınca orta önerir', () => {
    expect(suggestRole(at('left', 2), L)).toBe('center')
  })

  it('arka sol tam arkaya taşınınca arka orta önerir', () => {
    expect(suggestRole(at('back-left', 179), L)).toBe('back-center')
  })

  it('aralık içindeki küçük kaydırmalar öneri üretmez', () => {
    expect(suggestRole(at('left', -45), L)).toBeNull()
    expect(suggestRole(at('back-left', -100), L)).toBeNull()
    expect(suggestRole(at('side-right', 115), L)).toBeNull()
  })

  it('sınırın hemen dışında, mevcut rol hâlâ en yakınsa öneri yok', () => {
    expect(suggestRole(at('left', -55), L)).toBeNull()
  })

  it('geniş rol önerilmez', () => {
    expect(suggestRole(at('side-left', -55), L)).toBe('left')
    expect(suggestRole(at('left', -62), L)).toBeNull()
    expect(suggestRole(at('left', -88), L)).toBe('side-left')
  })

  it('üst hoparlörler kendi grubunda kalır', () => {
    expect(suggestRole(at('top-front-left', 140, 1.2), L)).toBe('top-back-right')
  })

  it('subwoofer, özel roller ve dinleyiciye çok yakın hoparlör için öneri yok', () => {
    expect(suggestRole(at('sub', 180), L)).toBeNull()
    expect(suggestRole(at('custom-map', 180), L)).toBeNull()
    expect(suggestRole(at('custom-manual', 180), L)).toBeNull()
    expect(suggestRole(at('top-center', 180, 1.2), L)).toBeNull()
    expect(suggestRole(at('left', 150, 0.2), L)).toBeNull()
  })
})
