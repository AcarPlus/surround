import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { LevelFrame, LogicalChannel, Speaker } from '../api/types'
import { primaryChannel } from './geometry'

/** Motorun canlı kanal seviyeleri (dBFS); `active` değilken null. */
export function useLevels(active: boolean): LevelFrame | null {
  const [frame, setFrame] = useState<LevelFrame | null>(null)
  useEffect(() => {
    if (!active) {
      setFrame(null)
      return
    }
    return api.onLevels(setFrame)
  }, [active])
  return frame
}

/** Gösterge aralığı: −54 dBFS sessiz, 0 dBFS dolu. */
const FLOOR_DB = -54

/** dBFS → 0..1 (gösterge doluluğu). */
export function levelToUnit(db: number | undefined): number {
  if (db === undefined || !Number.isFinite(db)) return 0
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB))
}

/** Bir hoparlörün çaldığı en baskın kanalın seviyesi (0..1); susturulmuşsa 0. */
export function speakerLevel(sp: Pick<Speaker, 'source' | 'mute'>, frame: LevelFrame | null): number {
  if (!frame || sp.mute) return 0
  const ch: LogicalChannel | null = primaryChannel(sp.source)
  return ch ? levelToUnit(frame[ch]) : 0
}

/** Tüm kanalların genel enerjisi (0..1): en güçlü kanal ağırlıklı; arayüzün sese "nefes alması" için. */
export function frameEnergy(frame: LevelFrame | null): number {
  if (!frame) return 0
  let max = 0
  let sum = 0
  let n = 0
  for (const v of Object.values(frame)) {
    const u = levelToUnit(v)
    if (u > max) max = u
    sum += u
    n++
  }
  return n ? Math.min(1, max * 0.7 + (sum / n) * 0.6) : 0
}
