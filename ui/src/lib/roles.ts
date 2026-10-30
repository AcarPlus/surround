import type { LogicalChannel, Point, Speaker } from '../api/types'

/** Hoparlör rolleri (docs/duzen.md): rol kimliği -> mantıksal kanal satırı. Kimlikler yalnızca arayüzde kullanılır. */
export interface RoleDef {
  id: string
  label: string
  source: Partial<Record<LogicalChannel, number>>
  bassReceiver?: boolean
  /** Üst hoparlör rolü: hoparlör `elevated` işaretlenir. */
  elevated?: boolean
}

export const ROLE_CUSTOM_MAP = 'custom-map'
export const ROLE_CUSTOM_MANUAL = 'custom-manual'
export const ROLE_SUB = 'sub'
const R = 0.707

export const ROLES: readonly RoleDef[] = [
  { id: 'left', label: 'Sol', source: { FL: 1 } },
  { id: 'right', label: 'Sağ', source: { FR: 1 } },
  { id: 'center', label: 'Orta', source: { FC: 1 } },
  { id: 'side-left', label: 'Yan sol', source: { SL: 1 } },
  { id: 'side-right', label: 'Yan sağ', source: { SR: 1 } },
  { id: 'back-left', label: 'Arka sol', source: { BL: 1 } },
  { id: 'back-right', label: 'Arka sağ', source: { BR: 1 } },
  { id: 'back-center', label: 'Arka orta', source: { BL: R, BR: R } },
  { id: 'wide-left', label: 'Geniş sol', source: { FL: R, SL: R } },
  { id: 'wide-right', label: 'Geniş sağ', source: { FR: R, SR: R } },
  { id: ROLE_SUB, label: 'Subwoofer', source: { LFE: 1 }, bassReceiver: true },
  { id: 'top-front-left', label: 'Üst ön sol', source: { TFL: 1 }, elevated: true },
  { id: 'top-front-right', label: 'Üst ön sağ', source: { TFR: 1 }, elevated: true },
  { id: 'top-back-left', label: 'Üst arka sol', source: { TBL: 1 }, elevated: true },
  { id: 'top-back-right', label: 'Üst arka sağ', source: { TBR: 1 }, elevated: true },
  { id: 'top-center', label: 'Üst orta', source: { TFL: 0.5, TFR: 0.5, TBL: 0.5, TBR: 0.5 }, elevated: true },
]

export const CUSTOM_MAP_LABEL = 'Özel (haritadan)'
export const CUSTOM_MANUAL_LABEL = 'Özel (elle)'

const BY_ID = new Map(ROLES.map((r) => [r.id, r]))

export const roleDef = (id: string | undefined): RoleDef | undefined => (id ? BY_ID.get(id) : undefined)

export function roleLabel(id: string | undefined): string {
  if (id === ROLE_CUSTOM_MAP) return CUSTOM_MAP_LABEL
  if (id === ROLE_CUSTOM_MANUAL) return CUSTOM_MANUAL_LABEL
  return roleDef(id)?.label ?? CUSTOM_MANUAL_LABEL
}

/* ---------- VBAP (haritadan) ---------- */

/** Zemin hoparlörü için nominal açılar (0° = ön, + = sağ). Artan sırada. */
export const FLOOR_NOMINAL: readonly { ch: LogicalChannel; deg: number }[] = [
  { ch: 'BL', deg: -150 },
  { ch: 'SL', deg: -90 },
  { ch: 'FL', deg: -30 },
  { ch: 'FC', deg: 0 },
  { ch: 'FR', deg: 30 },
  { ch: 'SR', deg: 90 },
  { ch: 'BR', deg: 150 },
]

/** Üst hoparlör için nominal açılar. */
export const HEIGHT_NOMINAL: readonly { ch: LogicalChannel; deg: number }[] = [
  { ch: 'TBL', deg: -135 },
  { ch: 'TFL', deg: -45 },
  { ch: 'TFR', deg: 45 },
  { ch: 'TBR', deg: 135 },
]

/** Açıyı (-180, 180] aralığına getirir. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360
  if (a > 180) a -= 360
  if (a <= -180) a += 360
  return a
}

/**
 * Dinleyiciden hoparlöre açı. 0° = ön (planda yukarı, y azalır), + = sağ (x artar).
 * Konumlar oda koordinatıdır: y aşağı doğru artar.
 */
