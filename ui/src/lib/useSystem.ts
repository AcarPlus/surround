import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { UpdateState, VolumeState } from '../api/types'

/** Ana ses düzeyi (Windows kaydırıcısıyla eş); yüklenene kadar null. */
export function useVolume(): VolumeState | null {
  const [v, setV] = useState<VolumeState | null>(null)
  useEffect(() => {
    let alive = true
    const off = api.onVolume((x) => alive && setV(x))
    api.getVolume().then(
      (x) => alive && setV(x),
      () => alive && setV({ available: false, level: 1, muted: false, db: 0 }),
    )
    return () => {
      alive = false
      off()
    }
  }, [])
  return v
}

/** Otomatik güncellemenin durumu; yüklenene kadar null. */
export function useUpdate(): UpdateState | null {
  const [u, setU] = useState<UpdateState | null>(null)
  useEffect(() => {
    let alive = true
    const off = api.onUpdate((x) => alive && setU(x))
    api.getUpdate().then(
      (x) => alive && setU(x),
      () => alive && setU({ state: 'unsupported', current: '', progress: 0 }),
    )
    return () => {
      alive = false
      off()
    }
  }, [])
  return u
}
