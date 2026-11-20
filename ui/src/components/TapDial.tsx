import { useRef } from 'react'
import { angleToUnit, describeAngle, pointerToAngle, snapAngle } from '../lib/tapPlace'
import { normalizeAngle } from '../lib/roles'
import { cx } from './ui'

export interface TapDialMark {
  /** Derece; 0 = ön, + = sağ. */
  angle: number
  label?: string
}

export interface TapDialProps {
  /** Seçili yön (derece; 0 = ön, + = sağ). Seçim yoksa null. */
  value: number | null
  /** Dokunma / sürükleme / ok tuşuyla yeni yön (standart açılara yapışmış). */
  onChange: (angleDeg: number) => void
  /** Enter ile onay (isteğe bağlı). */
  onConfirm?: () => void
  /** Önceden yerleştirilmiş hoparlörler (küçük noktalar). */
  marks?: TapDialMark[]
  /** Piksel cinsinden kenar uzunluğu (varsayılan 280; küçük ekranda genişliğe sığar). */
  size?: number
  disabled?: boolean
  /** Erişilebilirlik adı. */
  label?: string
}

/**
 * Oda kadranı: yukarıdan görünüm, dinleyici ortada, ön yukarıda. Fare ya da dokunuşla "ses nereden geliyor?"
 * işaretlenir; klavyede ← → (5°, Shift ile 15°) işareti döndürür, Home öne alır, Enter onaylar.
 * Yalnızca yön verir (yarıçap yoktur); konuma çevirmek için `lib/tapPlace.ts`.
 */
export function TapDial({ value, onChange, onConfirm, marks = [], size = 280, disabled, label = 'Ses yönü' }: TapDialProps) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    // Tam ortaya (dinleyicinin üstüne) dokunmak yön belirtmez.
    if (Math.hypot(dx, dy) < r.width * 0.07) return
    onChange(snapAngle(pointerToAngle(dx, dy)))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    const step = e.shiftKey ? 15 : 5
    const cur = value ?? 0
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange(normalizeAngle(cur + step))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange(normalizeAngle(cur - step))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange(0)
    } else if (e.key === 'Enter' && value !== null) {
      e.preventDefault()
      onConfirm?.()
    }
  }

  // viewBox -100..100; dinleyici (0,0); yarıçap 74 = hoparlör halkası.
  const R = 74
  const pos = (a: number, r = R) => {
    const u = angleToUnit(a)
    return { x: u.x * r, y: u.y * r }
  }
  const sel = value !== null ? pos(value) : null

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={-180}
      aria-valuemax={180}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? 'Seçilmedi' : describeAngle(value)}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (disabled) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        fromEvent(e)
      }}
      onPointerMove={(e) => {
        if (dragging.current && !disabled) fromEvent(e)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
      style={{ width: size, maxWidth: '100%', aspectRatio: '1', touchAction: 'none' }}
      className={cx(
        'relative mx-auto select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled ? 'cursor-default opacity-50' : 'cursor-pointer',
      )}
    >
      <svg viewBox="-100 -100 200 200" className="h-full w-full" aria-hidden>
        <circle r="96" className="fill-surface stroke-line-strong" strokeWidth="1" />
        <circle r={R} fill="none" className="stroke-line" strokeWidth="1" strokeDasharray="3 4" />
        <circle r={R / 2} fill="none" className="stroke-line" strokeWidth="1" strokeDasharray="2 5" />
        {/* Yönler: ön yukarıda */}
        <line x1="0" y1="-96" x2="0" y2="96" className="stroke-line" strokeWidth="0.6" />
        <line x1="-96" y1="0" x2="96" y2="0" className="stroke-line" strokeWidth="0.6" />
        <text y="-84" textAnchor="middle" className="fill-faint" fontSize="8" fontWeight="600">
          ÖN (EKRAN)
        </text>
        <text y="92" textAnchor="middle" className="fill-faint" fontSize="8" fontWeight="600">
          ARKA
        </text>
        <text x="-90" y="3" textAnchor="middle" className="fill-faint" fontSize="8" fontWeight="600">
          SOL
        </text>
        <text x="90" y="3" textAnchor="middle" className="fill-faint" fontSize="8" fontWeight="600">
          SAĞ
        </text>

        {marks.map((m, i) => {
          const p = pos(m.angle)
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="4" className="fill-muted" opacity="0.7" />
              {m.label && (
                <text x={p.x} y={p.y - 7} textAnchor="middle" className="fill-faint" fontSize="6">
                  {m.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Dinleyici */}
        <circle r="7" className="fill-accent" opacity="0.25" />
        <circle r="3.2" className="fill-accent" />

        {sel && (
          <g>
            <line x1="0" y1="0" x2={sel.x} y2={sel.y} className="stroke-accent" strokeWidth="1.2" strokeDasharray="2 3" />
            <circle cx={sel.x} cy={sel.y} r="11" className="fill-accent" opacity="0.2" />
            <circle cx={sel.x} cy={sel.y} r="6.5" className="fill-accent stroke-bg" strokeWidth="1.5" />
          </g>
        )}
      </svg>
    </div>
  )
}
