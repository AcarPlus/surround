import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LevelFrame } from '../api/types'
import { isHighLatencyKind, type Speaker } from '../api/types'
import { useStore, LISTENER_ID } from '../store/useStore'
import { primaryChannel } from '../lib/geometry'
import { FLOOR_NOMINAL, HEIGHT_NOMINAL, ROLES, effectiveRole } from '../lib/roles'
import { standardPosition } from '../lib/setup'
import { deviceColorAlpha, deviceColorVar } from '../lib/colors'
import { frameEnergy, levelToUnit, speakerLevel, useLevels } from '../lib/useLevels'
import { cx } from './ui'

/** Hoparlör ekleme kipinde boş yuva olarak gösterilen roller (sık kullanılanlar). */
export const GHOST_ROLES = [
  'left',
  'center',
  'right',
  'sub',
  'side-left',
  'side-right',
  'back-left',
  'back-center',
  'back-right',
  'top-front-left',
  'top-front-right',
  'top-back-left',
  'top-back-right',
]

interface Drag {
  id: string
  dx: number
  dy: number
  moved: boolean
}

/** Konum (piksel) bilgisi: sahne, seçili hoparlörün yanına açılan paneli buna göre yerleştirir. */
export interface Anchor {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Ana ekranın oda sahnesi: odanın kuşbakışı planı, canlı seviyeye göre parlayan hoparlörler, dinleyiciye uzanan ışınlar.
 * Hoparlörler ve dinleyici sürüklenir; bir hoparlöre dokununca `renderPopover` onun yanına açılır. `editing` iken
 * kullanılmayan standart rollerin yuvaları "+" olarak görünür; dokununca o hoparlör eklenir.
 */
export function RoomStage({
  editing = false,
  renderPopover,
}: {
  editing?: boolean
  renderPopover?: (speaker: Speaker, anchor: Anchor) => ReactNode
}) {
  const room = useStore((s) => s.room)
  const speakers = useStore((s) => s.speakers)
  const devices = useStore((s) => s.devices)
  const selection = useStore((s) => s.selection)
  const playing = useStore((s) => s.playing)
  const lowLatency = useStore((s) => s.lowLatency)
  const runState = useStore((s) => s.runState)
  const select = useStore((s) => s.select)
  const moveSpeaker = useStore((s) => s.moveSpeaker)
  const moveListener = useStore((s) => s.moveListener)
  const addSpeaker = useStore((s) => s.addSpeaker)

  const running = runState === 'running'
  const levels = useLevels(running)
  const energy = frameEnergy(levels)

  // Bas vuruşu algılama: subwoofer (LFE) ya da genel enerji kendi ortalamasının belirgin üstüne sıçrayınca dalga.
  const [waves, setWaves] = useState<{ id: number; x: number; y: number }[]>([])
  const beat = useRef({ avg: 0, last: 0, seq: 0 })
  const bass = levels ? Math.max(levelToUnit(levels.LFE), energy * 0.9) : 0
  useEffect(() => {
    if (!running) return
    const b = beat.current
    const now = performance.now()
    const spike = bass - b.avg
    b.avg = b.avg * 0.85 + bass * 0.15
    if (bass > 0.5 && spike > 0.12 && now - b.last > 380) {
      b.last = now
      const sub = speakers.find((s) => !s.mute && primaryChannel(s.source) === 'LFE')
      const at = sub ? { x: px(sub.x), y: py(sub.y) } : { x: lx, y: ly }
      setWaves((ws) => [...ws.slice(-3), { id: ++b.seq, ...at }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels])

  const wrapRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)
  const [size, setSize] = useState({ w: 900, h: 560 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const padX = 64
  const padY = 52
  const scale = Math.max(20, Math.min((size.w - padX * 2) / room.widthM, (size.h - padY * 2) / room.depthM))
  const rw = room.widthM * scale
  const rh = room.depthM * scale
  const ox = (size.w - rw) / 2
  const oy = (size.h - rh) / 2
  const px = (x: number) => ox + x * scale
  const py = (y: number) => oy + y * scale
  const lx = px(room.listener.x)
  const ly = py(room.listener.y)

  const toRoom = (clientX: number, clientY: number) => {
    const b = wrapRef.current!.getBoundingClientRect()
    return { x: (clientX - b.left - ox) / scale, y: (clientY - b.top - oy) / scale }
  }
  const startDrag = (e: React.PointerEvent, id: string, at: { x: number; y: number }) => {
    e.stopPropagation()
    e.preventDefault()
    select(id)
    const p = toRoom(e.clientX, e.clientY)
    drag.current = { id, dx: at.x - p.x, dy: at.y - p.y, moved: false }
    wrapRef.current!.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (!d.moved) {
      d.moved = true
      setDragging(true)
    }
    const p = toRoom(e.clientX, e.clientY)
    if (d.id === LISTENER_ID) moveListener(p.x + d.dx, p.y + d.dy)
    else moveSpeaker(d.id, p.x + d.dx, p.y + d.dy)
  }
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current) wrapRef.current?.releasePointerCapture(e.pointerId)
    drag.current = null
    setDragging(false)
  }

  const usedRoles = new Set(speakers.map((s) => effectiveRole(s)))
  const hasSides = speakers.some((s) => (s.source.SL ?? 0) > 0 || (s.source.SR ?? 0) > 0)
  const ghosts = editing
    ? GHOST_ROLES.filter((r) => !usedRoles.has(r)).map((r) => {
        const def = ROLES.find((d) => d.id === r)!
        const p = standardPosition(r, room, hasSides || r.startsWith('side'))
        return { id: r, label: def.label, sub: !!def.bassReceiver, x: px(p.x), y: py(p.y) }
      })
    : []

  const selected = selection && selection !== LISTENER_ID ? speakers.find((s) => s.id === selection) : undefined

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-0 w-full touch-none select-none overflow-hidden"
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={() => select(null)}
    >
      {/* Zemin parıltısı: dinleyicinin çevresi, motor çalışırken daha belirgin. */}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full transition-opacity duration-700"
        style={{
          left: lx - 320,
          top: ly - 320,
          width: 640,
          height: 640,
          background: 'radial-gradient(circle, rgb(var(--accent) / 0.10) 0%, transparent 65%)',
          opacity: running ? 1 : 0.35,
        }}
      />

      <div
        aria-hidden
        className="stage-room pointer-events-none absolute rounded-[22px] border border-line"
        style={{
          left: ox,
          top: oy,
          width: rw,
          height: rh,
          borderColor: running ? `rgb(var(--accent) / ${(0.18 + energy * 0.5).toFixed(3)})` : undefined,
          boxShadow: running
            ? `0 40px 100px rgb(0 0 0 / 0.45), 0 0 ${Math.round(30 + energy * 70)}px rgb(var(--accent) / ${(0.06 + energy * 0.22).toFixed(3)}), inset 0 0 ${Math.round(40 + energy * 80)}px rgb(var(--accent) / ${(0.03 + energy * 0.08).toFixed(3)})`
            : undefined,
          transition: 'border-color .12s linear, box-shadow .12s linear',
        }}
      >
        <div className="stage-screen absolute left-1/2 top-[-1px] h-[5px] w-[42%] -translate-x-1/2 rounded-b-md" />
        <span className="absolute inset-x-0 top-3 text-center text-[11px] tracking-[0.2em] text-faint">EKRAN</span>
      </div>

      {/* Her hoparlörün zemine düşen ışığı: canlı seviyeyle parlar, renkler üst üste binince karışır. */}
      {speakers.map((s) => {
        if (s.mute) return null
        const lv = speakerLevel(s, levels)
        const lit = running || playing === s.id
        return (
          <div
            key={`pool-${s.id}`}
            aria-hidden
            className="light-pool"
            style={{
              left: px(s.x),
              top: py(s.y),
              background: `radial-gradient(circle, ${deviceColorAlpha(s.outputDeviceId, devices, 0.34)} 0%, transparent 62%)`,
              opacity: lit ? 0.25 + lv * 0.75 : 0.12,
            }}
          />
        )
      })}

      {/* Hoparlörden dinleyiciye ışınlar: çalışırken ses dinleyiciye doğru akar */}
      {speakers.map((s) => {
        if (s.mute) return null
        const sx = px(s.x)
        const sy = py(s.y)
        const dx = lx - sx
        const dy = ly - sy
        const len = Math.max(0, Math.hypot(dx, dy) - 30)
        const lv = speakerLevel(s, levels)
        const lit = running || playing === s.id
        return (
          <div
            key={`beam-${s.id}`}
            aria-hidden
            className={cx('pointer-events-none absolute origin-left', lit && 'beam-flow')}
            style={{
              left: sx,
              top: sy,
              width: len,
              height: lit ? 2 : 1,
              transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`,
              background: lit
                ? `repeating-linear-gradient(90deg, ${deviceColorVar(s.outputDeviceId, devices)} 0 8px, transparent 8px 18px)`
                : `linear-gradient(90deg, ${deviceColorVar(s.outputDeviceId, devices)} 0%, transparent 100%)`,
              WebkitMaskImage: 'linear-gradient(90deg, #000 0%, rgb(0 0 0 / 0.15) 100%)',
              maskImage: 'linear-gradient(90deg, #000 0%, rgb(0 0 0 / 0.15) 100%)',
              opacity: lit ? 0.35 + lv * 0.65 : 0.16,
            }}
          />
        )
      })}

      {/* Ses parçacıkları: çalışırken her hoparlörden dinleyiciye ışık taneleri akar, seviyeyle parlar */}
      {running &&
        speakers.map((s) => {
          if (s.mute) return null
          const sx = px(s.x)
          const sy = py(s.y)
          const dx = lx - sx
          const dy = ly - sy
          const len = Math.max(0, Math.hypot(dx, dy) - 34)
          const lv = speakerLevel(s, levels)
          const color = deviceColorVar(s.outputDeviceId, devices)
          return (
            <div
              key={`particles-${s.id}`}
              aria-hidden
              className="pointer-events-none absolute origin-left"
              style={{
                left: sx,
                top: sy,
                width: len,
                height: 0,
                transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`,
                opacity: 0.25 + lv * 0.75,
                ['--len' as string]: `${len}px`,
              }}
            >
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="particle"
                  style={{ background: color, boxShadow: `0 0 10px 2px ${color}`, animationDelay: `${(i * 0.42).toFixed(2)}s` }}
                />
              ))}
            </div>
          )
        })}

