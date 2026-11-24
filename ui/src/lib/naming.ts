import type { Point, Speaker } from '../api/types'
import { ROLES, ROLE_SUB, angleFromListener, effectiveRole } from './roles'

/**
 * Konuma göre otomatik hoparlör adı. Ad, hoparlörün dinleyiciden yönünü söyler (0° = ön, + = sağ); üst hoparlöre
 * "Üst " öneki gelir. Yalnız otomatik adlar değişir: kullanıcının yazdığı ad (`customName`) ya da tanınan kalıba
 * uymayan ad (eski yapılandırmalarda elle verilmiş ad) hiç ellenmez. Subwoofer adını korur.
 */

/** Zemin hoparlörü için yön adı. */
export function floorPositionName(angle: number): string {
  const a = Math.abs(angle)
  const side = angle < 0 ? 'sol' : 'sağ'
  if (a <= 10) return 'Orta'
  if (a <= 45) return `Ön ${side}`
  if (a <= 75) return `Geniş ${side}`
  if (a <= 110) return `Yan ${side}`
  if (a <= 165) return `Arka ${side}`
  return 'Arka orta'
}

const lowerFirst = (s: string) => s.charAt(0).toLocaleLowerCase('tr') + s.slice(1)

/** Açı ve yükseklikten ad (numarasız). */
export function positionName(angle: number, elevated: boolean): string {
  const base = floorPositionName(angle)
  return elevated ? `Üst ${lowerFirst(base)}` : base
}

/** Dinleyiciye bundan yakın hoparlörün yönü güvenilmez: adı değişmez. */
export const MIN_NAMING_DISTANCE_M = 0.3

const FLOOR_NAMES = [
  'Orta',
  'Ön sol',
  'Ön sağ',
  'Geniş sol',
  'Geniş sağ',
  'Yan sol',
  'Yan sağ',
  'Arka sol',
  'Arka sağ',
  'Arka orta',
]

/** Uygulamanın kendisinin verdiği adlar (konum adları, rol etiketleri, düzen/sihirbaz varsayılanları). */
const AUTO_BASES = new Set<string>([
  ...FLOOR_NAMES,
  ...FLOOR_NAMES.map((n) => `Üst ${lowerFirst(n)}`),
  ...ROLES.map((r) => r.label),
  'Sub',
  'Hoparlör',
  'Üst hoparlör',
])

/** Ad, otomatik ad kalıbına uyuyor mu: bilinen temel ad + isteğe bağlı " 2" sıra numarası + isteğe bağlı " kopya". */
export function isAutoName(name: string): boolean {
  const m = /^(.*?)(?: \d+)?(?: kopya)*$/.exec(name.trim())
  return !!m && AUTO_BASES.has(m[1])
}

/** Hoparlörün adı uygulamaya mı ait (kullanıcı yazmadı ve kalıba uyuyor). */
export const hasAutoName = (sp: Pick<Speaker, 'name' | 'customName'>): boolean =>
  !sp.customName && isAutoName(sp.name)

/**
 * Otomatik adlı hoparlörleri konumlarına göre yeniden adlandırır. Aynı ada düşenler liste sırasıyla "Orta", "Orta 2",
 * "Orta 3" olur; sabit kalan adlar (elle verilmiş, subwoofer, dinleyiciye çok yakın) atlanır. Adı değişmeyen hoparlör
 * aynı nesne olarak döner; hiçbiri değişmezse aynı dizi döner.
 */
export function applyAutoNames(speakers: Speaker[], listener: Point): Speaker[] {
  const reserved = new Set<string>()
  const bases = new Map<string, string>()
  for (const s of speakers) {
    const movable =
      hasAutoName(s) &&
      effectiveRole(s) !== ROLE_SUB &&
      Math.hypot(s.x - listener.x, s.y - listener.y) >= MIN_NAMING_DISTANCE_M
    if (movable) bases.set(s.id, positionName(angleFromListener(s, listener), !!s.elevated))
    else reserved.add(s.name.trim())
  }
  if (bases.size === 0) return speakers
  const used = new Set(reserved)
  let changed = false
  const out = speakers.map((s) => {
    const base = bases.get(s.id)
    if (!base) return s
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base} ${n}`
    used.add(name)
    if (name === s.name) return s
    changed = true
    return { ...s, name }
  })
  return changed ? out : speakers
}
