import { useEffect, useMemo, useRef, useState } from 'react'
import { isHighLatencyKind } from '../api/types'
import { useStore, LISTENER_ID } from '../store/useStore'
import { computeAuto, primaryChannel } from '../lib/geometry'
import { effectiveRole, roleLabel } from '../lib/roles'
import { deviceColorVar } from '../lib/colors'
import { fmt } from '../lib/format'

interface Drag {
  id: string
  dx: number
  dy: number
}

/**
 * Odanın kuşbakışı planı: hoparlörler, dinleyici, mesafe çizgileri. `editable` iken sürükleyip seçilebilir.
 * Oda ekranı, kurulum sihirbazı ve ana sayfa önizlemesi aynı bileşeni kullanır.
 */
export function RoomCanvas({
  editable = true,
  compact = false,
  showLegend = true,
}: {
  editable?: boolean
  compact?: boolean
  showLegend?: boolean
}) {
  const room = useStore((s) => s.room)
  const speakers = useStore((s) => s.speakers)
  const devices = useStore((s) => s.devices)
  const live = useStore((s) => s.live)
  const auto = useStore((s) => s.auto)
  const selection = useStore((s) => s.selection)
  const playing = useStore((s) => s.playing)
  const lowLatency = useStore((s) => s.lowLatency)
  const select = useStore((s) => s.select)
  const moveSpeaker = useStore((s) => s.moveSpeaker)
  const moveListener = useStore((s) => s.moveListener)

  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [size, setSize] = useState({ w: 600, h: 400 })
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pad = compact ? 26 : 44
  const scale = Math.max(10, Math.min((size.w - pad * 2) / room.widthM, (size.h - pad * 2) / room.depthM))
  const ox = (size.w - room.widthM * scale) / 2
  const oy = (size.h - room.depthM * scale) / 2
  const px = (x: number) => ox + x * scale
  const py = (y: number) => oy + y * scale
  const r = compact ? 11 : 15

  const { dMax, byId } = useMemo(() => computeAuto(speakers, room.listener), [speakers, room.listener])

  const toRoom = (clientX: number, clientY: number) => {
    const b = svgRef.current!.getBoundingClientRect()
    return { x: (clientX - b.left - ox) / scale, y: (clientY - b.top - oy) / scale }
  }
  const startDrag = (e: React.PointerEvent, id: string, at: { x: number; y: number }) => {
    if (!editable) return
    e.stopPropagation()
    select(id)
    const p = toRoom(e.clientX, e.clientY)
    drag.current = { id, dx: at.x - p.x, dy: at.y - p.y }
    svgRef.current!.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toRoom(e.clientX, e.clientY)
    if (d.id === LISTENER_ID) moveListener(p.x + d.dx, p.y + d.dy)
    else moveSpeaker(d.id, p.x + d.dx, p.y + d.dy)
  }
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current) svgRef.current?.releasePointerCapture(e.pointerId)
    drag.current = null
  }

  const gridX: number[] = []
  for (let v = 0; v <= room.widthM + 1e-6; v += 0.5) gridX.push(Math.round(v * 2) / 2)
  const gridY: number[] = []
  for (let v = 0; v <= room.depthM + 1e-6; v += 0.5) gridY.push(Math.round(v * 2) / 2)

  const hovered = hover ? speakers.find((s) => s.id === hover) : null
  const usedDevices = devices.filter((d) => speakers.some((s) => s.outputDeviceId === d.id))
  const listenerSel = selection === LISTENER_ID

  return (
    <div ref={wrapRef} className="relative h-full min-h-0 w-full overflow-hidden">
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="block touch-none"
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={() => editable && select(null)}
        role="img"
        aria-label="Oda planı"
      >
        <rect
          x={px(0)}
          y={py(0)}
          width={room.widthM * scale}
          height={room.depthM * scale}
          fill="rgb(var(--surface))"
          stroke="rgb(var(--line-strong))"
          strokeWidth={1.5}
          rx={3}
        />
        {gridX.map((v) => (
          <line
            key={`gx${v}`}
            x1={px(v)}
            x2={px(v)}
            y1={py(0)}
            y2={py(room.depthM)}
            stroke={Number.isInteger(v) ? 'rgb(var(--grid-major))' : 'rgb(var(--grid))'}
          />
        ))}
        {gridY.map((v) => (
          <line
            key={`gy${v}`}
            x1={px(0)}
            x2={px(room.widthM)}
            y1={py(v)}
            y2={py(v)}
            stroke={Number.isInteger(v) ? 'rgb(var(--grid-major))' : 'rgb(var(--grid))'}
          />
        ))}
        {!compact &&
          gridX
            .filter((v) => Number.isInteger(v) && (room.widthM <= 10 || v % 2 === 0))
            .map((v) => (
              <text key={`lx${v}`} x={px(v)} y={py(room.depthM) + 15} textAnchor="middle" className="num" fontSize={10} fill="rgb(var(--faint))">
                {v}
              </text>
            ))}
        {!compact &&
          gridY
            .filter((v) => Number.isInteger(v) && (room.depthM <= 10 || v % 2 === 0))
            .map((v) => (
              <text key={`ly${v}`} x={px(0) - 8} y={py(v) + 3.5} textAnchor="end" className="num" fontSize={10} fill="rgb(var(--faint))">
                {v}
              </text>
            ))}
        <text x={px(room.widthM / 2)} y={py(0) - (compact ? 7 : 10)} textAnchor="middle" fontSize={10} letterSpacing={1.5} fill="rgb(var(--faint))">
          ▲ ÖN (ekran)
        </text>

        {speakers.map((s) => {
          const color = deviceColorVar(s.outputDeviceId, devices)
          const mx = (px(s.x) + px(room.listener.x)) / 2
          const my = (py(s.y) + py(room.listener.y)) / 2
          const d = byId[s.id]?.distance ?? 0
          return (
            <g key={`ln${s.id}`} pointerEvents="none" opacity={s.mute ? 0.3 : 1}>
              <line
                x1={px(s.x)}
                y1={py(s.y)}
                x2={px(room.listener.x)}
                y2={py(room.listener.y)}
                stroke={color}
                strokeOpacity={playing === s.id ? 0.95 : 0.5}
                strokeWidth={playing === s.id ? 2 : 1.25}
                strokeDasharray="5 4"
              />
              {!compact && (
                <text x={mx} y={my - 4} textAnchor="middle" className="num" fontSize={10} fill="rgb(var(--muted))" stroke="rgb(var(--surface))" strokeWidth={3} paintOrder="stroke">
                  {fmt(d)} m
                </text>
              )}
            </g>
          )
        })}

        <g
          transform={`translate(${px(room.listener.x)} ${py(room.listener.y)})`}
          onPointerDown={(e) => startDrag(e, LISTENER_ID, room.listener)}
          style={{ cursor: editable ? 'grab' : 'default' }}
          role={editable ? 'button' : undefined}
          tabIndex={editable ? 0 : undefined}
          aria-label="Dinleyici"
          onFocus={() => editable && select(LISTENER_ID)}
        >
          {listenerSel && <circle r={r + 6} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} />}
          <circle r={r} fill="rgb(var(--raised))" stroke="rgb(var(--accent))" strokeWidth={2} />
          <path d={`M0 ${-r * 0.6} L${r * 0.33} ${r * 0.2} L0 0 L${-r * 0.33} ${r * 0.2} Z`} fill="rgb(var(--accent))" />
          <circle cy={r * 0.43} r={r * 0.15} fill="rgb(var(--accent))" />
          {!compact && (
            <text y={r + 17} textAnchor="middle" fontSize={11} fontWeight={600} fill="rgb(var(--fg))" stroke="rgb(var(--surface))" strokeWidth={3} paintOrder="stroke">
              Sen
            </text>
          )}
        </g>

        {speakers.map((s) => {
          const color = deviceColorVar(s.outputDeviceId, devices)
          const dev = devices.find((d) => d.id === s.outputDeviceId)
          const disabled = (lowLatency && isHighLatencyKind(dev?.kind)) || !dev
          const ch = primaryChannel(s.source)
          const sel = selection === s.id
          const isPlaying = playing === s.id
          return (
            <g
              key={s.id}
              transform={`translate(${px(s.x)} ${py(s.y)})`}
              opacity={disabled ? 0.35 : s.mute ? 0.5 : 1}
              style={{ cursor: editable ? 'grab' : 'default' }}
              role={editable ? 'button' : undefined}
              tabIndex={editable ? 0 : undefined}
              aria-label={`${s.name}, ${ch ?? 'kanalsız'}`}
              onPointerDown={(e) => startDrag(e, s.id, s)}
              onPointerEnter={() => setHover(s.id)}
              onPointerLeave={() => setHover((h) => (h === s.id ? null : h))}
              onFocus={() => editable && select(s.id)}
            >
              {isPlaying && <circle r={r} fill="none" stroke={color} strokeWidth={2} className="ping" />}
              {sel && <circle r={r + 6} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} />}
              <circle r={r} fill={color} fillOpacity={isPlaying ? 0.45 : 0.18} stroke={color} strokeWidth={2} strokeDasharray={s.mute ? '3 3' : undefined} />
              <g transform={`scale(${r / 15})`}>
                <rect x={-5} y={-6} width={10} height={12} rx={1.5} fill="none" stroke={color} strokeWidth={1.5} />
                <circle cy={2} r={2.4} fill={color} />
                <circle cy={-3} r={1} fill={color} />
              </g>
              {s.elevated && (
                <g transform={`translate(${r - 2} ${-r - 1})`}>
                  <rect x={-12} y={-7} width={24} height={14} rx={3} fill="rgb(var(--accent))" />
                  <text y={3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="rgb(var(--accent-fg))">
                    Üst
                  </text>
                </g>
              )}
              <text
                y={r + (compact ? 12 : 15)}
                textAnchor="middle"
                fontSize={compact ? 10 : 11}
                fontWeight={600}
                fill="rgb(var(--fg))"
                stroke="rgb(var(--surface))"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {s.name}
              </text>
              {ch && !compact && (
                <g transform={`translate(0 ${r + 25})`}>
                  <rect x={-14} y={-8} width={28} height={15} rx={3} fill="rgb(var(--raised))" stroke={color} strokeOpacity={0.8} />
                  <text y={3.5} textAnchor="middle" className="num" fontSize={9.5} fontWeight={600} fill={color}>
                    {ch}
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>

      {hovered && !drag.current && !compact && (
        <div
          className="pointer-events-none absolute z-10 w-[196px] rounded-md border border-line-strong bg-raised p-2.5 text-xs shadow-[var(--shadow)]"
          style={{
            left: Math.min(size.w - 208, px(hovered.x) + 24),
            top: Math.max(8, Math.min(size.h - 160, py(hovered.y) - 40)),
          }}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{hovered.name}</span>
            <span className="text-faint">
              {hovered.calibratedAt ? 'Ölçüldü' : auto[hovered.id]?.delay && auto[hovered.id]?.gain ? 'Otomatik' : 'Elle'}
            </span>
          </div>
          <Row k="Rol" v={roleLabel(effectiveRole(hovered))} />
          <Row k="Cihaz" v={`${devices.find((d) => d.id === hovered.outputDeviceId)?.name.split(' (')[0] ?? '—'} · k${hovered.deviceChannel}`} />
          <Row k="Mesafe" v={`${fmt(byId[hovered.id]?.distance ?? 0)} m`} />
          <Row k={live?.[hovered.id] ? 'Gecikme (şu an)' : 'Gecikme'} v={`${fmt(live?.[hovered.id]?.delayMs ?? hovered.delayMs)} ms`} />
          <Row k={live?.[hovered.id] ? 'Kazanç (şu an)' : 'Kazanç'} v={`${fmt(live?.[hovered.id]?.gainDb ?? hovered.gainDb, 1)} dB`} />
        </div>
      )}

      {showLegend && (
        <div className="pointer-events-none absolute bottom-3 left-4 flex flex-wrap gap-x-4 gap-y-1">
          {usedDevices.map((d) => (
            <span key={d.id} className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: deviceColorVar(d.id, devices) }} />
              {d.name}
            </span>
          ))}
        </div>
      )}
      {!compact && (
        <div className="pointer-events-none absolute bottom-3 right-4 text-right text-xs text-faint">
          <div>
            En uzak: <span className="num text-muted">{fmt(dMax)} m</span>
          </div>
          {editable && <div>Sürükle · ←↑↓→ 5 cm · Delete sil · Ctrl+Z geri al</div>}
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 py-px">
      <span className="shrink-0 text-muted">{k}</span>
      <span className="num truncate">{v}</span>
    </div>
  )
}
