import type { Point, Room, Speaker } from '../api/types'
import { clampToRoom, distance, polarToPoint } from './geometry'
import { ROLE_SUB, effectiveRole } from './roles'

/** Konum bilgisi gereken hoparlör alanları. */
type Sp = Pick<Speaker, 'x' | 'y' | 'role' | 'source' | 'elevated'>

const FLOOR_R = 2
const HEIGHT_R = 1.2
const MIN_R = 0.3

/** Rolün ideal açısı (0° = ön, + = sağ). Arka çift yan hoparlör varsa 7.1 gibi ±150°, yoksa 5.1 gibi ±110°. */
export function idealAngle(role: string, hasSides: boolean): number | null {
  const back = hasSides ? 150 : 110
  const A: Record<string, number> = {
    center: 0,
    left: -30,
    right: 30,
    'wide-left': -60,
    'wide-right': 60,
    'side-left': -90,
    'side-right': 90,
    'back-left': -back,
    'back-right': back,
    'back-center': 180,
    'top-front-left': -45,
    'top-front-right': 45,
    'top-back-left': -135,
    'top-back-right': 135,
    [ROLE_SUB]: 15,
  }
  return role in A ? A[role] : null
}

/**
 * Hoparlörün olması gereken yeri: rolünün standart açısı, dinleyiciye şimdiki uzaklığında (gerçek mesafe korunur;
 * dinleyicinin üstündeyse varsayılan yarıçap). Rolü açıya bağlı değilse (özel, üst orta) null.
 */
export function idealSpeakerPoint(sp: Sp, all: readonly Sp[], listener: Point, room: Pick<Room, 'widthM' | 'depthM'>): Point | null {
  const role = effectiveRole(sp)
  const hasSides = all.some((s) => ['side-left', 'side-right'].includes(effectiveRole(s)))
  const angle = idealAngle(role, hasSides)
  if (angle === null) return null
  const d = distance(sp, listener)
  const r = d >= MIN_R ? d : sp.elevated ? HEIGHT_R : FLOOR_R
  return clampToRoom(polarToPoint(listener, angle, r), room)
}

/** Üç ya da daha çok noktaya en küçük kareler çemberi (Kåsa); merkez. Noktalar neredeyse bir doğrudaysa null. */
function circleCentre(ps: readonly Point[]): Point | null {
  const n = ps.length
  const mx = ps.reduce((a, p) => a + p.x, 0) / n
  const my = ps.reduce((a, p) => a + p.y, 0) / n
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0
  for (const p of ps) {
    const u = p.x - mx
    const v = p.y - my
    suu += u * u; svv += v * v; suv += u * v
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-6 * Math.max(1e-9, suu * svv)) return null
  const bu = (suuu + suvv) / 2
  const bv = (svvv + svuu) / 2
  return { x: mx + (bu * svv - bv * suv) / det, y: my + (bv * suu - bu * suv) / det }
}

const FRONT_ROLES = new Set(['left', 'right', 'center', 'wide-left', 'wide-right'])

/** L→R çiftini ±30° gören nokta (eşkenar üçgen, çiftin arkasında). */
function stereoPoint(l: Point, r: Point): Point {
  const mid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 }
  const w = distance(l, r)
  // L→R yönüne dik, "arkaya" bakan birim vektör (ön yukarıdaysa +y).
  const nx = -(r.y - l.y) / w
  const ny = (r.x - l.x) / w
  const h = w * Math.cos(Math.PI / 6)
  return { x: mid.x + nx * h, y: mid.y + ny * h }
}

/**
 * Dinleyicinin olması gereken yeri: zemin hoparlörlerinin ortası, yani hepsine eşit uzaklıktaki nokta (çember merkezi).
 * Hoparlörlerin hepsi öndeyse (ör. yalnız sol/sağ/orta) ortası tanımsızdır: ön çifti ±30° gören noktaya gider. Bunlar
 * kurulamıyorsa ağırlık merkezi. Oda içine kırpılır.
 */
export function idealListenerPoint(all: readonly Sp[], room: Pick<Room, 'widthM' | 'depthM'>): Point | null {
  const floor = all.filter((s) => !s.elevated && effectiveRole(s) !== ROLE_SUB)
  if (floor.length === 0) return null
  const l = floor.find((s) => effectiveRole(s) === 'left')
  const r = floor.find((s) => effectiveRole(s) === 'right')
  const pair = l && r && distance(l, r) > 0.05 ? stereoPoint(l, r) : null
  const surrounds = floor.some((s) => !FRONT_ROLES.has(effectiveRole(s)))
  if (floor.length >= 3 && (surrounds || !pair)) {
    const c = circleCentre(floor)
    const diag = Math.hypot(room.widthM, room.depthM)
    if (c && floor.every((s) => distance(s, c) < diag)) return clampToRoom(c, room)
  }
  if (pair) return clampToRoom(pair, room)
  const n = floor.length
  return clampToRoom({ x: floor.reduce((a, s) => a + s.x, 0) / n, y: floor.reduce((a, s) => a + s.y, 0) / n }, room)
}
