// Uygulama logosu "Pusula": dinleyicinin (merkez) çevresinde, 5.1 hoparlör yönlerinde uzayan ışınsal çubuklar.
// tools/make-icon.ps1 (surround.ico) ve site/index.html ile aynı geometri (256 px tasarımı, 24 çubuk).

const SPEAKERS = [-90, -60, -120, 20, 160] // ekran açısı, -90 = yukarı: C, R, L, SR, SL

const BARS = Array.from({ length: 24 }, (_, i) => {
  const a = i * 15 - 90
  let sum = 0
  for (const b of SPEAKERS) {
    const d = Math.abs(((a - b + 540) % 360) - 180)
    sum += Math.exp(-(d * d) / (2 * 14 * 14))
  }
  const len = 12 + 44 * sum
  const k = Math.min(1, sum)
  const t = (a * Math.PI) / 180
  return {
    x1: 128 + 48 * Math.cos(t),
    y1: 128 + 48 * Math.sin(t),
    x2: 128 + (48 + len) * Math.cos(t),
    y2: 128 + (48 + len) * Math.sin(t),
    color: k > 0.5 ? '#B9A6FF' : '#8EA2FF',
    opacity: 0.45 + 0.55 * k,
  }
})

export function SurroundMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden>
      <rect width="256" height="256" rx="56" fill="#0F1330" />
      {BARS.map((b, i) => (
        <line
          key={i}
          x1={b.x1}
          y1={b.y1}
          x2={b.x2}
          y2={b.y2}
          stroke={b.color}
          strokeOpacity={b.opacity}
          strokeWidth="10"
          strokeLinecap="round"
        />
      ))}
      <circle cx="128" cy="128" r="20" fill="#EEF1FF" />
    </svg>
  )
}
