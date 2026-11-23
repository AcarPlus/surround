import { describe, expect, it } from 'vitest'
import { angleFromListener } from './roles'
import { distance, polarToPoint } from './geometry'
import { layoutSlots } from './layout'
import { idealSpeakerPoint } from './snap'

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
