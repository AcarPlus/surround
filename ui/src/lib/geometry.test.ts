import { describe, expect, it } from 'vitest'
import {
  SPEED_OF_SOUND,
  autoDelayMs,
  autoGainDb,
  clampToRoom,
  computeAuto,
  distance,
  maxDistance,
  polarToPoint,
  presetLayout,
  primaryChannel,
} from './geometry'

const L = { x: 2.5, y: 2.5 }

describe('distance', () => {
  it('3-4-5 üçgeni', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
  it('maxDistance en uzağı bulur, boş listede 0', () => {
    expect(maxDistance([{ x: 2.5, y: 0.5 }, { x: 2.5, y: 4.5 }, { x: 3, y: 2.5 }], L)).toBe(2)
    expect(maxDistance([], L)).toBe(0)
  })
})

describe('autoDelayMs', () => {
  it('en uzak hoparlör gecikmesiz', () => {
    expect(autoDelayMs(3, 3)).toBe(0)
  })
  it('1 m fark ≈ 2.915 ms', () => {
    expect(autoDelayMs(2, 3)).toBeCloseTo(1000 / SPEED_OF_SOUND, 6)
  })
  it('negatif olmaz', () => {
    expect(autoDelayMs(4, 3)).toBe(0)
  })
})

describe('autoGainDb', () => {
  it('en uzak 0 dB', () => {
    expect(autoGainDb(3, 3)).toBe(0)
  })
  it('yarı mesafe ≈ −6.02 dB', () => {
    expect(autoGainDb(1.5, 3)).toBeCloseTo(-6.0206, 3)
  })
  it('sıfır mesafe/boş oda güvenli', () => {
    expect(autoGainDb(0, 3)).toBe(0)
    expect(autoGainDb(2, 0)).toBe(0)
  })
})

describe('polarToPoint', () => {
  it('0° tam ön (yukarı), 90° sağ', () => {
    const f = polarToPoint(L, 0, 2)
    expect(f.x).toBeCloseTo(2.5)
    expect(f.y).toBeCloseTo(0.5)
    const r = polarToPoint(L, 90, 2)
    expect(r.x).toBeCloseTo(4.5)
    expect(r.y).toBeCloseTo(2.5)
  })
})

describe('presetLayout', () => {
  it('kanal sayıları', () => {
    expect(presetLayout('2.0', L)).toHaveLength(2)
    expect(presetLayout('5.1', L)).toHaveLength(6)
    expect(presetLayout('7.1', L)).toHaveLength(8)
  })
  it('hepsi 2 m yarıçapta', () => {
    for (const p of [...presetLayout('5.1', L), ...presetLayout('7.1', L)]) {
      expect(distance(p, L)).toBeCloseTo(2, 6)
    }
  })
  it('5.1: FL −30°, BR +110°', () => {
    const lay = presetLayout('5.1', L)
    const fl = lay.find((s) => s.channel === 'FL')!
    expect(fl.x).toBeCloseTo(L.x - 1, 6)
    expect(fl.y).toBeCloseTo(L.y - Math.sqrt(3), 6)
    const br = lay.find((s) => s.channel === 'BR')!
    expect(br.x).toBeGreaterThan(L.x)
    expect(br.y).toBeGreaterThan(L.y) // arkada
  })
  it('7.1: SL/SR tam yanlarda, simetrik', () => {
    const lay = presetLayout('7.1', L)
    const sl = lay.find((s) => s.channel === 'SL')!
    const sr = lay.find((s) => s.channel === 'SR')!
    expect(sl.y).toBeCloseTo(L.y, 6)
    expect(sl.x + sr.x).toBeCloseTo(2 * L.x, 6)
  })
})

describe('computeAuto', () => {
  it('eşit mesafede hepsi 0 ms / 0 dB', () => {
    const pts = presetLayout('7.1', L).map((p, i) => ({ id: String(i), x: p.x, y: p.y }))
    const { dMax, byId } = computeAuto(pts, L)
    expect(dMax).toBeCloseTo(2)
    for (const v of Object.values(byId)) {
      expect(v.delayMs).toBeCloseTo(0, 6)
      expect(v.gainDb).toBeCloseTo(0, 6)
    }
  })
  it('yakın hoparlör gecikir ve kısılır', () => {
    const { byId } = computeAuto(
      [
        { id: 'a', x: 2.5, y: 1.5 }, // 1 m
        { id: 'b', x: 2.5, y: 4.5 }, // 2 m
      ],
      L,
    )
    expect(byId.b.delayMs).toBe(0)
    expect(byId.a.delayMs).toBeCloseTo(2.915, 2)
    expect(byId.a.gainDb).toBeCloseTo(-6.02, 2)
  })
})

describe('clampToRoom / primaryChannel', () => {
  it('odanın içine sıkıştırır', () => {
    expect(clampToRoom({ x: -1, y: 9 }, { widthM: 5, depthM: 4 })).toEqual({ x: 0, y: 4 })
  })
  it('ana kanal en yüksek kazançlı', () => {
    expect(primaryChannel({ BL: 1, SL: 0.5 })).toBe('BL')
    expect(primaryChannel({})).toBeNull()
  })
})
