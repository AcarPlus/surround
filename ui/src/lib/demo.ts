import type { Speaker } from '../api/types'
import { angleFromListener, normalizeAngle } from './roles'

/**
 * Ses turu sahneleri. Yörünge formülleri motordaki `DemoPlayer.Azimuth` ile birebir aynıdır (src/Surround.Engine/Dsp/
 * DemoPlayer.cs); biri değişirse öbürü de değişmeli (DemoPlayerTests ve demo.test.ts aynı noktaları sınar).
 */
export type DemoSceneId = 'orbit' | 'pingpong' | 'flyby' | 'speakers'

export interface DemoScene {
  id: DemoSceneId
  title: string
  sub: string
  /** Saniye. */
  duration: number
  /** Nota/vuruş aralığı (sn): animasyondaki dalgalar için. */
  beat: number
}

export const DEMO_SCENES: readonly DemoScene[] = [
  { id: 'orbit', title: 'Tur', sub: 'Bir melodi etrafında döner', duration: 20, beat: 0.25 },
  { id: 'pingpong', title: 'Sol ↔ Sağ', sub: 'Marimba arpeji bir yandan öbürüne sekip tırmanır, iner', duration: 15, beat: 0.375 },
  { id: 'flyby', title: 'Uçuş', sub: 'Yanından geçerken pesleşen (Doppler) bir uçuş sesi', duration: 16, beat: 8 },
  { id: 'speakers', title: 'Kanal kanal', sub: 'Her yönden üç notalık çan arpeji: FL, FC, FR, SR, BR, BL, SL', duration: 8.4, beat: 1.2 },
]

const SPEAKER_STEPS = [-30, 0, 30, 90, 150, -150, -90] as const
export const SPEAKER_STEP_LABELS = ['FL', 'FC', 'FR', 'SR', 'BR', 'BL', 'SL'] as const

/** Sahnenin t saniyedeki yönü (derece; 0 = ön, + = sağ). */
export function demoAzimuth(id: DemoSceneId, t: number): number {
  switch (id) {
    case 'orbit':
      return normalizeAngle(36 * t)
    case 'pingpong':
      return -90 * Math.cos((Math.PI * t) / 1.5)
    case 'flyby': {
      const u = (t % 8) / 8
      const e = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, u * 1.25))
      return t < 8 ? 180 * e : normalizeAngle(180 + 180 * e)
    }
    case 'speakers':
      return SPEAKER_STEPS[Math.min(6, Math.floor(t / 1.2))]
  }
}

/** Animasyon için kaynağın parlaklığı (0..1): nota/vuruş zarfı. */
export function demoPulse(id: DemoSceneId, t: number): number {
  switch (id) {
    case 'orbit':
      return Math.exp(-((t % 0.25) * 5))
    case 'pingpong':
      return Math.exp(-((t % 0.375) * 7))
    case 'flyby':
      return Math.sin(Math.PI * Math.min(1, ((t % 8) / 8) * 1.25)) ** 2
    case 'speakers':
      return Math.max(Math.exp(-((t % 1.2) * 3.2)), 0.7 * Math.exp(-(((t % 1.2) - 0.18 + 1.2) % 1.2 * 3.2)), 0.5 * Math.exp(-(((t % 1.2) - 0.36 + 1.2) % 1.2 * 3.2)))
  }
}

/**
 * Sesin kulağa ulaşma gecikmesi (ms, yaklaşık): animasyon bu kadar geride oynatılır ki gördüğün ile duyduğun aynı anda
 * olsun. En büyük tampon + en büyük hoparlör gecikmesi (Bluetooth telafisi dahil) + yakalama/çıkış payı.
 */
export function demoLatencyMs(speakers: readonly Speaker[], bufferMs: readonly number[]): number {
  const buf = bufferMs.length ? Math.max(...bufferMs) : 40
  const delay = speakers.length ? Math.max(...speakers.map((s) => s.delayMs)) : 0
  return buf + delay + 60
}

/** Arkada (|açı| > 100°) hoparlör yoksa: arka yöndeki ses öne katlanır, kullanıcıya söylenir. */
export function hasRearCoverage(speakers: readonly Speaker[], listener: { x: number; y: number }): boolean {
  return speakers.some((s) => !s.mute && Math.abs(angleFromListener(s, listener)) > 100)
}
