import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useStore } from '../store/useStore'
import { useVolume } from '../lib/useSystem'
import { cx } from './ui'
import { IconMute, IconVolume } from './icons'

const WHEEL_STEP = 0.02

/**
 * Ana ses düzeyi. Kaynağın Windows ses düzeyini yazar; ses tuşları ve görev çubuğu da aynı değeri değiştirir ve
 * buraya yansır. Sürüklerken istekler birleştirilir (en fazla biri yolda).
 */
export function VolumeControl() {
  const remote = useVolume()
  const showToast = useStore((s) => s.showToast)
  const [local, setLocal] = useState<number | null>(null)
  const inflight = useRef(false)
  const pending = useRef<number | null>(null)
  const release = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(release.current), [])

  const fail = (e: unknown) => showToast(e instanceof Error ? e.message : 'Ses düzeyi ayarlanamadı.', 4000, { tone: 'error' })

  const send = (level: number) => {
    if (inflight.current) {
      pending.current = level
      return
    }
    inflight.current = true
    api
      .setVolume(level)
      .catch(fail)
      .finally(() => {
        inflight.current = false
        const next = pending.current
        pending.current = null
        if (next !== null) send(next)
      })
  }

  const change = (level: number) => {
    const l = Math.min(1, Math.max(0, Math.round(level * 100) / 100))
    window.clearTimeout(release.current)
    setLocal(l)
    send(l)
    // Bırakınca Windows'tan gelen değere geç (araya giren eski bildirimler kaydırıcıyı zıplatmasın).
    release.current = window.setTimeout(() => setLocal(null), 600)
  }

  if (!remote?.available) return null

  const level = local ?? remote.level
  const pct = Math.round(level * 100)
  const silent = remote.muted || pct === 0
  const label = remote.muted ? 'Sessiz' : `%${pct}`

  return (
    <div
      // Fare tekerleği bütün kutuda çalışır: üst satırın sürükleme alanından çıkar.
      className="app-no-drag flex items-center gap-2"
      title="Ses düzeyi: klavyedeki ses tuşları ve Windows'un ses kaydırıcısı da bunu değiştirir"
      onWheel={(e) => change(level + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP))}
    >
      <button
        onClick={() => void api.setMute(!remote.muted).catch(fail)}
        aria-label={remote.muted ? 'Sesi aç' : 'Sesi kapat'}
        title={remote.muted ? 'Sesi aç' : 'Sesi kapat'}
        className={cx(
          'flex h-8 w-8 items-center justify-center rounded border border-line-strong hover:text-fg',
          silent ? 'text-warn' : 'text-muted',
        )}
      >
        {silent ? <IconMute width={16} height={16} /> : <IconVolume width={16} height={16} />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        aria-label="Ses düzeyi"
        aria-valuetext={label}
        onChange={(e) => change(Number(e.target.value) / 100)}
        style={{ ['--fill' as string]: `${pct}%` }}
        className={cx('!w-28', remote.muted && 'opacity-50')}
      />
      <span className={cx('w-11 text-right text-xs tabular-nums', remote.muted ? 'text-warn' : 'text-muted')}>{label}</span>
    </div>
  )
}
