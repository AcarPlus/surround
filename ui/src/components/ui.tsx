import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { clamp } from '../lib/geometry'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

/* ---------- Düğme ---------- */
type BtnVariant = 'default' | 'primary' | 'ghost' | 'danger'
export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const v: Record<BtnVariant, string> = {
    default: 'bg-raised/70 border-line-strong text-fg hover:border-accent/50 hover:shadow-[0_0_16px_-4px_rgb(var(--accent)/0.45)] backdrop-blur-sm',
    primary: 'btn-aurora font-semibold',
    ghost: 'bg-transparent border-transparent text-muted hover:text-fg hover:bg-raised/70',
    danger: 'bg-transparent border-line-strong text-err hover:border-err hover:bg-err/10 hover:shadow-[0_0_16px_-4px_rgb(var(--err)/0.5)]',
  }
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-[border-color,box-shadow,background-color,color,transform] duration-300 active:scale-[0.97]',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:active:scale-100',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-[13px]',
        v[variant],
        className,
      )}
    />
  )
}

/* ---------- Anahtar (toggle) ---------- */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  small,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
  small?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative shrink-0 rounded-full border transition-[background,border-color,box-shadow] duration-300 disabled:opacity-40',
        small ? 'h-4 w-7' : 'h-5 w-9',
        checked
          ? 'border-transparent bg-[linear-gradient(110deg,rgb(var(--aurora-1)),rgb(var(--aurora-2)))] shadow-[0_0_14px_-2px_rgb(var(--aurora-1)/0.6)]'
          : 'border-line-strong bg-raised',
      )}
    >
      <span
        className={cx(
          'absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-500 ease-[cubic-bezier(.34,1.56,.64,1)]',
          small ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
          checked ? (small ? 'left-[13px] bg-white' : 'left-[18px] bg-white') : 'left-[2px] bg-muted',
        )}
      />
    </button>
  )
}

/* ---------- Segmentli seçici ---------- */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-lg border border-line-strong bg-surface/60 p-0.5 backdrop-blur-sm" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            'rounded-md font-medium transition-all duration-300',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
            value === o.value ? 'chip-aurora border border-transparent text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Sayı alanı (virgül/nokta kabul eder) ---------- */
export function NumberField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  decimals = 2,
  unit,
  disabled,
  className,
  ariaLabel,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  decimals?: number
  unit?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  const fmt = (v: number) => v.toFixed(decimals)
  const [text, setText] = useState(fmt(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(fmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, decimals])

  return (
    <div
      className={cx(
        'flex h-7 items-center rounded-md border border-line-strong bg-surface/70 px-2 transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgb(var(--accent)/0.15)]',
        disabled && 'opacity-50',
        className,
      )}
    >
      <input
        aria-label={ariaLabel}
        className="num min-w-0 flex-1 bg-transparent text-right text-[13px] outline-none disabled:cursor-not-allowed"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onFocus={(e) => {
          setFocused(true)
          e.currentTarget.select()
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseFloat(e.target.value.replace(',', '.'))
          if (Number.isFinite(n)) onChange(clamp(n, min, max))
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const n = clamp(value + (e.key === 'ArrowUp' ? step : -step), min, max)
            onChange(n)
            setText(fmt(n))
          }
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      {unit && <span className="ml-1 text-xs text-faint">{unit}</span>}
    </div>
  )
}

/* ---------- Seçim kutusu ---------- */
export function Select({
  value,
  onChange,
  children,
  disabled,
  className,
  ariaLabel,
}: {
  value: string | number
  onChange: (v: string) => void
  children: ReactNode
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        'h-8 w-full rounded-lg border border-line-strong bg-surface/70 px-2 text-[13px] text-fg outline-none transition-shadow',
        'focus:border-accent focus:shadow-[0_0_0_3px_rgb(var(--accent)/0.15)] disabled:opacity-50',
        className,
      )}
    >
      {children}
    </select>
  )
}

/* ---------- Rozet ---------- */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'warn' | 'ok' | 'err'
  className?: string
}) {
  const t = {
    neutral: 'border-line-strong text-muted',
    accent: 'border-accent/50 text-accent',
    warn: 'border-warn/50 text-warn',
    ok: 'border-ok/50 text-ok',
    err: 'border-err/50 text-err',
  }[tone]
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium leading-4 backdrop-blur-sm',
        t,
        className,
      )}
    >
      {children}
    </span>
  )
}

/* ---------- İpucu ---------- */
export function Tip({ text, children, side = 'bottom' }: { text: string; children: ReactNode; side?: 'bottom' | 'top' }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute left-1/2 z-50 w-max max-w-[240px] -translate-x-1/2 rounded-lg border border-line-strong',
          'bg-raised/95 px-2 py-1 text-xs text-fg opacity-0 shadow-[var(--shadow)] backdrop-blur-md transition-opacity delay-300',
          'group-hover:opacity-100 group-focus-within:opacity-100',
          side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
        )}
      >
        {text}
      </span>
    </span>
  )
}

/* ---------- Yerleşim parçaları ---------- */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('glass-card aurora-in', className)}>{children}</div>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</h3>
      {right}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-xs text-muted">
        {label}
        {hint && <span className="text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export function ScreenHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="aurora-in mb-5 flex items-end justify-between gap-4">
      <div>
        {/* Hareketli aurora zemin üstünde okunsun: zemin renginde yumuşak hale + daha parlak metin. */}
        <h1 className="text-[26px] font-bold tracking-tight [filter:drop-shadow(0_1px_10px_rgb(var(--bg)/0.9))_brightness(1.15)]">
          <span className="aurora-text">{title}</span>
        </h1>
        {sub && (
          <p className="mt-1 max-w-[760px] text-[13.5px] leading-relaxed text-fg/85 [text-shadow:0_1px_2px_rgb(var(--bg)/0.9),0_0_14px_rgb(var(--bg)/0.85)]">
            {sub}
          </p>
        )}
      </div>
      {right}
    </div>
  )
}

/* ---------- Seçim çipi ve büyük kaydırıcı ---------- */
export function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cx(
        'h-8 rounded-full border px-3.5 text-[13px] font-medium transition-all duration-300',
        active
          ? 'chip-aurora'
          : 'border-line-strong bg-raised text-muted hover:border-muted hover:text-fg disabled:hover:border-line-strong disabled:hover:text-muted',
        disabled && !active && 'opacity-50',
        disabled && 'cursor-default',
      )}
    >
      {children}
    </button>
  )
}

export function BigSlider(props: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  display: string
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100
  return (
    <div className={props.disabled ? 'opacity-50' : undefined}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium">{props.label}</span>
        <span className="num text-[13px] text-fg">{props.display}</span>
      </div>
      <input
        type="range"
        className="big-range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <p className="mt-0.5 text-xs text-faint">{props.hint}</p>
    </div>
  )
}
