import { useId } from 'react'
import { burstParticles, polarPoint, ringOffset, ringPoint, type RadarState, type StepState } from '../lib/aurora'
import { cx } from './ui'

/**
 * Aurora temasının ortak parçaları: gök (zemin), çizilerek dolan ilerleme halkası, akan ışıklı adım çizelgesi,
 * tamamlanma parçacıkları ve ölçüm radarı. Hepsi saf (store'a bağlı değil); hareketleri index.css'teki sınıflardan
 * gelir ve prefers-reduced-motion'da durur.
 */

/** Arka planda süzülen yıldızlar: sabit (tekrarlanabilir) konum, boy ve hız. */
const STARS = Array.from({ length: 34 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1
  return { x: r(1) * 100, y: 20 + r(2) * 80, s: 1.2 + r(3) * 2.2, t: 24 + r(4) * 30, dl: r(5) * 40 }
})

/** Uygulamanın zemini: akan aurora perdeleri, ışık telleri, yıldızlar. `live` iken sesle parlar (--energy). */
export function AuroraSky({ live }: { live: boolean }) {
  return (
    <div aria-hidden className={cx('ambient', live && 'ambient-live')}>
      <span className="aurora-band aurora-a" />
      <span className="aurora-band aurora-b" />
      <span className="aurora-band aurora-c" />
      <span className="aurora-rays" />
      {STARS.map((d, i) => (
        <span
          key={i}
          className="dust"
          style={{ left: `${d.x}%`, top: `${d.y}%`, animationDuration: `${d.t}s`, animationDelay: `-${d.dl}s`, width: d.s, height: d.s }}
        />
      ))}
    </div>
  )
}

