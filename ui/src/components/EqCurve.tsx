import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import {
  EQ_FREQS,
  EQ_RANGE_DB,
  PEQ_FREQ_MAX,
  PEQ_FREQ_MIN,
  PEQ_GAIN_MAX,
  PEQ_Q_MAX,
  PEQ_Q_MIN,
  PEQ_TYPE_LABELS,
  type PeqBand,
} from '../api/types'
import { BASS_BOOST_HZ, logGrid, processingStages, responseDb, speakerStages, type Biquad } from '../lib/eqCurve'
import { clamp } from '../lib/geometry'
import { fmtSigned } from '../lib/format'
import { cx } from './ui'

/** Gerçek (birleşik) genlik yanıtı: dB — log frekans, 20 Hz–20 kHz. Motorla aynı süzgeç formülleri (lib/eqCurve.ts). */
const MIN_HZ = 20
const MAX_HZ = 20000
const LOG_SPAN = Math.log(MAX_HZ / MIN_HZ)
/** Görüntülenen dB aralığı ±18 (birleşik yanıt ±12'yi aşabilir; sürükleme yine ±12 ile sınırlı). */
const VIEW_DB = 18
const W_FULL = 720
const W_COMPACT = 284
const MARGIN = { l: 34, r: 12, t: 10, b: 22 }
const snap5 = (v: number) => Math.round(v * 2) / 2
const roundQ = (q: number) => Math.round(q * 100) / 100

const FREQ_TICKS = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
const FREQ_TICKS_COMPACT = [100, 1000, 10000]
const DB_TICKS = [-12, -6, 0, 6, 12]
const DB_TICKS_COMPACT = [-12, 0, 12]
const freqLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(Math.round(hz)))
const CURVE_POINTS = logGrid(240)

export interface EqCurveProps {
  eq: number[]
  onEqChange?: (eq: number[]) => void
  peq: PeqBand[]
  onPeqChange?: (peq: PeqBand[]) => void
  /** Yalnızca genel işlemede: bas güçlendirme ve netlik eğriye katılır. */
  bassBoostDb?: number
  clarityDb?: number
  /** Etkin ön kazanç (dB); eğri bu kadar kayar. Hoparlör EQ'sunda 0. */
  preampDb?: number
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  compact?: boolean
  disabled?: boolean
  className?: string
}

