import type { LogicalChannel, Point, Speaker } from '../api/types'
import { FLOOR_NOMINAL, HEIGHT_NOMINAL, ROLE_SUB, angleFromListener, effectiveRole, normalizeAngle } from './roles'
import { distance } from './geometry'

/**
 * "Konuma göre dağıt" (kanaldan hoparlöre, sanal hoparlör): her içerik kanalı kendi standart açısında (FL −30°, SR 90°
 * …) çalınır; o açıya en yakın iki GERÇEK hoparlör arasında sabit güçle (sin/cos) paylaştırılır. Örnek: orta 0°, sağ
 * 60° → ön sağ (30°) ikisinden eşit güçle (0,707 + 0,707) çalar ve 30°'den duyulur; yan/arka sağ 60°'nin ötesinde
 * hoparlör olmadığından tamamen sağdakine gider.
 *
 * Neden hoparlörden kanala değil ("Özel (haritadan)" rolü): orada her hoparlör kendi açısına göre kanalları örnekler;
 * bir kanal iki hoparlörden fazla, başka biri hiç çıkmayabilir ve seviye korunmaz. Burada her kanalın güç toplamı 1'dir.
 *
 * Sınırlar: iki komşu hoparlör arası MAX_PAIR_SPAN'dan genişse (ör. önde iki hoparlör, arkası boş) aradan hayali ses
 * kurulmaz (arkadaki ses öndeki iki hoparlör arasında "öne" gelirdi): kanal yakın olana gider. Subwoofer'lar ve
 * sessize alınmış hoparlörler katılmaz (sub kendi satırını korur). Üst hoparlörler kendi halkasında aynı şekilde.
 * Motor değişmez: sonuç hoparlör başına karışım satırı olarak gider.
 */
export const MAX_PAIR_SPAN = 120
/** Bu kadar yakın açılar aynı yön sayılır (aynı yöndeki hoparlörler kanalı güçte eşit paylaşır). */
const SAME_DIR = 1
/** Dinleyicinin üstündeki hoparlörün yönü anlamsız: katılmaz. */
const MIN_DISTANCE_M = 0.05

type Sp = Pick<Speaker, 'id' | 'x' | 'y' | 'mute' | 'elevated' | 'role' | 'source'>
export type Row = Partial<Record<LogicalChannel, number>>

const r3 = (v: number) => Math.round(v * 1000) / 1000

/** Saat yönünde a'dan b'ye açı (0..360). */
const cw = (a: number, b: number) => {
  const d = (b - a) % 360
  return d < 0 ? d + 360 : d
}

interface Dir {
  deg: number
  ids: string[]
}

function ringRows(
  dirs: Dir[],
  nominal: readonly { ch: LogicalChannel; deg: number }[],
  rows: Map<string, Row>,
): void {
  if (dirs.length === 0) return
  const add = (d: Dir, ch: LogicalChannel, g: number) => {
    // Aynı yöndeki n hoparlör: her biri g/√n (güç korunur).
    const share = g / Math.sqrt(d.ids.length)
    for (const id of d.ids) {
      const row = rows.get(id)!
      const v = r3((row[ch] ?? 0) + share)
      if (v > 0) row[ch] = v
    }
  }
  for (const { ch, deg } of nominal) {
    if (dirs.length === 1) {
      add(dirs[0], ch, 1)
      continue
    }
    // θ'yı saat yönünde izleyen en yakın hoparlör (b) ve saat yönünün tersinde en yakın (a).
    const b = dirs.reduce((p, d) => (cw(deg, d.deg) < cw(deg, p.deg) ? d : p))
    const a = dirs.reduce((p, d) => (cw(d.deg, deg) < cw(p.deg, deg) ? d : p))
    if (Math.abs(normalizeAngle(b.deg - deg)) < SAME_DIR) {
      add(b, ch, 1)
      continue
    }
    if (Math.abs(normalizeAngle(a.deg - deg)) < SAME_DIR) {
      add(a, ch, 1)
      continue
    }
    const span = cw(a.deg, b.deg)
    const off = cw(a.deg, deg)
    if (span > MAX_PAIR_SPAN) {
      add(off <= span - off ? a : b, ch, 1)
      continue
    }
    const t = off / span
    add(a, ch, Math.cos((t * Math.PI) / 2))
    add(b, ch, Math.sin((t * Math.PI) / 2))
  }
}

/** Halkadaki hoparlörleri açıya göre sıralar; aynı yöndekileri birleştirir. */
function directions(list: Sp[], listener: Point): Dir[] {
  const sorted = list
    .map((s) => ({ id: s.id, deg: angleFromListener(s, listener) }))
    .sort((p, q) => p.deg - q.deg)
  const out: Dir[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(normalizeAngle(s.deg - last.deg)) < SAME_DIR) last.ids.push(s.id)
    else out.push({ deg: s.deg, ids: [s.id] })
  }
  // Halka kapanışı: ilk ve son aynı yöndeyse (−180/180) birleştir.
  if (out.length > 1 && Math.abs(normalizeAngle(out[0].deg - out[out.length - 1].deg)) < SAME_DIR) {
    out[0].ids.push(...out.pop()!.ids)
  }
  return out
}

/**
 * Konuma göre dağıtımda her katılan hoparlörün karışım satırı. Katılmayanlar (sub, sessiz, dinleyicinin üstünde)
 * listede yoktur: onlar kendi satırlarını korur.
 */
export function positionalRows(speakers: readonly Sp[], listener: Point): Map<string, Row> {
  const eligible = speakers.filter(
    (s) => !s.mute && effectiveRole(s) !== ROLE_SUB && distance(s, listener) >= MIN_DISTANCE_M,
  )
  const rows = new Map<string, Row>(eligible.map((s) => [s.id, {}]))
  ringRows(directions(eligible.filter((s) => !s.elevated), listener), FLOOR_NOMINAL, rows)
  ringRows(directions(eligible.filter((s) => s.elevated), listener), HEIGHT_NOMINAL, rows)
  return rows
}
