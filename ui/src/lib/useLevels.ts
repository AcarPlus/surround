import { useEffect, useState, type RefObject } from 'react'
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

/** `--energy` için yazılan değer: iki basamak (görünür fark yok, aynı değer yeniden yazılmaz). */
export function energyVar(frame: LevelFrame | null): string {
  return frameEnergy(frame).toFixed(2)
}

/**
 * Sesin genel enerjisini (`--energy`, 0..1) verilen öğeye CSS değişkeni olarak yazar; React çizimi olmadan. Seviyeler
 * saniyede 20 kez gelir: değer uygulamanın kökünde React durumu olarak tutulunca bütün ağaç her seferinde yeniden
 * çiziliyordu. `mountKey` öğenin yeniden kurulduğunu bildirir (ör. açılış ekranından ana görünüme geçiş).
 */
export function useEnergyVar(ref: RefObject<HTMLElement>, active: boolean, mountKey?: unknown) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let last = ''
    const write = (v: string) => {
      if (v === last) return
      last = v
      el.style.setProperty('--energy', v)
    }
    write(energyVar(null))
    if (!active) return
    const off = api.onLevels((f) => write(energyVar(f)))
    return () => {
      off()
      write(energyVar(null))
    }
  }, [ref, active, mountKey])
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
