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