/** Aurora renkli, çizilerek dolan ilerleme halkası; ucunda parlayan bir ışık. */
export function ProgressRing({
  fraction,
  size = 168,
  stroke = 10,
  label,
  sub,
}: {
  fraction: number
  size?: number
  stroke?: number
  label?: string
  sub?: string
}) {
  const id = useId().replace(/:/g, '')
  const c = size / 2
  const r = c - stroke - 6
  const tip = ringPoint(fraction, r, c, c)
  const shown = fraction > 0.002
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgb(var(--aurora-1))" />
            <stop offset="0.55" stopColor="rgb(var(--aurora-2))" />
            <stop offset="1" stopColor="rgb(var(--aurora-3))" />
          </linearGradient>
          <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth={stroke} opacity={0.7} />
        {/* Parıltı katmanı: aynı yay, bulanık. */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={`url(#ring-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={ringOffset(fraction)}
          transform={`rotate(-90 ${c} ${c})`}
          filter={`url(#glow-${id})`}
          opacity={0.6}
          style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.16,1,.3,1)' }}
        />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={`url(#ring-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={ringOffset(fraction)}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.16,1,.3,1)' }}
        />
        {shown && fraction < 1 && (
          <circle className="comet" cx={tip.x} cy={tip.y} r={stroke * 0.55} fill="rgb(255 255 255)" style={{ filter: 'drop-shadow(0 0 6px rgb(var(--aurora-1)))', transition: 'cx .7s cubic-bezier(.16,1,.3,1), cy .7s cubic-bezier(.16,1,.3,1)' }} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {label && <span className="num text-[30px] font-semibold leading-none tracking-tight">{label}</span>}
        {sub && <span className="mt-1.5 max-w-[70%] text-[11px] text-muted">{sub}</span>}
      </div>
    </div>
  )
}

/** Adım çizelgesi: biten adımlar aurora dolgulu, çalışan adıma ışık akar, sıradakiler soluk. */
export function StepTimeline({ steps, states }: { steps: readonly string[]; states: readonly StepState[] }) {
  return (
    <ol className="flex w-full items-start" aria-label="Ölçüm adımları">
      {steps.map((label, i) => {
        const st = states[i] ?? 'todo'
        return (
          <li key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" aria-current={st === 'current' ? 'step' : undefined} title={label}>
            <div className="flex w-full items-center">
              <span className={cx('h-[2px] flex-1 rounded-full', i === 0 ? 'opacity-0' : st === 'todo' ? 'bg-line' : st === 'current' ? 'flow-light bg-line' : 'bg-[linear-gradient(90deg,rgb(var(--aurora-1)),rgb(var(--aurora-2)))]')} />
              <span
                className={cx(
                  'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-all duration-500',
                  st === 'done' && 'border-transparent bg-[linear-gradient(135deg,rgb(var(--aurora-1)),rgb(var(--aurora-2)))] text-white shadow-[0_0_14px_rgb(var(--aurora-1)/0.55)]',
                  st === 'current' && 'border-accent bg-accent/15 text-accent shadow-[0_0_0_4px_rgb(var(--accent)/0.12),0_0_18px_rgb(var(--accent)/0.45)]',
                  st === 'todo' && 'border-line-strong text-faint',
                )}
              >
                {st === 'done' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path className="draw-in" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  <span className="num">{i + 1}</span>
                )}
                {st === 'current' && <span aria-hidden className="breath absolute -inset-1 rounded-full border border-accent/50" />}
              </span>
              <span className={cx('h-[2px] flex-1 rounded-full', i === steps.length - 1 ? 'opacity-0' : st === 'done' ? 'bg-[linear-gradient(90deg,rgb(var(--aurora-2)),rgb(var(--aurora-1)))]' : 'bg-line')} />
            </div>
            <span className={cx('max-w-full truncate px-1 text-[11px]', st === 'todo' ? 'text-faint' : st === 'current' ? 'font-medium text-fg' : 'text-muted')}>
              Konum {i + 1}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** Tamamlanma patlaması: ortadan aurora renkli parçacıklar saçılır (bir kez). `key` değişince yeniden oynar. */
export function Burst({ count = 22, radius = 110 }: { count?: number; radius?: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0">
      {burstParticles(count, radius).map((p, i) => (
        <span
          key={i}
          className="burst-p"
          style={{
            width: p.size,
            height: p.size,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            background: `rgb(var(--aurora-${p.hue}))`,
            boxShadow: `0 0 10px 1px rgb(var(--aurora-${p.hue}))`,
            animationDelay: `${p.delay}ms`,
            ['--a' as string]: `${p.angle.toFixed(1)}deg`,
            ['--d' as string]: `${p.distance.toFixed(1)}px`,
          }}
        />
      ))}
    </span>
  )
}

export interface RadarSpeaker {
  id: string
  name: string
  /** Dinleyiciden açı (derece; 0 = ön, + = sağ). */
  angle: number
  /** CSS rengi (cihaz rengi). */
  color: string
  state: RadarState
  /** Ölçüm dışı (seçilmedi). */
  skipped?: boolean
}

const R_VIEW = 200

/**
 * Ölçüm radarı: ortada mikrofon, çevresinde hoparlörler gerçek yönlerinde. Ölçülen hoparlörden mikrofona tarama
 * dalgaları gider; ölçülenler aurora halesiyle yanar, sıradakiler soluk bekler.
 */
export function MeasureRadar({ speakers, sweeping = true }: { speakers: readonly RadarSpeaker[]; sweeping?: boolean }) {
  const id = useId().replace(/:/g, '')
  const c = R_VIEW
  const ring = 150
  const active = speakers.find((s) => s.state === 'active')
  return (
    <svg viewBox={`0 0 ${R_VIEW * 2} ${R_VIEW * 2}`} className="h-full w-full" role="img" aria-label="Ölçüm radarı">
      <defs>
        <radialGradient id={`core-${id}`}>
          <stop offset="0" stopColor="rgb(var(--aurora-1))" stopOpacity="0.55" />
          <stop offset="1" stopColor="rgb(var(--aurora-1))" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`sweep-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgb(var(--aurora-2))" stopOpacity="0" />
          <stop offset="1" stopColor="rgb(var(--aurora-1))" stopOpacity="0.32" />
        </linearGradient>
        <linearGradient id={`edge-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--aurora-1))" />
          <stop offset="0.5" stopColor="rgb(var(--aurora-2))" />
          <stop offset="1" stopColor="rgb(var(--aurora-3))" />
        </linearGradient>
      </defs>

      {/* Mesafe halkaları: çizilerek gelir. */}
      {[60, 105, ring, 182].map((r, i) => (
        <circle
          key={r}
          className="draw-in"
          pathLength={1}
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={r === ring ? `url(#edge-${id})` : 'rgb(var(--line-strong))'}
          strokeOpacity={r === ring ? 0.55 : 0.45}
          strokeWidth={r === ring ? 1.5 : 1}
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
      {[0, 90, 180, 270].map((d) => {
        const a = polarPoint(d, 52, c, c)
        const b = polarPoint(d, 190, c, c)
        return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgb(var(--line-strong))" strokeOpacity="0.35" strokeDasharray="2 5" />
      })}
      {(
        [
          [0, 'ÖN'],
          [90, 'SAĞ'],
          [180, 'ARKA'],
          [-90, 'SOL'],
        ] as const
      ).map(([d, t]) => {
        const p = polarPoint(d, 194, c, c)
        return (
          <text key={t} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="8.5" letterSpacing="1.6" fill="rgb(var(--faint))">
            {t}
          </text>
        )
      })}

      {/* Dönen tarama ışığı */}
      {sweeping && (
        <g className="radar-sweep">
          <path d={`M ${c} ${c} L ${c + 182} ${c} A 182 182 0 0 0 ${c + 182 * Math.cos(-0.6)} ${c + 182 * Math.sin(-0.6)} Z`} fill={`url(#sweep-${id})`} />
        </g>
      )}

      {/* Ölçülen hoparlörden mikrofona: akan çizgi ve yayılan dalgalar */}
      {active &&
        (() => {
          const p = polarPoint(active.angle, ring, c, c)
          return (
            <g key={`act-${active.id}`} style={{ color: active.color }}>
              <line className="dash-flow" x1={p.x} y1={p.y} x2={c} y2={c} stroke="currentColor" strokeWidth="2" strokeDasharray="3 7" strokeLinecap="round" opacity="0.85" />
              {[0, 0.53, 1.06].map((dl) => (
                <circle key={dl} className="radar-wave" cx={p.x} cy={p.y} r="6" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ animationDelay: `${dl}s`, ['--wave-r' as string]: '70px' }} />
              ))}
            </g>
          )
        })()}

      {/* Mikrofon */}
      <circle cx={c} cy={c} r="46" fill={`url(#core-${id})`} />
      <circle cx={c} cy={c} r="17" fill="rgb(var(--surface))" stroke={`url(#edge-${id})`} strokeWidth="2" />
      <g transform={`translate(${c - 7} ${c - 9})`} stroke="rgb(var(--fg))" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <rect x="4" y="0" width="6" height="11" rx="3" />
        <path d="M1 8a6 6 0 0 0 12 0M7 14v3" />
      </g>

      {/* Hoparlörler */}
      {speakers.map((s) => {
        const p = polarPoint(s.angle, ring, c, c)
        const on = s.state === 'active'
        const done = s.state === 'done'
        const analyzing = s.state === 'analyzing'
        const dim = s.skipped || s.state === 'pending'
        return (
          <g key={s.id} style={{ color: s.color }} opacity={s.skipped ? 0.3 : 1} data-state={s.state}>
            {(on || done || analyzing) && <circle cx={p.x} cy={p.y} r={on ? 26 : 20} fill="currentColor" opacity={on ? 0.28 : 0.16} style={{ filter: 'blur(6px)' }} />}
            <circle
              cx={p.x}
              cy={p.y}
              r={on ? 15 : 12}
              fill={done ? 'currentColor' : 'rgb(var(--surface))'}
              fillOpacity={done ? 0.9 : 1}
              stroke="currentColor"
              strokeWidth={on ? 2.5 : 1.6}
              strokeOpacity={dim ? 0.45 : 1}
              style={{ transition: 'r .45s cubic-bezier(.34,1.56,.64,1)' }}
            />
            {analyzing && <circle className="breath" cx={p.x} cy={p.y} r="19" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 4" />}
            {done ? (
              <path
                className="draw-in"
                pathLength={1}
                d={`M ${p.x - 5} ${p.y + 0.5} l 3.5 3.5 l 6.5 -7`}
                fill="none"
                stroke="rgb(var(--bg))"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <circle cx={p.x} cy={p.y} r={on ? 4 : 2.5} fill="currentColor" opacity={dim ? 0.5 : 1} />
            )}
            <text x={p.x} y={p.y + (p.y > c ? 30 : -22)} textAnchor="middle" fontSize="10.5" fontWeight={on ? 600 : 500} fill={dim ? 'rgb(var(--faint))' : 'rgb(var(--fg))'}>
              {s.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
