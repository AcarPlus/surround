import { describe, expect, it } from 'vitest'
import type { Speaker } from '../api/types'
import { assignExisting, countLayout, formatLayout, layoutSlots, parseLayout } from './layout'

const L = { x: 2.5, y: 2.5 }
const sp = (id: string, role: string | undefined, source: Speaker['source'], extra: Partial<Speaker> = {}): Speaker => ({
  id,
  name: id,
  outputDeviceId: 'd',
  deviceChannel: 1,
  source,
  delayMs: 0,
  gainDb: 0,
  mute: false,
  x: 0,
  y: 0,
  role,
  ...extra,
})

describe('parseLayout', () => {
  it('X.Y ve X.Y.Z', () => {
    expect(parseLayout('5.1')).toEqual({ ok: true, spec: { floor: 5, sub: 1, height: 0 } })
    expect(parseLayout(' 7.1.4 ')).toEqual({ ok: true, spec: { floor: 7, sub: 1, height: 4 } })
    expect(parseLayout('3,1')).toMatchObject({ ok: true })
  })
  it('hatalar', () => {
    expect(parseLayout('abc')).toMatchObject({ ok: false })
    expect(parseLayout('5')).toMatchObject({ ok: false })
    expect(parseLayout('17.0')).toMatchObject({ ok: false })
    expect(parseLayout('0.0')).toMatchObject({ ok: false })
    expect(parseLayout('1.2.3.4')).toMatchObject({ ok: false })
  })
  it('formatLayout', () => {
    expect(formatLayout({ floor: 5, sub: 1, height: 0 })).toBe('5.1')
    expect(formatLayout({ floor: 5, sub: 1, height: 2 })).toBe('5.1.2')
  })
})

describe('layoutSlots', () => {
  it('5.1.2: 8 yuva, roller ve kategori', () => {
    const slots = layoutSlots({ floor: 5, sub: 1, height: 2 }, L)
    expect(slots).toHaveLength(8)
    expect(slots.filter((s) => s.category === 'height').map((s) => s.role)).toEqual(['top-front-left', 'top-front-right'])
    expect(slots.filter((s) => s.category === 'sub')).toHaveLength(1)
    expect(slots.find((s) => s.role === 'center')!.y).toBeLessThan(L.y)
  })
  it('3 -> Sol, Orta, Sağ; 4 -> Sol, Sağ, Arka sol, Arka sağ', () => {
    expect(layoutSlots({ floor: 3, sub: 0, height: 0 }, L).map((s) => s.role).sort()).toEqual(['center', 'left', 'right'])
    expect(layoutSlots({ floor: 4, sub: 0, height: 0 }, L).map((s) => s.role)).toEqual([
      'left',
      'right',
      'back-left',
      'back-right',
    ])
  })
  it('diğer üst sayıları özel (haritadan)', () => {
    expect(layoutSlots({ floor: 0, sub: 0, height: 3 }, L).every((s) => s.role === 'custom-map')).toBe(true)
  })
})

describe('assignExisting', () => {
  it('rolle eşler, kalanı kategori içinde konumla', () => {
    const slots = layoutSlots({ floor: 3, sub: 1, height: 0 }, L)
    const ex = [
      sp('a', 'right', { FR: 1 }),
      sp('b', undefined, { LFE: 1 }, { bassReceiver: true }),
      sp('c', 'side-left', { SL: 1 }),
    ]
    const r = assignExisting(slots, ex)
    const byId = Object.fromEntries(slots.map((s, i) => [s.role, r.matches[i]?.id]))
    expect(byId.right).toBe('a')
    expect(byId.sub).toBe('b')
    expect(byId.left).toBe('c') // rol yok, konumla kalan zemin hoparlörü
    expect(byId.center).toBeUndefined()
    expect(r.dropped).toBe(0)
  })
  it('fazla hoparlör düşer', () => {
    const slots = layoutSlots({ floor: 1, sub: 0, height: 0 }, L)
    const r = assignExisting(slots, [sp('a', 'left', { FL: 1 }), sp('b', 'right', { FR: 1 })])
    expect(r.dropped).toBe(1)
  })
  it('countLayout', () => {
    expect(
      countLayout([
        sp('a', 'left', { FL: 1 }),
        sp('b', 'sub', { LFE: 1 }),
        sp('c', 'top-front-left', { TFL: 1 }, { elevated: true }),
      ]),
    ).toEqual({ floor: 1, sub: 1, height: 1 })
  })
})
