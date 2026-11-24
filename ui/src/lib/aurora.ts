import type { CalibrationProgress } from '../api/types'

/**
 * Aurora temasının hareket dili için küçük, saf yardımcılar: sıralı giriş gecikmesi, çizilen halka, ölçüm radarının
 * durumu, tamamlanma parçacıkları. Bileşenler (components/aurora.tsx) bunları kullanır; testler buradan sınar.
 */

/** Sıralı girişte iki öğe arası (ms). */
export const STAGGER_MS = 60
/** Bu kadar öğeden sonrası beklemeden gelir (uzun listede son öğe geç kalmasın). */
export const STAGGER_MAX = 8

/** i. öğenin giriş gecikmesi (ms). */
export function staggerDelay(i: number, step = STAGGER_MS, max = STAGGER_MAX): number {
  return Math.max(0, Math.min(Math.floor(i), max)) * step
}

/** 0..1 ilerlemenin `pathLength="1"` halkadaki stroke-dashoffset'i (1 = boş, 0 = dolu). */
export function ringOffset(fraction: number): number {
  if (!Number.isFinite(fraction)) return 1
  return 1 - Math.max(0, Math.min(1, fraction))
}

/** Halkanın ucundaki ışığın konumu: üstten (saat 12) saat yönünde `fraction` kadar. */
export function ringPoint(fraction: number, r: number, cx: number, cy: number): { x: number; y: number } {
  const a = Math.max(0, Math.min(1, fraction)) * Math.PI * 2
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
}

/** Dinleyiciden açı (derece; 0 = ön/yukarı, + = sağ) → radarda nokta. */
export function polarPoint(deg: number, r: number, cx: number, cy: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
}

export type RadarState = 'pending' | 'active' | 'analyzing' | 'done'

/**
 * Ölçüm sırasında her hoparlörün durumu. `ids` ölçüm isteğindeki sıra (motor bu sırayla ölçer); ilerleme `index`i
 * ölçümde 1 tabanlıdır, çözümlemede 1'den yeniden sayar.
 */
export function radarStates(ids: readonly string[], p: CalibrationProgress | null): Record<string, RadarState> {
  const out: Record<string, RadarState> = {}
  for (const id of ids) out[id] = 'pending'
  if (!p) return out
  switch (p.phase) {
    case 'measuring': {
      const cur = p.speakerId ? ids.indexOf(p.speakerId) : p.index - 1
      ids.forEach((id, i) => {
        if (i < cur) out[id] = 'done'
        else if (i === cur) out[id] = 'active'
      })
      return out
    }
    case 'analyzing': {
      const cur = p.speakerId ? ids.indexOf(p.speakerId) : p.index - 1
      ids.forEach((id, i) => {
        out[id] = i === cur ? 'analyzing' : 'done'
      })
      return out
    }
    case 'done':
      for (const id of ids) out[id] = 'done'
      return out
    default:
      return out
  }
}

export type StepState = 'done' | 'current' | 'todo'

/**
 * Çok konumlu ölçümde adımlar: `done` tamamlanan konum sayısı; `active` şu an bir konum ölçülüyorsa (o adım "current"),
 * değilse sıradaki adım "current" (bekleyen) olur. Hepsi bittiyse current yoktur.
 */
export function stepStates(total: number, done: number): StepState[] {
  const n = Math.max(0, Math.floor(total))
  const d = Math.max(0, Math.min(n, Math.floor(done)))
  return Array.from({ length: n }, (_, i) => (i < d ? 'done' : i === d ? 'current' : 'todo'))
}

export interface BurstParticle {
  /** Uçuş açısı (derece). */
  angle: number
  /** Uçuş mesafesi (px). */
  distance: number
  /** Çap (px). */
  size: number
  /** 1..3: --aurora-N rengi. */
  hue: 1 | 2 | 3
  /** Gecikme (ms). */
  delay: number
}

/** Tamamlanma patlamasının parçacıkları: tohumlu, her çizimde aynı (titreme yok, test edilebilir). */
export function burstParticles(count: number, radius = 90, seed = 7): BurstParticle[] {
  const n = Math.max(0, Math.floor(count))
  const rnd = (i: number, k: number) => {
    const v = Math.sin((i + 1) * 12.9898 + (k + seed) * 78.233) * 43758.5453
    return v - Math.floor(v)
  }
  return Array.from({ length: n }, (_, i) => ({
    angle: (360 / Math.max(1, n)) * i + (rnd(i, 1) - 0.5) * 18,
    distance: radius * (0.55 + 0.45 * rnd(i, 2)),
    size: 3 + Math.round(rnd(i, 3) * 4),
    hue: ((i % 3) + 1) as 1 | 2 | 3,
    delay: Math.round(rnd(i, 4) * 120),
  }))
}

/** Tarayıcı "hareketi azalt" diyor mu (Windows: Animasyon efektleri kapalı). Tarayıcı dışında (test) false. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** "r g b" üçlüsünü sayılara çevirir (CSS değişkeninden okunan belirteç). Bozuksa null. */
export function parseRgb(tok: string): [number, number, number] | null {
  const m = tok.trim().split(/[\s,]+/).map(Number)
  if (m.length < 3 || m.slice(0, 3).some((v) => !Number.isFinite(v))) return null
  return [m[0], m[1], m[2]]
}

/**
 * Aurora renk döngüsü: t (0..1, döngüsel) boyunca 1 → 2 → 3 → 1 renkleri arasında yumuşak geçiş. Tuval çizimi CSS
 * değişkeni çözemediği için renkler önceden okunur. Sonuç "r g b" (rgb(... / a) içinde kullanılır).
 */
export function auroraMix(t: number, stops: readonly (readonly [number, number, number])[]): string {
  if (stops.length === 0) return '255 255 255'
  const n = stops.length
  const u = (((t % 1) + 1) % 1) * n
  const i = Math.floor(u) % n
  const k = u - Math.floor(u)
  const s = 0.5 - 0.5 * Math.cos(Math.PI * k)
  const a = stops[i]
  const b = stops[(i + 1) % n]
  return [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * s)).join(' ')
}

/** Hoparlörden ses dalgası halkası çıkma aralığı (ms): seviye yükseldikçe sıklaşır; çok sessizse hiç çıkmaz. */
export function waveInterval(level: number): number | null {
  if (!(level > 0.08)) return null
  return Math.round(950 - 650 * Math.min(1, level))
}
