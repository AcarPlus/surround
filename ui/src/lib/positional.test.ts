import { describe, expect, it } from 'vitest'
import type { LogicalChannel } from '../api/types'
import { polarToPoint } from './geometry'
import { MAX_PAIR_SPAN, positionalRows } from './positional'

const L = { x: 2.5, y: 2.5 }
let seq = 0
const sp = (angle: number, extra: { role?: string; mute?: boolean; elevated?: boolean } = {}) => ({
  id: `s${++seq}`,
  source: {},
  mute: false,
  ...extra,
  ...polarToPoint(L, angle, 2),
})
const FLOOR: LogicalChannel[] = ['FL', 'FR', 'FC', 'SL', 'SR', 'BL', 'BR']

/** Bir kanalın tüm hoparlörlerdeki güç toplamı. */
const power = (rows: Map<string, Partial<Record<LogicalChannel, number>>>, ch: LogicalChannel) =>
  [...rows.values()].reduce((a, r) => a + (r[ch] ?? 0) ** 2, 0)

describe('positionalRows', () => {
  it('Enes örneği: orta 0°, iki hoparlör ±60°: ön sol/sağ ortayla eşit paylaşılır, yan/arka dışa gider', () => {
    const c = sp(0), l = sp(-60), r = sp(60)
    const rows = positionalRows([c, l, r], L)
    expect(rows.get(c.id)).toMatchObject({ FC: 1, FL: 0.707, FR: 0.707 })
    expect(rows.get(r.id)).toMatchObject({ FR: 0.707, SR: 1, BR: 1 })
    expect(rows.get(l.id)).toMatchObject({ FL: 0.707, SL: 1, BL: 1 })
    expect(rows.get(r.id)!.FL).toBeUndefined()
  })

  it('her kanalın gücü korunur (toplam 1)', () => {
    const rows = positionalRows([sp(0), sp(-45), sp(50), sp(-120), sp(115)], L)
    for (const ch of FLOOR) expect(power(rows, ch)).toBeCloseTo(1, 2)
  })

  it('hoparlör tam kanal açısındaysa kanalı yalnız o çalar (standart 7.0 = rol satırları)', () => {
    const angles: [number, LogicalChannel][] = [[-30, 'FL'], [30, 'FR'], [0, 'FC'], [-90, 'SL'], [90, 'SR'], [-150, 'BL'], [150, 'BR']]
    const list = angles.map(([a]) => sp(a))
    const rows = positionalRows(list, L)
    list.forEach((s, i) => expect(rows.get(s.id)).toEqual({ [angles[i][1]]: 1 }))
  })

  it(`aradaki boşluk ${MAX_PAIR_SPAN}°'den genişse hayali ses kurulmaz: arka kanal öne "geçmez"`, () => {
    const l = sp(-30), r = sp(30)
    const rows = positionalRows([l, r], L)
    // BL (−150°) sağ hoparlöre sızmaz; tamamen sola.
    expect(rows.get(l.id)!.BL).toBe(1)
    expect(rows.get(r.id)!.BL).toBeUndefined()
    // FC iki ön arasında eşit.
    expect(rows.get(l.id)!.FC).toBeCloseTo(0.707, 3)
  })

  it('sub, sessiz hoparlör katılmaz; üst hoparlörler kendi halkasında', () => {
    const sub = sp(15, { role: 'sub' }), muted = sp(-30, { mute: true }), f = sp(0), top = sp(-45, { elevated: true })
    const rows = positionalRows([sub, muted, f, top], L)
    expect(rows.has(sub.id)).toBe(false)
    expect(rows.has(muted.id)).toBe(false)
    expect(rows.get(f.id)).toMatchObject({ FL: 1, FC: 1, BR: 1 })
    expect(rows.get(top.id)).toEqual({ TFL: 1, TFR: 1, TBL: 1, TBR: 1 })
  })

  it('aynı yöndeki iki hoparlör kanalı güçte eşit paylaşır', () => {
    const a = sp(-30), b = sp(-30), c = sp(30)
    const rows = positionalRows([a, b, c], L)
    expect(rows.get(a.id)!.FL).toBeCloseTo(0.707, 3)
    expect(rows.get(b.id)!.FL).toBeCloseTo(0.707, 3)
    expect(power(rows, 'FL')).toBeCloseTo(1, 2)
  })

  it('sıkışık dizilimde ortada kalan hoparlöre kanal düşmeyebilir (mağaza rol satırına döner)', () => {
    const a = sp(-30), b = sp(-25), c = sp(-20), d = sp(30)
    const rows = positionalRows([a, b, c, d], L)
    expect(Object.keys(rows.get(b.id)!)).toHaveLength(0)
  })
})