export function EqCurve({
  eq,
  onEqChange,
  peq,
  onPeqChange,
  bassBoostDb,
  clarityDb,
  preampDb = 0,
  selectedId,
  onSelect,
  compact,
  disabled,
  className,
}: EqCurveProps) {
  const W = compact ? W_COMPACT : W_FULL
  const H = compact ? 150 : 250
  const plotW = W - MARGIN.l - MARGIN.r
  const plotH = H - MARGIN.t - MARGIN.b
  const svgRef = useRef<SVGSVGElement>(null)
  const [hot, setHot] = useState<string | null>(null)

  const xOf = (f: number) => MARGIN.l + (Math.log(clamp(f, MIN_HZ, MAX_HZ) / MIN_HZ) / LOG_SPAN) * plotW
  const yOf = (db: number) => MARGIN.t + (1 - (clamp(db, -VIEW_DB, VIEW_DB) + VIEW_DB) / (2 * VIEW_DB)) * plotH
  const fOfX = (x: number) => MIN_HZ * Math.exp(clamp((x - MARGIN.l) / plotW, 0, 1) * LOG_SPAN)
  const dbOfY = (y: number) => (1 - clamp((y - MARGIN.t) / plotH, 0, 1)) * 2 * VIEW_DB - VIEW_DB

  const stages: Biquad[] = useMemo(
    () =>
      bassBoostDb !== undefined || clarityDb !== undefined
        ? processingStages({ eq, peq, bassBoostDb: bassBoostDb ?? 0, clarityDb: clarityDb ?? 0 })
        : speakerStages(eq, peq),
    [eq, peq, bassBoostDb, clarityDb],
  )
  const path = useMemo(() => {
    return CURVE_POINTS.map((f, i) => {
      const x = MARGIN.l + (Math.log(f / MIN_HZ) / LOG_SPAN) * plotW
      const db = clamp(responseDb(stages, f) + preampDb, -VIEW_DB, VIEW_DB)
      const y = MARGIN.t + (1 - (db + VIEW_DB) / (2 * VIEW_DB)) * plotH
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(' ')
  }, [stages, preampDb, plotW, plotH])

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height }
  }

  const setBand = (i: number, db: number) => {
    const v = clamp(snap5(db), -EQ_RANGE_DB, EQ_RANGE_DB)
    if (v === (eq[i] ?? 0)) return
    onEqChange?.(EQ_FREQS.map((_, k) => (k === i ? v : (eq[k] ?? 0))))
  }
  const patchPeq = (id: string, patch: Partial<PeqBand>) => {
    onPeqChange?.(peq.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  const zeroY = yOf(0)

  return (
    <div className={cx(disabled && 'pointer-events-none opacity-50', className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full select-none touch-none"
        role="group"
        aria-label="Frekans yanıtı eğrisi"
      >
        {/* Izgara */}
        {(compact ? DB_TICKS_COMPACT : DB_TICKS).map((db) => (
          <g key={db}>
            <line
              x1={MARGIN.l}
              x2={W - MARGIN.r}
              y1={yOf(db)}
              y2={yOf(db)}
              stroke="rgb(var(--line-strong))"
              strokeOpacity={db === 0 ? 0.9 : 0.4}
              strokeDasharray={db === 0 ? undefined : '3 4'}
            />
            <text x={MARGIN.l - 6} y={yOf(db) + 3.5} textAnchor="end" fontSize={10} fill="rgb(var(--faint))">
              {db > 0 ? `+${db}` : db}
            </text>
          </g>
        ))}
        {(compact ? FREQ_TICKS_COMPACT : FREQ_TICKS).map((f) => (
          <g key={f}>
            <line x1={xOf(f)} x2={xOf(f)} y1={MARGIN.t} y2={MARGIN.t + plotH} stroke="rgb(var(--line-strong))" strokeOpacity={0.35} strokeDasharray="3 4" />
            <text x={xOf(f)} y={H - 6} textAnchor="middle" fontSize={10} fill="rgb(var(--faint))">
              {freqLabel(f)}
            </text>
          </g>
        ))}
        {/* 0 dB'den eğriye dolgu */}
        <path d={`${path} L${xOf(MAX_HZ).toFixed(1)} ${zeroY.toFixed(1)} L${xOf(MIN_HZ).toFixed(1)} ${zeroY.toFixed(1)} Z`} fill="rgb(var(--accent))" fillOpacity={0.12} />
        <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} strokeLinejoin="round" />
        {bassBoostDb !== undefined && (bassBoostDb > 0 || (clarityDb ?? 0) > 0) && !compact && (
          <text x={xOf(BASS_BOOST_HZ)} y={MARGIN.t + 10} fontSize={9} fill="rgb(var(--faint))" textAnchor="middle">
            bas + netlik dahil
          </text>
        )}

        {/* 10 bant noktaları (dikey sürükleme) */}
        {onEqChange &&
          EQ_FREQS.map((f, i) => {
            const v = eq[i] ?? 0
            const id = `band-${i}`
            const r = compact ? 5 : 6.5
            return (
              <g key={f}>
                <circle
                  cx={xOf(f)}
                  cy={yOf(v)}
                  r={r}
                  tabIndex={0}
                  role="slider"
                  aria-label={`${freqLabel(f)} Hz bandı`}
                  aria-orientation="vertical"
                  aria-valuemin={-EQ_RANGE_DB}
                  aria-valuemax={EQ_RANGE_DB}
                  aria-valuenow={v}
                  aria-valuetext={`${fmtSigned(v, 1)} dB`}
                  className="cursor-ns-resize fill-[rgb(var(--fg))] stroke-[rgb(var(--surface))] outline-none focus-visible:fill-[rgb(var(--accent))]"
                  strokeWidth={2}
                  onPointerDown={(e: RPointerEvent<SVGCircleElement>) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    setHot(id)
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) setBand(i, dbOfY(toSvg(e).y))
                  }}
                  onPointerUp={() => setHot(null)}
                  onPointerCancel={() => setHot(null)}
                  onFocus={() => setHot(id)}
                  onBlur={() => setHot((h) => (h === id ? null : h))}
                  onDoubleClick={() => setBand(i, 0)}
                  onKeyDown={(e: KeyboardEvent<SVGCircleElement>) => {
                    const step =
                      e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.5 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.5 : e.key === 'PageUp' ? 3 : e.key === 'PageDown' ? -3 : 0
                    if (step) {
                      e.preventDefault()
                      setBand(i, v + step)
                    } else if (e.key === 'Home') {
                      e.preventDefault()
                      setBand(i, 0)
                    }
                  }}
                >
                  <title>{`${freqLabel(f)} Hz: ${fmtSigned(v, 1)} dB (çift tıkla: sıfırla)`}</title>
                </circle>
                {hot === id && <PointLabel x={xOf(f)} y={yOf(v)} text={`${freqLabel(f)} Hz · ${fmtSigned(v, 1)} dB`} plotLeft={MARGIN.l} width={W} />}
              </g>
            )
          })}

        {/* Parametrik bant noktaları (yatay = frekans, dikey = kazanç, tekerlek = Q) */}
        {onPeqChange &&
          peq.map((b) => {
            const id = b.id ?? ''
            const x = xOf(b.freqHz)
            const y = yOf(b.gainDb)
            const selected = selectedId === id
            const on = b.enabled !== false
            return (
              <g key={id} opacity={on ? 1 : 0.45}>
                {b.type === 'peak' && (
                  <path
                    d={`M${(x - 2 * qWidth(b.q)).toFixed(1)} ${zeroY.toFixed(1)} H${(x + 2 * qWidth(b.q)).toFixed(1)}`}
                    stroke="rgb(var(--warn))"
                    strokeOpacity={selected ? 0.8 : 0.35}
                    strokeWidth={2}
                  />
                )}
                <PeqHandle
                  band={b}
                  x={x}
                  y={y}
                  selected={selected}
                  onSelect={() => onSelect?.(id)}
                  onHot={(h) => setHot(h ? `peq-${id}` : null)}
                  onMove={(clientX, clientY) => {
                    const p = toSvg({ clientX, clientY })
                    patchPeq(id, {
                      freqHz: clamp(Math.round(fOfX(p.x)), PEQ_FREQ_MIN, PEQ_FREQ_MAX),
                      gainDb: clamp(snap5(dbOfY(p.y)), -PEQ_GAIN_MAX, PEQ_GAIN_MAX),
                    })
                  }}
                  onGain={(g) => patchPeq(id, { gainDb: clamp(snap5(g), -PEQ_GAIN_MAX, PEQ_GAIN_MAX) })}
                  onFreq={(f) => patchPeq(id, { freqHz: clamp(Math.round(f), PEQ_FREQ_MIN, PEQ_FREQ_MAX) })}
                  onQ={(q) => patchPeq(id, { q: clamp(roundQ(q), PEQ_Q_MIN, PEQ_Q_MAX) })}
                />
                {hot === `peq-${id}` && (
                  <PointLabel
                    x={x}
                    y={y}
                    text={`${PEQ_TYPE_LABELS[b.type]} · ${Math.round(b.freqHz)} Hz · ${fmtSigned(b.gainDb, 1)} dB · Q ${b.q.toFixed(2)}`}
                    plotLeft={MARGIN.l}
                    width={W}
                  />
                )}
              </g>
            )
          })}
      </svg>
    </div>
  )
}

/** Tepe bandının eğri üzerindeki yaklaşık genişliği (yalnızca çizim ipucu): Q büyüdükçe dar. */
const qWidth = (q: number) => 36 / Math.sqrt(Math.max(0.3, q))

function PointLabel({ x, y, text, plotLeft, width }: { x: number; y: number; text: string; plotLeft: number; width: number }) {
  const w = text.length * 5.6 + 12
  const left = clamp(x - w / 2, plotLeft, width - w - 4)
  const top = y < 40 ? y + 12 : y - 28
  return (
    <g pointerEvents="none">
      <rect x={left} y={top} width={w} height={18} rx={4} fill="rgb(var(--raised))" stroke="rgb(var(--line-strong))" />
      <text x={left + w / 2} y={top + 12.5} fontSize={10.5} textAnchor="middle" fill="rgb(var(--fg))">
        {text}
      </text>
    </g>
  )
}

function PeqHandle({
  band,
  x,
  y,
  selected,
  onSelect,
  onHot,
  onMove,
  onGain,
  onFreq,
  onQ,
}: {
  band: PeqBand
  x: number
  y: number
  selected: boolean
  onSelect: () => void
  onHot: (on: boolean) => void
  onMove: (clientX: number, clientY: number) => void
  onGain: (g: number) => void
  onFreq: (f: number) => void
  onQ: (q: number) => void
}) {
  const ref = useRef<SVGGElement>(null)
  // Tekerlek: Q. React'in wheel dinleyicisi pasif olduğundan yerel, pasif olmayan dinleyici gerekir.
  const latest = useRef({ band, onQ })
  latest.current = { band, onQ }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = (e: WheelEvent) => {
      e.preventDefault()
      const { band: b, onQ: set } = latest.current
      set(b.q * Math.exp(-e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  const label = `${PEQ_TYPE_LABELS[band.type]} bandı, ${Math.round(band.freqHz)} Hz`
  const size = 6.5
  return (
    <g
      ref={ref}
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={-PEQ_GAIN_MAX}
      aria-valuemax={PEQ_GAIN_MAX}
      aria-valuenow={band.gainDb}
      aria-valuetext={`${fmtSigned(band.gainDb, 1)} dB, ${Math.round(band.freqHz)} Hz, Q ${band.q.toFixed(2)}`}
      className="cursor-move outline-none [&:focus-visible_rect]:stroke-[rgb(var(--accent))]"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        onSelect()
        onHot(true)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onMove(e.clientX, e.clientY)
      }}
      onPointerUp={() => onHot(false)}
      onPointerCancel={() => onHot(false)}
      onFocus={() => {
        onSelect()
        onHot(true)
      }}
      onBlur={() => onHot(false)}
      onDoubleClick={() => onGain(0)}
      onKeyDown={(e) => {
        const k = e.key
        if (k === 'ArrowUp' || k === 'ArrowDown') {
          e.preventDefault()
          onGain(band.gainDb + (k === 'ArrowUp' ? 0.5 : -0.5))
        } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
          e.preventDefault()
          onFreq(band.freqHz * Math.pow(2, (k === 'ArrowRight' ? 1 : -1) / 12))
        } else if (k === '+' || k === '=' || k === '-') {
          e.preventDefault()
          onQ(band.q * (k === '-' ? 1 / 1.1 : 1.1))
        } else if (k === 'Home') {
          e.preventDefault()
          onGain(0)
        }
      }}
    >
      <title>{`${label}, ${fmtSigned(band.gainDb, 1)} dB, Q ${band.q.toFixed(2)} (sürükle: frekans ve kazanç, tekerlek: Q, çift tıkla: kazancı sıfırla)`}</title>
      <rect
        x={x - size}
        y={y - size}
        width={size * 2}
        height={size * 2}
        rx={2}
        transform={`rotate(45 ${x} ${y})`}
        fill="rgb(var(--warn))"
        stroke={selected ? 'rgb(var(--fg))' : 'rgb(var(--surface))'}
        strokeWidth={2}
      />
    </g>
  )
}