      {/* Bas vuruşu: odaya yayılan şok dalgası */}
      {waves.map((w) => (
        <span
          key={w.id}
          aria-hidden
          className="shockwave"
          style={{ left: w.x, top: w.y }}
          onAnimationEnd={() => setWaves((ws) => ws.filter((v) => v.id !== w.id))}
        />
      ))}

      {ghosts.map((g) => (
        <button
          key={`ghost-${g.id}`}
          type="button"
          aria-label={`${g.label} ekle`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => addSpeaker(g.id)}
          className={cx(
            'stage-ghost absolute z-[4] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center border-[1.5px] border-dashed border-accent bg-accent/[0.06] text-accent',
            g.sub ? 'rounded-[14px]' : 'rounded-full',
          )}
          style={{ left: g.x, top: g.y }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="absolute top-[50px] whitespace-nowrap text-[11px] font-medium">{g.label}</span>
        </button>
      ))}

      {running && <ListenerCompass x={lx} y={ly} levels={levels} />}

      {/* Dinleyici */}
      <button
        type="button"
        aria-label="Dinleyici (sürükleyerek taşı)"
        onPointerDown={(e) => startDrag(e, LISTENER_ID, room.listener)}
        className={cx(
          'absolute z-[3] flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-accent bg-surface text-accent transition-shadow',
          selection === LISTENER_ID && 'ring-4 ring-accent/30',
        )}
        style={{
          left: lx,
          top: ly,
          boxShadow: `0 0 0 ${Math.round(8 + energy * 10)}px rgb(var(--accent) / ${(0.07 + energy * 0.08).toFixed(3)}), 0 0 ${Math.round(50 + energy * 60)}px rgb(var(--accent) / ${running ? (0.3 + energy * 0.4).toFixed(3) : 0.12})`,
          transform: `translate(-50%, -50%) scale(${(1 + energy * 0.08).toFixed(3)})`,
          transition: 'box-shadow .1s linear, transform .1s linear',
        }}
      >
        {running && <span className="listener-orbit" aria-hidden />}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
        <span className="absolute top-[62px] rounded-md bg-bg/80 px-1.5 text-xs font-medium text-accent backdrop-blur-sm">Sen</span>
      </button>

      {speakers.map((s) => {
        const color = deviceColorVar(s.outputDeviceId, devices)
        const dev = devices.find((d) => d.id === s.outputDeviceId)
        const unavailable = !dev || (lowLatency && isHighLatencyKind(dev.kind))
        const ch = primaryChannel(s.source)
        const sel = selection === s.id
        const lv = speakerLevel(s, levels)
        const sub = ch === 'LFE'
        const live = (running && !s.mute && !unavailable) || playing === s.id
        const glow = Math.round(lv * 22)
        const node = sub ? 54 : 46
        return (
          <div
            key={s.id}
            className={cx('absolute z-[2] flex h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 items-center justify-center', live && 'stage-live', sel && 'z-[5]')}
            style={{
              left: px(s.x),
              top: py(s.y),
              color,
              opacity: unavailable ? 0.35 : s.mute ? 0.4 : 1,
              ['--lv' as string]: lv.toFixed(3),
            }}
          >
            <span className="stage-ring" aria-hidden />
            <span className="stage-ring stage-ring-2" aria-hidden />
            <span className="stage-ring stage-ring-3" aria-hidden />
            <button
              type="button"
              aria-label={`${s.name}${ch ? `, ${ch}` : ''}`}
              aria-pressed={sel}
              onPointerDown={(e) => startDrag(e, s.id, s)}
              onFocus={() => select(s.id)}
              className={cx(
                'stage-node relative flex cursor-grab items-center justify-center border-2 text-fg',
                sub ? 'rounded-2xl' : 'rounded-full',
                s.elevated && 'border-dashed',
              )}
              style={{
                width: node,
                height: node,
                // Hoparlör zarı gibi: ses vuruşlarıyla hafifçe büyür.
                transform: live ? `scale(${(1 + lv * 0.13).toFixed(3)})` : undefined,
                transition: 'transform 70ms linear',
                borderColor: lv > 0.9 && live ? 'rgb(255 255 255)' : color,
                background: 'radial-gradient(circle at 50% 35%, rgb(var(--raised)), rgb(var(--surface)))',
                boxShadow: [
                  sel ? '0 0 0 3px rgb(var(--accent))' : '0 0 0 0 transparent',
                  `0 0 ${10 + glow * 1.7}px ${deviceColorAlpha(s.outputDeviceId, devices, live ? 0.5 : 0)}`,
                  `inset 0 0 ${glow}px ${deviceColorAlpha(s.outputDeviceId, devices, 0.32)}`,
                  // Tepe: seviye tavana vurunca beyaz parlama.
                  lv > 0.9 && live ? '0 0 26px 4px rgb(255 255 255 / 0.55)' : '0 0 0 0 transparent',
                ].join(', '),
              }}
            >
              {live && (
                <span
                  aria-hidden
                  className={cx('level-arc', sub ? 'rounded-[20px]' : 'rounded-full')}
                  style={{ background: `conic-gradient(from 210deg, ${color} ${Math.round(lv * 300)}deg, transparent 0)` }}
                />
              )}
              <span className="num text-[11px] font-semibold tracking-wide">{ch === 'LFE' ? 'SUB' : ch ?? '—'}</span>
            </button>
            <span
              className={cx(
                'pointer-events-none absolute top-[66px] whitespace-nowrap text-xs font-medium',
                sel ? 'text-accent' : 'text-fg/80',
                s.mute && 'line-through',
              )}
            >
              {s.name}
            </span>
          </div>
        )
      })}

      {selected && !dragging && renderPopover && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          {renderPopover(selected, { x: px(selected.x), y: py(selected.y), w: size.w, h: size.h })}
        </div>
      )}

