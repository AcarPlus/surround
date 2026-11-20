import type { Point, Room } from '../api/types'
import { clampToRoom, polarToPoint, round } from './geometry'
import { angleFromListener, normalizeAngle } from './roles'
import { placementRadius } from './setup'

/**
 * "Bu ses nereden geliyor?" dokunarak yerleştirme (TapDial) için saf yardımcılar.
 * Açı: dinleyiciye göre derece; 0° = ön (yukarı), + = sağ, aralık (-180, 180].
 */

/** Dokunarak yerleştirmede otomatik atanabilen zemin rolleri ve açıları (arkalar yan hoparlörlü/yansız düzenin ortası). */
export const TAP_ROLES: readonly { role: string; angle: number }[] = [
  { role: 'center', angle: 0 },
  { role: 'right', angle: 30 },
  { role: 'side-right', angle: 90 },
  { role: 'back-right', angle: 135 },
  { role: 'back-center', angle: 180 },
  { role: 'back-left', angle: -135 },
  { role: 'side-left', angle: -90 },
  { role: 'left', angle: -30 },
]

/** Ekran farkından (dx sağa, dy aşağı) açı; dinleyici merkezde, ön yukarıda. Merkezdeyse 0. */
export function pointerToAngle(dx: number, dy: number): number {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 0
  return normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI)
}

/** Açıdan birim çember üstünde çizim noktası (x sağa, y aşağı; ön = -y). */
export function angleToUnit(angleDeg: number): Point {
  const a = (angleDeg * Math.PI) / 180
  return { x: Math.sin(a), y: -Math.cos(a) }
}

/** İki açı arasındaki en kısa fark (0..180). */
export function angleDistance(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b))
}

/** Açıya en yakın zemin rolü. */
export function nearestRole(angleDeg: number): string {
  let best = TAP_ROLES[0]
  let bestD = Infinity
  for (const r of TAP_ROLES) {
    const d = angleDistance(angleDeg, r.angle)
    if (d < bestD) {
      best = r
      bestD = d
    }
  }
  return best.role
}

/** Standart rol açılarına `tolDeg` içindeyse oraya yapıştırır; değilse açıyı olduğu gibi (yuvarlanmış) döndürür. */
export function snapAngle(angleDeg: number, tolDeg = 7): number {
  const a = normalizeAngle(angleDeg)
  for (const r of TAP_ROLES) if (angleDistance(a, r.angle) <= tolDeg) return r.angle
  return Math.round(a)
}

/** Açı + oda → hoparlör konumu (standart yerleşim yarıçapında, odaya sığdırılmış, 2 hane). */
export function angleToPosition(angleDeg: number, room: Room): Point {
  const p = clampToRoom(polarToPoint(room.listener, angleDeg, placementRadius(room)), room)
  return { x: round(p.x, 2), y: round(p.y, 2) }
}

/** Konum → dinleyiciye göre açı (yuvarlanmış). */
export function positionToAngle(p: Point, listener: Point): number {
  return Math.round(angleFromListener(p, listener))
}

/** Okunur yön: "Önde", "Sağ önde", "Sağ yanda", "Sağ arkada", "Arkada" … */
export function describeAngle(angleDeg: number): string {
  const a = normalizeAngle(angleDeg)
  const abs = Math.abs(a)
  if (abs <= 12) return 'Önde'
  if (abs >= 168) return 'Arkada'
  const side = a < 0 ? 'Sol' : 'Sağ'
  if (abs < 60) return `${side} önde`
  if (abs <= 115) return `${side} yanda`
  return `${side} arkada`
}
