import { describe, expect, it } from 'vitest'
import { angleFromListener } from './roles'
import { distance, polarToPoint } from './geometry'
import { layoutSlots } from './layout'
import { idealListenerPoint, idealSpeakerPoint } from './snap'

const room = { widthM: 5, depthM: 4.5 }
const L = { x: 2.5, y: 3 }
const sp = (role: string, angle: number, r = 2, elevated = false) => ({ role, source: {}, elevated, ...polarToPoint(L, angle, r) })

describe('idealSpeakerPoint', () => {
  it('rol açısına döner, uzaklığı korur', () => {
    const s = sp('back-left', 70, 1.5)
    const p = idealSpeakerPoint(s, [s], L, room)!
    expect(angleFromListener(p, L)).toBeCloseTo(-110, 5)
    expect(distance(p, L)).toBeCloseTo(1.5, 5)
  })

  it('yan hoparlör varsa arka çift ±150°', () => {
    const s = sp('back-right', 20, 1)
    const p = idealSpeakerPoint(s, [s, sp('side-left', -90)], L, room)!
    expect(angleFromListener(p, L)).toBeCloseTo(150, 5)
  })

  it('düzen seçicinin yerleşimi zaten ideal', () => {
    for (const s of layoutSlots({ floor: 5, sub: 1, height: 0 }, L)) {
      const x = { ...s, source: {} }
      const p = idealSpeakerPoint(x, [], L, room)!
      expect(distance(p, x)).toBeLessThan(1e-6)
    }
  })

  it('özel rolde null; dinleyicinin üstündeyse varsayılan yarıçap', () => {
    expect(idealSpeakerPoint(sp('custom-map', 10), [], L, room)).toBeNull()
    const p = idealSpeakerPoint({ ...sp('left', 0), ...L }, [], L, room)!
    expect(distance(p, L)).toBeCloseTo(2, 5)
  })

  it('oda dışına taşmaz', () => {
    const p = idealSpeakerPoint(sp('center', 90, 2.9), [], L, room)!
    expect(p.y).toBeGreaterThanOrEqual(0)
  })
})

describe('idealListenerPoint', () => {
  it('ön çifti ±30° görecek noktaya gider', () => {
    const l = { role: 'left', source: {}, x: 1.5, y: 0.5 }
    const r = { role: 'right', source: {}, x: 3.5, y: 0.5 }
    const p = idealListenerPoint([l, r, { role: 'center', source: {}, x: 2.4, y: 0.4 }], room)!
    expect(angleFromListener(l, p)).toBeCloseTo(-30, 5)
    expect(angleFromListener(r, p)).toBeCloseTo(30, 5)
    expect(p.y).toBeGreaterThan(0.5)
  })

  it('ön çift yoksa hoparlörlere eşit uzaklıktaki nokta', () => {
    const ps = [sp('center', 0), sp('side-left', -90), sp('side-right', 90)]
    const p = idealListenerPoint(ps, room)!
    expect(p.x).toBeCloseTo(L.x, 5)
    expect(p.y).toBeCloseTo(L.y, 5)
  })

  it('arkada hoparlör varsa hepsine eşit uzaklıktaki ortaya gider (2x2 oda, ön çift + arka orta)', () => {
    const room2 = { widthM: 2, depthM: 2 }
    const ps = [
      { role: 'left', source: {}, x: 0.57, y: 0.48 },
      { role: 'right', source: {}, x: 1.57, y: 0.48 },
      { role: 'back-center', source: {}, x: 1.07, y: 1.87 },
    ]
    const p = idealListenerPoint(ps, room2)!
    expect(p.x).toBeCloseTo(1.07, 5)
    const d = ps.map((s) => distance(s, p))
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(1e-6)
  })

  it('5.1 düzeninde dinleyicinin kendisi', () => {
    const ps = layoutSlots({ floor: 5, sub: 1, height: 0 }, L).map((s) => ({ ...s, source: {} }))
    const p = idealListenerPoint(ps, room)!
    expect(distance(p, L)).toBeLessThan(1e-6)
  })

  it('subwoofer ve üst hoparlörleri saymaz; hoparlör yoksa null', () => {
    expect(idealListenerPoint([sp('sub', 15), sp('top-front-left', -45, 1.2, true)], room)).toBeNull()
  })
})
