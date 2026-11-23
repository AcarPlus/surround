import type { Point, Speaker } from '../api/types'
import { polarToPoint } from './geometry'
import { ROLE_CUSTOM_MAP, ROLE_SUB, effectiveRole, roleDef, roleLabel } from './roles'

/** X.Y.Z düzeni: X zemin, Y sub, Z üst hoparlör sayısı. */
export interface LayoutSpec {
  floor: number
  sub: number
  height: number
}

export const LAYOUT_MAX = 16

export type LayoutParse = { ok: true; spec: LayoutSpec } | { ok: false; error: string }

export function parseLayout(text: string): LayoutParse {
  const t = text.trim().replace(/,/g, '.')
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(t)
  if (!m) return { ok: false, error: 'Biçim X.Y veya X.Y.Z olmalı (örn. 5.1 veya 5.1.2).' }
  const spec: LayoutSpec = { floor: Number(m[1]), sub: Number(m[2]), height: m[3] === undefined ? 0 : Number(m[3]) }
  if ([spec.floor, spec.sub, spec.height].some((n) => n < 0 || n > LAYOUT_MAX)) {
    return { ok: false, error: `Her sayı 0 ile ${LAYOUT_MAX} arasında olmalı.` }
  }
  if (spec.floor + spec.sub + spec.height < 1) return { ok: false, error: 'En az bir hoparlör gerekli.' }
  return { ok: true, spec }
}

export function formatLayout(s: LayoutSpec): string {
  return s.height > 0 ? `${s.floor}.${s.sub}.${s.height}` : `${s.floor}.${s.sub}`
}

export type SlotCategory = 'floor' | 'sub' | 'height'

export interface Slot {
  category: SlotCategory
  role: string
  name: string
  x: number
  y: number
}

interface PolarSlot {
  role: string
  angle: number
  radius?: number
}

const FLOOR_RADIUS = 2
const HEIGHT_RADIUS = 1.2
const SUB_RADIUS_MULTI = 1.6

/** Varsayılan adlar (rol etiketinden farklı olanlar). */
const NAMES: Record<string, string> = {
  left: 'Ön sol',
  right: 'Ön sağ',
  [ROLE_SUB]: 'Sub',
}

/** Rolün varsayılan hoparlör adı (düzen seçicinin verdiği). */
export const defaultRoleName = (role: string): string => NAMES[role] ?? roleLabel(role)

const spread = (n: number, start: number, step: number) => Array.from({ length: n }, (_, i) => start + i * step)

/** n zemin hoparlörü için standart açılar ve roller; 10+ eşit aralıklı "Özel (haritadan)". */
export function floorPlan(n: number): PolarSlot[] {
  const L: PolarSlot = { role: 'left', angle: -30 }
  const R: PolarSlot = { role: 'right', angle: 30 }
  const C: PolarSlot = { role: 'center', angle: 0 }
  const side = [
    { role: 'side-left', angle: -90 },
    { role: 'side-right', angle: 90 },
  ]
  const back7 = [
    { role: 'back-left', angle: -150 },
    { role: 'back-right', angle: 150 },
  ]
  switch (n) {
    case 0:
      return []
    case 1:
      return [C]
    case 2:
      return [L, R]
    case 3:
      return [L, R, C]
    case 4:
      return [L, R, { role: 'back-left', angle: -110 }, { role: 'back-right', angle: 110 }]
    case 5:
      return [L, R, C, { role: 'back-left', angle: -110 }, { role: 'back-right', angle: 110 }]
    case 6:
      return [L, R, C, ...side, { role: 'back-center', angle: 180 }]
    case 7:
      return [L, R, C, ...side, ...back7]
    case 8:
      return [L, R, C, ...side, ...back7, { role: 'back-center', angle: 180 }]
    case 9:
      return [L, R, C, ...side, ...back7, { role: 'wide-left', angle: -60 }, { role: 'wide-right', angle: 60 }]
    default:
      return spread(n, 0, 360 / n).map((a) => ({ role: ROLE_CUSTOM_MAP, angle: a > 180 ? a - 360 : a }))
  }
}

/** n üst hoparlör: 2 -> ön çift, 4 -> dörtlü, diğerleri eşit aralıklı "Özel (haritadan)". */
export function heightPlan(n: number): PolarSlot[] {
  if (n === 0) return []
  if (n === 2) return [{ role: 'top-front-left', angle: -45 }, { role: 'top-front-right', angle: 45 }]
  if (n === 4) {
    return [
      { role: 'top-front-left', angle: -45 },
      { role: 'top-front-right', angle: 45 },
      { role: 'top-back-left', angle: -135 },
      { role: 'top-back-right', angle: 135 },
    ]
  }
  return spread(n, 0, 1).map((i) => ({ role: ROLE_CUSTOM_MAP, angle: -180 + (360 * (i + 0.5)) / n }))
}