export function angleFromListener(p: Point, listener: Point): number {
  const dx = p.x - listener.x
  const dy = p.y - listener.y
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 0
  // ön = -y, sağ = +x  =>  atan2(dx, -dy)
  return normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI)
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

/** θ'yı çevreleyen iki komşu nominal kanal arasında sabit güçlü (sin/cos) pan. Kareler toplamı ≈ 1. */
export function vbapPan(
  thetaDeg: number,
  nominal: readonly { ch: LogicalChannel; deg: number }[],
): Partial<Record<LogicalChannel, number>> {
  const n = nominal.length
  let theta = normalizeAngle(thetaDeg)
  const first = nominal[0].deg
  if (theta < first) theta += 360
  for (let i = 0; i < n; i++) {
    const a = nominal[i].deg
    const b = i + 1 < n ? nominal[i + 1].deg : first + 360
    if (theta >= a && theta < b) {
      const t = (theta - a) / (b - a)
      const ga = Math.cos((t * Math.PI) / 2)
      const gb = Math.sin((t * Math.PI) / 2)
      const out: Partial<Record<LogicalChannel, number>> = {}
      if (r3(ga) > 0) out[nominal[i].ch] = r3(ga)
      if (r3(gb) > 0) out[nominal[(i + 1) % n].ch] = r3(gb)
      return out
    }
  }
  return { [nominal[0].ch]: 1 }
}

/** "Özel (haritadan)" karışım satırı. */
export function mapRow(thetaDeg: number, elevated: boolean): Partial<Record<LogicalChannel, number>> {
  return vbapPan(thetaDeg, elevated ? HEIGHT_NOMINAL : FLOOR_NOMINAL)
}

/** Hoparlörün konumundan hesaplanan satır. */
export function computeMapSource(
  sp: Pick<Speaker, 'x' | 'y' | 'elevated'>,
  listener: Point,
): Partial<Record<LogicalChannel, number>> {
  return mapRow(angleFromListener(sp, listener), !!sp.elevated)
}

/* ---------- Rol <-> satır ---------- */

export const sameRow = (a: Speaker['source'], b: Speaker['source']): boolean => {
  const ka = Object.keys(a) as LogicalChannel[]
  const kb = Object.keys(b) as LogicalChannel[]
  if (ka.length !== kb.length) return false
  return ka.every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.011)
}

/** Kayıtlı rol yoksa satırdan çıkarım (eski yapılandırmalar için); tanınmazsa "Özel (elle)". */
export function effectiveRole(sp: Pick<Speaker, 'role' | 'source'>): string {
  if (sp.role) return sp.role
  const hit = ROLES.find((r) => sameRow(r.source, sp.source))
  return hit?.id ?? ROLE_CUSTOM_MANUAL
}

/**
 * Rol seçiminin hoparlöre yazacağı alanlar. "Özel (elle)" satırı olduğu gibi bırakır.
 * Subwoofer `bassReceiver` açar; subwoofer'dan başka role geçince kapatır.
 */
export function rolePatch(
  sp: Pick<Speaker, 'x' | 'y' | 'elevated' | 'source' | 'role' | 'bassReceiver'>,
  roleId: string,
  listener: Point,
): Partial<Speaker> {
  const prev = effectiveRole(sp)
  if (roleId === ROLE_CUSTOM_MANUAL) return { role: roleId }
  if (roleId === ROLE_CUSTOM_MAP) {
    return {
      role: roleId,
      source: computeMapSource(sp, listener),
      ...(prev === ROLE_SUB ? { bassReceiver: undefined } : {}),
    }
  }
  const def = roleDef(roleId)
  if (!def) return { role: ROLE_CUSTOM_MANUAL }
  const patch: Partial<Speaker> = { role: roleId, source: { ...def.source } }
  if (def.bassReceiver) {
    patch.bassReceiver = true
    patch.highPassHz = undefined
  } else if (prev === ROLE_SUB) patch.bassReceiver = undefined
  if (def.elevated) patch.elevated = true
  return patch
}
