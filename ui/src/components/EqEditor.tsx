import { useRef } from 'react'
import { EQ_FREQS, EQ_RANGE_DB } from '../api/types'
import { clamp } from '../lib/geometry'
import { fmtSigned } from '../lib/format'
import { cx } from './ui'

const freqLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz))
const snap = (v: number) => Math.round(v * 2) / 2

/**
 * 10 bantlı grafik EQ (dikey kaydırıcılar, -12..+12 dB).
 * Bir bandı çift tıklamak o bandı sıfırlar. Klavye: ↑/↓ 0,5 dB, PgUp/PgDn 3 dB, Home sıfırlar.
 */
export function EqEditor({
  value,
  onChange,
  compact,
  disabled,
}: {
  value: number[]
  onChange: (next: number[]) => void
  compact?: boolean
  disabled?: boolean
}) {
  const setBand = (i: number, v: number) => {
    const c = clamp(snap(v), -EQ_RANGE_DB, EQ_RANGE_DB)
    if (c === (value[i] ?? 0)) return
    const next = EQ_FREQS.map((_, k) => value[k] ?? 0)
    next[i] = c
    onChange(next)
  }

  return (
    <div className={cx('flex items-stretch', compact ? 'gap-0.5' : 'gap-1.5', disabled && 'pointer-events-none opacity-50')}>
      {!compact && (
        <div className="flex w-9 shrink-0 flex-col justify-between pb-[22px] pt-5 text-right text-[10px] text-faint num">
          <span>+{EQ_RANGE_DB}</span>
          <span>0</span>
          <span>−{EQ_RANGE_DB}</span>
        </div>
      )}
      {EQ_FREQS.map((hz, i) => (
        <Band
          key={hz}
          hz={hz}
          v={value[i] ?? 0}
          compact={compact}
          onChange={(v) => setBand(i, v)}
        />
      ))}
    </div>
  )
}

function Band({ hz, v, compact, onChange }: { hz: number; v: number; compact?: boolean; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const fromPointer = (clientY: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const t = clamp((clientY - r.top) / r.height, 0, 1)
    onChange(EQ_RANGE_DB - t * 2 * EQ_RANGE_DB)
  }
  const pos = ((EQ_RANGE_DB - v) / (2 * EQ_RANGE_DB)) * 100
  const fillTop = Math.min(pos, 50)
  const fillH = Math.abs(pos - 50)

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      {!compact && (
        <span className={cx('num mb-1 h-4 text-[11px]', v === 0 ? 'text-faint' : 'text-fg')}>{v === 0 ? '0' : fmtSigned(v, 1)}</span>
      )}
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={`${freqLabel(hz)} Hz`}
        aria-orientation="vertical"
        aria-valuemin={-EQ_RANGE_DB}
        aria-valuemax={EQ_RANGE_DB}
        aria-valuenow={v}
        aria-valuetext={`${fmtSigned(v, 1)} dB`}
        title={compact ? `${freqLabel(hz)} Hz: ${fmtSigned(v, 1)} dB` : 'Çift tıkla: sıfırla'}
        className={cx(
          'group relative w-full cursor-pointer touch-none select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent',
          compact ? 'h-[84px] max-w-[22px]' : 'h-[176px] max-w-[44px]',
        )}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          fromPointer(e.clientY)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.clientY)
        }}
        onDoubleClick={() => onChange(0)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.5 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.5 : e.key === 'PageUp' ? 3 : e.key === 'PageDown' ? -3 : 0
          if (step) {
            e.preventDefault()
            onChange(v + step)
          } else if (e.key === 'Home') {
            e.preventDefault()
            onChange(0)
          }
        }}
      >
        {/* Orta çizgi ve kenarlar */}
        <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-line-strong" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-muted/50" />
        {/* 0 dB'den değere dolgu */}
        <div
          className="absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-accent"
          style={{ top: `${fillTop}%`, height: `${fillH}%` }}
        />
        <div
          className={cx(
            'absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-fg shadow-[0_0_0_1px_rgb(var(--line-strong))]',
            compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
            'group-focus-visible:bg-accent',
          )}
          style={{ top: `${pos}%` }}
        />
      </div>
      <span className={cx('num mt-1.5 text-faint', compact ? 'text-[9px]' : 'text-[11px]')}>{freqLabel(hz)}</span>
    </div>
  )
}