/** Subwoofer'lar ön tarafta. */
export function subPlan(n: number): PolarSlot[] {
  if (n === 0) return []
  if (n === 1) return [{ role: ROLE_SUB, angle: 15, radius: FLOOR_RADIUS }]
  const angles = n === 2 ? [-15, 15] : spread(n, -60, 120 / (n - 1))
  return angles.map((a) => ({ role: ROLE_SUB, angle: a, radius: SUB_RADIUS_MULTI }))
}

/**
 * Düzen için yuva listesi. Sıra: ilk üç zemin kanalı, sub'lar, kalan zemin, üst hoparlörler
 * (cihaz kanalları bu sırayla dağıtılır).
 */
export function layoutSlots(spec: LayoutSpec, listener: Point): Slot[] {
  const floor = floorPlan(spec.floor)
  const head = Math.min(3, floor.length)
  const polar: { cat: SlotCategory; s: PolarSlot }[] = [
    ...floor.slice(0, head).map((s) => ({ cat: 'floor' as const, s })),
    ...subPlan(spec.sub).map((s) => ({ cat: 'sub' as const, s })),
    ...floor.slice(head).map((s) => ({ cat: 'floor' as const, s })),
    ...heightPlan(spec.height).map((s) => ({ cat: 'height' as const, s })),
  ]
  const counts: Record<string, number> = {}
  const totals: Record<string, number> = {}
  for (const p of polar) totals[p.s.role + p.cat] = (totals[p.s.role + p.cat] ?? 0) + 1
  return polar.map(({ cat, s }) => {
    const key = s.role + cat
    counts[key] = (counts[key] ?? 0) + 1
    const base =
      s.role === ROLE_CUSTOM_MAP ? (cat === 'height' ? 'Üst hoparlör' : 'Hoparlör') : (NAMES[s.role] ?? roleLabel(s.role))
    const name = totals[key] > 1 ? `${base} ${counts[key]}` : base
    const p = polarToPoint(listener, s.angle, s.radius ?? (cat === 'height' ? HEIGHT_RADIUS : FLOOR_RADIUS))
    return { category: cat, role: s.role, name, x: p.x, y: p.y }
  })
}

/** Hoparlörün düzen kategorisi: sub rolü -> sub, üst -> height, diğeri zemin. */
export function speakerCategory(sp: Pick<Speaker, 'role' | 'source' | 'elevated'>): SlotCategory {
  if (effectiveRole(sp) === ROLE_SUB) return 'sub'
  if (sp.elevated || roleDef(sp.role)?.elevated) return 'height'
  return 'floor'
}

/** Mevcut hoparlörlerden X.Y.Z sayıları. */
export function countLayout(speakers: Pick<Speaker, 'role' | 'source' | 'elevated'>[]): LayoutSpec {
  const spec: LayoutSpec = { floor: 0, sub: 0, height: 0 }
  for (const s of speakers) {
    const c = speakerCategory(s)
    if (c === 'sub') spec.sub++
    else if (c === 'height') spec.height++
    else spec.floor++
  }
  return spec
}

export interface Assignment {
  /** Yuva sırasıyla eşleşen mevcut hoparlör (yoksa null). */
  matches: (Speaker | null)[]
  /** Rolle eşleşenler (ad korunur). */
  byRole: boolean[]
  /** Yuvaya girmeyen mevcut hoparlör sayısı. */
  dropped: number
}

/** Mevcut hoparlörleri yuvalara önce rolle, sonra (aynı kategoride) en yakın konumla eşler. */
export function assignExisting(slots: Slot[], existing: Speaker[]): Assignment {
  const used = new Set<number>()
  const matches: (Speaker | null)[] = slots.map(() => null)
  const byRole = slots.map(() => false)
  slots.forEach((slot, i) => {
    const k = existing.findIndex(
      (e, j) => !used.has(j) && speakerCategory(e) === slot.category && effectiveRole(e) === slot.role,
    )
    if (k >= 0) {
      used.add(k)
      matches[i] = existing[k]
      byRole[i] = true
    }
  })
  slots.forEach((slot, i) => {
    if (matches[i]) return
    let best = -1
    let bestD = Infinity
    existing.forEach((e, j) => {
      if (used.has(j) || speakerCategory(e) !== slot.category) return
      const d = Math.hypot(e.x - slot.x, e.y - slot.y)
      if (d < bestD) {
        bestD = d
        best = j
      }
    })
    if (best >= 0) {
      used.add(best)
      matches[i] = existing[best]
    }
  })
  return { matches, byRole, dropped: existing.length - used.size }
}
