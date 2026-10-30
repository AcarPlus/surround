import { describe, expect, it } from 'vitest'
import type { LogicalChannel } from '../api/types'
import {
  FLOOR_NOMINAL,
  ROLES,
  ROLE_CUSTOM_MANUAL,
  ROLE_CUSTOM_MAP,
  angleFromListener,
  computeMapSource,
  effectiveRole,
  mapRow,
  normalizeAngle,
  rolePatch,
  vbapPan,
} from './roles'

const sumSq = (row: Partial<Record<LogicalChannel, number>>) =>
  Object.values(row).reduce((a, g) => a + (g as number) ** 2, 0)

describe('açı', () => {
  it('ön = 0°, sağ = +90°, arka = 180°, sol = -90° (y aşağı artar)', () => {
    const L = { x: 2, y: 2 }
    expect(angleFromListener({ x: 2, y: 1 }, L)).toBeCloseTo(0)
    expect(angleFromListener({ x: 3, y: 2 }, L)).toBeCloseTo(90)
    expect(angleFromListener({ x: 2, y: 3 }, L)).toBeCloseTo(180)
    expect(angleFromListener({ x: 1, y: 2 }, L)).toBeCloseTo(-90)
  })
  it('normalizeAngle', () => {
    expect(normalizeAngle(190)).toBeCloseTo(-170)
    expect(normalizeAngle(-190)).toBeCloseTo(170)
    expect(normalizeAngle(180)).toBe(180)
  })
})

describe('VBAP', () => {
  it('nominal açıda tek kanal', () => {
    for (const n of FLOOR_NOMINAL) {
      const row = mapRow(n.deg, false)
      expect(Object.keys(row)).toEqual([n.ch])
      expect(row[n.ch]).toBe(1)
    }
    expect(mapRow(45, true)).toEqual({ TFR: 1 })
  })
  it('FL(-30) ile SL(-90) arasında iki kanal, sabit güç', () => {
    const row = mapRow(-60, false)
    expect(Object.keys(row).sort()).toEqual(['FL', 'SL'])
    expect(row.FL).toBeCloseTo(Math.SQRT1_2, 2)
    expect(sumSq(row)).toBeCloseTo(1, 2)
  })
  it('her açıda kareler toplamı ≈ 1', () => {
    for (let a = -180; a < 180; a += 7) {
      expect(sumSq(mapRow(a, false))).toBeCloseTo(1, 2)
      expect(sumSq(mapRow(a, true))).toBeCloseTo(1, 2)
    }
  })
  it('arka çevrim: BR(150) ile BL(-150) arası', () => {
    const row = mapRow(180, false)
    expect(Object.keys(row).sort()).toEqual(['BL', 'BR'])
    expect(row.BL).toBeCloseTo(row.BR!, 3)
  })
  it('üst hoparlör yalnızca üst şeritleri kullanır', () => {
    for (const a of [-170, -100, -20, 0, 20, 100, 170]) {
      for (const ch of Object.keys(mapRow(a, true))) expect(ch).toMatch(/^T/)
    }
    expect(Object.keys(mapRow(0, true)).sort()).toEqual(['TFL', 'TFR'])
  })
  it('vbapPan tek nominalli listede çökmez', () => {
    expect(vbapPan(10, [{ ch: 'FC', deg: 0 }])).toBeTruthy()
  })
})

describe('computeMapSource', () => {
  const L = { x: 2.5, y: 2.5 }
  it('tam öndeki hoparlör FC', () => {
    expect(computeMapSource({ x: 2.5, y: 0.5 }, L)).toEqual({ FC: 1 })
  })
  it('dinleyici taşıyınca satır değişir', () => {
    const sp = { x: 3, y: 0.5 }
    const a = computeMapSource(sp, L)
    const b = computeMapSource(sp, { x: 3, y: 2.5 })
    expect(a).not.toEqual(b)
    expect(b).toEqual({ FC: 1 })
  })
  it('elevated üst şerit kullanır', () => {
    const row = computeMapSource({ x: 3.5, y: 1.5, elevated: true }, L)
    expect(Object.keys(row).every((c) => c.startsWith('T'))).toBe(true)
  })
})

describe('roller', () => {
  const L = { x: 2.5, y: 2.5 }
  const base = { x: 1, y: 1, source: {}, role: undefined, bassReceiver: undefined, elevated: undefined }
  it('tablo sözleşmeyle uyumlu', () => {
    const get = (id: string) => ROLES.find((r) => r.id === id)!
    expect(get('back-center').source.BL).toBeCloseTo(0.707, 3)
    expect(Object.keys(get('wide-left').source).sort()).toEqual(['FL', 'SL'])
    expect(get('top-center').source).toEqual({ TFL: 0.5, TFR: 0.5, TBL: 0.5, TBR: 0.5 })
  })
  it('Subwoofer bassReceiver açar, başka role geçince kapatır', () => {
    const p = rolePatch(base, 'sub', L)
    expect(p.source).toEqual({ LFE: 1 })
    expect(p.bassReceiver).toBe(true)
    const q = rolePatch({ ...base, ...p }, 'left', L)
    expect(q.bassReceiver).toBeUndefined()
    expect('bassReceiver' in q).toBe(true)
  })
  it('üst rol elevated yapar', () => {
    expect(rolePatch(base, 'top-front-left', L)).toMatchObject({ elevated: true, source: { TFL: 1 } })
  })
  it('Özel (haritadan) satırı hesaplar, Özel (elle) dokunmaz', () => {
    expect(rolePatch({ ...base, x: 2.5, y: 0.5 }, ROLE_CUSTOM_MAP, L).source).toEqual({ FC: 1 })
    expect(rolePatch({ ...base, source: { FL: 0.3 } }, ROLE_CUSTOM_MANUAL, L)).toEqual({ role: ROLE_CUSTOM_MANUAL })
  })
  it('effectiveRole satırdan çıkarım yapar', () => {
    expect(effectiveRole({ source: { FL: 1 } })).toBe('left')
    expect(effectiveRole({ source: { FL: 0.4, BR: 0.2 } })).toBe(ROLE_CUSTOM_MANUAL)
    expect(effectiveRole({ role: 'center', source: {} })).toBe('center')
  })
})
