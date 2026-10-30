import type { LogicalChannel, Point, Room, Speaker } from '../api/types'

export const SPEED_OF_SOUND = 343 // m/s

export type PresetId = '2.0' | '5.1' | '7.1'

export interface PresetSlot {
  channel: LogicalChannel
  /** Ön eksenden saat yönünde derece (negatif = sol). */
  angle: number
  /** Yarıçap çarpanı (1 = preset yarıçapı). */
  radiusScale?: number
}

/** ITU-R BS.775 tarzı yerleşimler. 0° = ön (planda yukarı). */
export const PRESET_SLOTS: Record<PresetId, PresetSlot[]> = {
  '2.0': [
    { channel: 'FL', angle: -30 },
    { channel: 'FR', angle: 30 },
  ],
  '5.1': [
    { channel: 'FL', angle: -30 },
    { channel: 'FR', angle: 30 },
    { channel: 'FC', angle: 0 },
    { channel: 'LFE', angle: 15 },
    { channel: 'BL', angle: -110 },
    { channel: 'BR', angle: 110 },
  ],
  '7.1': [
    { channel: 'FL', angle: -30 },
    { channel: 'FR', angle: 30 },
    { channel: 'FC', angle: 0 },
    { channel: 'LFE', angle: 15 },
    { channel: 'SL', angle: -90 },
    { channel: 'SR', angle: 90 },
    { channel: 'BL', angle: -150 },
    { channel: 'BR', angle: 150 },
  ],
}

export const DEFAULT_PRESET_RADIUS_M = 2

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Dinleyiciye en uzak hoparlörün mesafesi (hoparlör yoksa 0). */
export function maxDistance(points: Point[], listener: Point): number {
  let m = 0
  for (const p of points) m = Math.max(m, distance(p, listener))
  return m
}

/** Yakın hoparlörü geciktirerek en uzakla hizalar: (dMax − d) / c, ms. */
export function autoDelayMs(d: number, dMax: number): number {
  return Math.max(0, ((dMax - d) / SPEED_OF_SOUND) * 1000)
}

/** Yakın hoparlörü kısarak seviyeyi eşitler: 20·log10(d / dMax), dB (≤ 0). */
export function autoGainDb(d: number, dMax: number): number {
  if (d <= 0 || dMax <= 0) return 0
  return Math.min(0, 20 * Math.log10(d / dMax))
}

/** Dinleyiciye göre açı/yarıçaptan oda koordinatı (y aşağı, ön = yukarı). */
export function polarToPoint(listener: Point, angleDeg: number, radius: number): Point {
  const a = (angleDeg * Math.PI) / 180
  return { x: listener.x + radius * Math.sin(a), y: listener.y - radius * Math.cos(a) }
}

export function presetLayout(
  preset: PresetId,
  listener: Point,
  radius: number = DEFAULT_PRESET_RADIUS_M,
): { channel: LogicalChannel; x: number; y: number }[] {
  return PRESET_SLOTS[preset].map((s) => {
    const p = polarToPoint(listener, s.angle, radius * (s.radiusScale ?? 1))
    return { channel: s.channel, x: p.x, y: p.y }
  })
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function clampToRoom(p: Point, room: Pick<Room, 'widthM' | 'depthM'>): Point {
  return { x: clamp(p.x, 0, room.widthM), y: clamp(p.y, 0, room.depthM) }
}

export function round(v: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

export interface AutoValues {
  distance: number
  delayMs: number
  gainDb: number
}

/** Her hoparlör için mesafe + otomatik gecikme/kazanç (ham, yuvarlanmamış). */
export function computeAuto(
  speakers: Pick<Speaker, 'id' | 'x' | 'y'>[],
  listener: Point,
): { dMax: number; byId: Record<string, AutoValues> } {
  const dMax = maxDistance(speakers, listener)
  const byId: Record<string, AutoValues> = {}
  for (const s of speakers) {
    const d = distance(s, listener)
    byId[s.id] = { distance: d, delayMs: autoDelayMs(d, dMax), gainDb: autoGainDb(d, dMax) }
  }
  return { dMax, byId }
}

/** Hoparlörün ana mantıksal kanalı (en yüksek kazançlı). Boşsa null. */
export function primaryChannel(source: Speaker['source']): LogicalChannel | null {
  let best: LogicalChannel | null = null
  let bestGain = 0
  for (const [ch, g] of Object.entries(source) as [LogicalChannel, number][]) {
    if (g > bestGain) {
      best = ch
      bestGain = g
    }
  }
  return best
}