      {speakers.length > 0 && !editing && (
        <span className="pointer-events-none absolute bottom-3 right-5 text-xs text-faint">
          Sürükleyerek yerleştir · dokununca ayarları açılır
        </span>
      )}
    </div>
  )
}

const COMPASS_BARS = 72
const COMPASS_SIGMA = 24

/**
 * Ses pusulası: dinleyicinin çevresinde, sesin hangi yönden geldiğini gösteren dairesel gösterge. Her kanalın canlı
 * seviyesi kendi nominal açısına (0° = ön, + = sağ) yumuşak bir tepe olarak yayılır; üst kanallar daha zayıf, LFE her
 * yöne eşit katkı verir.
 */
function ListenerCompass({ x, y, levels }: { x: number; y: number; levels: LevelFrame | null }) {
  if (!levels) return null
  const sources = [
    ...FLOOR_NOMINAL.map((n) => ({ deg: n.deg, v: levelToUnit(levels[n.ch]) })),
    ...HEIGHT_NOMINAL.map((n) => ({ deg: n.deg, v: levelToUnit(levels[n.ch]) * 0.6 })),
  ]
  const base = levelToUnit(levels.LFE) * 0.25
  const bars = Array.from({ length: COMPASS_BARS }, (_, i) => {
    const a = (i * 360) / COMPASS_BARS - 180
    let v = base
    for (const s of sources) {
      let d = Math.abs(a - s.deg) % 360
      if (d > 180) d = 360 - d
      v = Math.max(v, s.v * Math.exp(-(d * d) / (2 * COMPASS_SIGMA * COMPASS_SIGMA)))
    }
    return { a, v: Math.min(1, v) }
  })
  return (
    <div aria-hidden className="pointer-events-none absolute z-[2]" style={{ left: x, top: y }}>
      {bars.map((b) => (
        <span
          key={b.a}
          className="compass-bar"
          style={{
            height: `${(3 + b.v * 52).toFixed(1)}px`,
            transform: `rotate(${b.a}deg) translateY(-44px)`,
            opacity: 0.25 + b.v * 0.75,
          }}
        />
      ))}
    </div>
  )
}
