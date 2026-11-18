import type { MatchResult } from '../lib/roomEq'

const W = 320
const H = 120
const M = { l: 28, r: 6, t: 6, b: 16 }
const LO = 100
const HI = 16000
const VIEW = 12
const TICKS = [100, 1000, 10000]

const x = (f: number) => M.l + ((Math.log(f / LO) / Math.log(HI / LO)) * (W - M.l - M.r))
const y = (db: number) => M.t + ((VIEW - Math.max(-VIEW, Math.min(VIEW, db))) / (2 * VIEW)) * (H - M.t - M.b)

function path(hz: readonly number[], v: readonly number[]): string {
  return hz.map((f, i) => `${i ? 'L' : 'M'}${x(f).toFixed(1)} ${y(v[i]).toFixed(1)}`).join('')
}

/** Hedef (kesikli), ölçülen (soluk) ve düzeltme sonrası tahmin (vurgulu); eşleme bandı dışı gölgeli. */
export function MatchCurve({ hz, m }: { hz: readonly number[]; m: MatchResult }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Frekans yanıtı: ölçülen, hedef ve düzeltilmiş">
      <rect x={M.l} y={M.t} width={x(m.loHz) - M.l} height={H - M.t - M.b} fill="rgb(var(--raised))" />
      <rect x={x(m.hiHz)} y={M.t} width={W - M.r - x(m.hiHz)} height={H - M.t - M.b} fill="rgb(var(--raised))" />
      {[-6, 0, 6].map((d) => (
        <g key={d}>
          <line x1={M.l} x2={W - M.r} y1={y(d)} y2={y(d)} stroke="rgb(var(--grid))" strokeWidth={d === 0 ? 1 : 0.5} />
          <text x={M.l - 4} y={y(d) + 3} textAnchor="end" fontSize={8} fill="rgb(var(--faint))">
            {d > 0 ? `+${d}` : d}
          </text>
        </g>
      ))}
      {TICKS.map((f) => (
        <text key={f} x={x(f)} y={H - 4} textAnchor="middle" fontSize={8} fill="rgb(var(--faint))">
          {f >= 1000 ? `${f / 1000}k` : f}
        </text>
      ))}
      <path d={path(hz, m.target)} fill="none" stroke="rgb(var(--muted))" strokeDasharray="3 2" strokeWidth={1} />
      <path d={path(hz, m.measured)} fill="none" stroke="rgb(var(--warn))" strokeOpacity={0.7} strokeWidth={1} />
      {!m.isTarget && <path d={path(hz, m.corrected)} fill="none" stroke="rgb(var(--accent))" strokeWidth={1.6} />}
    </svg>
  )
}
