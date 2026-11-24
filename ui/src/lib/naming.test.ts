import { describe, expect, it } from 'vitest'
import type { Speaker } from '../api/types'
import { applyAutoNames, floorPositionName, isAutoName, positionName } from './naming'
import { polarToPoint } from './geometry'

const L = { x: 2.5, y: 2.5 }

function spk(id: string, name: string, angle: number, extra: Partial<Speaker> = {}): Speaker {
  const p = polarToPoint(L, angle, 2)
  return { id, name, outputDeviceId: 'd', deviceChannel: 1, source: {}, delayMs: 0, gainDb: 0, mute: false, ...p, ...extra }
}

describe('konum adı', () => {
  it('açı aralıkları', () => {
    expect(floorPositionName(0)).toBe('Orta')
    expect(floorPositionName(-10)).toBe('Orta')
    expect(floorPositionName(30)).toBe('Ön sağ')
    expect(floorPositionName(-45)).toBe('Ön sol')
    expect(floorPositionName(60)).toBe('Geniş sağ')
    expect(floorPositionName(-90)).toBe('Yan sol')
    expect(floorPositionName(110)).toBe('Yan sağ')
    expect(floorPositionName(-135)).toBe('Arka sol')
    expect(floorPositionName(165)).toBe('Arka sağ')
    expect(floorPositionName(180)).toBe('Arka orta')
    expect(floorPositionName(-170)).toBe('Arka orta')
  })
  it('üst öneki', () => {
    expect(positionName(-45, true)).toBe('Üst ön sol')
    expect(positionName(0, true)).toBe('Üst orta')
    expect(positionName(140, true)).toBe('Üst arka sağ')
  })
})

describe('otomatik ad kalıbı', () => {
  it('tanınan adlar', () => {
    for (const n of ['Orta', 'Ön sol', 'Arka orta 2', 'Sol', 'Sub 1', 'Subwoofer', 'Hoparlör 4', 'Üst hoparlör 3', 'Üst ön sağ', 'Orta kopya', 'Yan sağ 2 kopya'])
      expect(isAutoName(n), n).toBe(true)
  })
  it('kullanıcı adları', () => {
    for (const n of ['Masa sol', 'Orta hoparlör', 'Mutfak', 'orta', 'Ön sol yedek', '2'])
      expect(isAutoName(n), n).toBe(false)
  })
})

describe('applyAutoNames', () => {
  it('arkaya taşınan orta hoparlör "Arka orta" olur', () => {
    const out = applyAutoNames([spk('c', 'Orta', 180, { role: 'center' })], L)
    expect(out[0].name).toBe('Arka orta')
  })
  it('kullanıcının yazdığı ad değişmez', () => {
    const s = [spk('a', 'Masa sol', 180), spk('b', 'Orta', 180, { customName: true })]
    const out = applyAutoNames(s, L)
    expect(out).toBe(s)
  })
  it('subwoofer adını korur', () => {
    const s = [spk('s', 'Subwoofer', 120, { role: 'sub', bassReceiver: true })]
    expect(applyAutoNames(s, L)[0].name).toBe('Subwoofer')
  })
  it('üst hoparlör öneki', () => {
    const out = applyAutoNames([spk('t', 'Üst ön sol', 135, { elevated: true, role: 'top-front-left' })], L)
    expect(out[0].name).toBe('Üst arka sağ')
  })
  it('aynı bölgede çakışma numaralanır, elle verilen ad atlanır', () => {
    const s = [
      spk('a', 'Orta', 0),
      spk('b', 'Hoparlör 2', 5),
      spk('c', 'Orta 2', 2, { customName: true }),
      spk('d', 'Sol', -5),
    ]
    expect(applyAutoNames(s, L).map((v) => v.name)).toEqual(['Orta', 'Orta 3', 'Orta 2', 'Orta 4'])
  })
  it('kopya adı yeniden numaralanır', () => {
    const s = [spk('a', 'Ön sol', -30), spk('b', 'Ön sol kopya', -32)]
    expect(applyAutoNames(s, L).map((v) => v.name)).toEqual(['Ön sol', 'Ön sol 2'])
  })
  it('değişiklik yoksa aynı nesneler', () => {
    const s = [spk('a', 'Ön sol', -30), spk('b', 'Ön sağ', 30)]
    const out = applyAutoNames(s, L)
    expect(out).toBe(s)
  })
  it('dinleyiciye çok yakın hoparlörün adı değişmez', () => {
    const s = [{ ...spk('a', 'Ön sol', 0), x: L.x + 0.1, y: L.y }]
    expect(applyAutoNames(s, L)[0].name).toBe('Ön sol')
  })
})
