import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, LISTENER_ID } from '../store/useStore'
import { computeAuto, primaryChannel } from '../lib/geometry'
import { countLayout, formatLayout, parseLayout } from '../lib/layout'
import { effectiveRole, roleLabel } from '../lib/roles'
import { deviceColorVar } from '../lib/colors'
import { fmt } from '../lib/format'
import { Button, NumberField, cx } from '../components/ui'
import { IconPlus, IconWand } from '../components/icons'

const PAD = 40
const QUICK_LAYOUTS = ['2.0', '3.1', '4.1', '5.1', '7.1', '5.1.2', '7.1.4']

interface Drag {
  id: string
  dx: number
  dy: number
}

export function RoomScreen() {
  const room = useStore((s) => s.room)
  const speakers = useStore((s) => s.speakers)
  const devices = useStore((s) => s.devices)
  const auto = useStore((s) => s.auto)
  const selection = useStore((s) => s.selection)
  const lowLatency = useStore((s) => s.lowLatency)
  const select = useStore((s) => s.select)
  const setRoomSize = useStore((s) => s.setRoomSize)
  const moveSpeaker = useStore((s) => s.moveSpeaker)
  const moveListener = useStore((s) => s.moveListener)
  const applyLayout = useStore((s) => s.applyLayout)
  const addSpeaker = useStore((s) => s.addSpeaker)
  const autoAll = useStore((s) => s.autoAll)

  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [size, setSize] = useState({ w: 800, h: 560 })
  const [hover, setHover] = useState<string | null>(null)
  const currentLabel = useMemo(() => formatLayout(countLayout(speakers)), [speakers])
  const [layoutText, setLayoutText] = useState(currentLabel)
  const [layoutErr, setLayoutErr] = useState<string | null>(null)
  useEffect(() => {
    setLayoutText(currentLabel)
    setLayoutErr(null)
  }, [currentLabel])

  const submitLayout = (text: string) => {
    const r = parseLayout(text)
    if (!r.ok) {
      setLayoutErr(r.error)
      return
    }
    setLayoutErr(null)
    applyLayout(r.spec)
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = Math.max(
    10,
    Math.min((size.w - PAD * 2) / room.widthM, (size.h - PAD * 2) / room.depthM),
  )
  const ox = (size.w - room.widthM * scale) / 2
  const oy = (size.h - room.depthM * scale) / 2
  const px = (x: number) => ox + x * scale
  const py = (y: number) => oy + y * scale

  const { dMax, byId } = useMemo(() => computeAuto(speakers, room.listener), [speakers, room.listener])

  const toRoom = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left - ox) / scale, y: (clientY - r.top - oy) / scale }
  }

  const startDrag = (e: React.PointerEvent, id: string, at: { x: number; y: number }) => {
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
    <div className="flex h-full min-h-0 flex-col">
      {/* Araç çubuğu */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Oda</span>
          <NumberField
            ariaLabel="Oda genişliği (m)"
            className="w-[76px]"
            value={room.widthM}
            min={2}
            max={20}
            step={0.5}
            unit="m"
            onChange={(v) => setRoomSize(v, room.depthM)}
          />
          <span className="text-faint">×</span>
          <NumberField
            ariaLabel="Oda derinliği (m)"
            className="w-[76px]"
            value={room.depthM}
            min={2}
            max={20}
            step={0.5}
            unit="m"
            onChange={(v) => setRoomSize(room.widthM, v)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">Düzen</span>
          <div className="relative">
            <input
              aria-label="Düzen (X.Y veya X.Y.Z)"
              title={layoutErr ?? 'X.Y veya X.Y.Z: zemin, sub, üst hoparlör sayısı (örn. 5.1.2). Enter ile uygula.'}
              aria-invalid={layoutErr ? true : undefined}
              value={layoutText}
              placeholder="5.1.2"
              spellCheck={false}
              onChange={(e) => {
                setLayoutText(e.target.value)
                setLayoutErr(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitLayout(layoutText)
              }}
              className={cx(
                'num h-7 w-[76px] rounded border bg-surface px-2 text-center text-[13px] outline-none focus:border-accent',
                layoutErr ? 'border-err' : 'border-line-strong',
              )}
            />
            {layoutErr && (
              <span
                role="alert"
                className="absolute left-0 top-full z-30 mt-1 w-max max-w-[260px] rounded border border-err/50 bg-raised px-2 py-1 text-xs text-err shadow-[var(--shadow)]"
              >
                {layoutErr}
              </span>
            )}
          </div>
          <Button size="sm" onClick={() => submitLayout(layoutText)} title="Yazılan düzeni uygula">
            Uygula
          </Button>
          {QUICK_LAYOUTS.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={currentLabel === p ? 'primary' : 'default'}
              onClick={() => submitLayout(p)}
              title={`${p} düzenini uygula`}
            >
              {p}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={autoAll} title="Tüm gecikme ve kazançları geometriden hesapla">
            <IconWand /> Tümünü otomatikle
          </Button>
          <Button size="sm" variant="primary" onClick={addSpeaker}>
            <IconPlus /> Hoparlör ekle
          </Button>
        </div>
      </div>

      {/* Tuval */}
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          width={size.w}
          height={size.h}
          className="block touch-none"
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={() => select(null)}
        >
          {/* Oda */}
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
              strokeWidth={1}
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
              strokeWidth={1}
            />
          ))}
          {/* Eksen etiketleri */}
          {gridX
            .filter((v) => Number.isInteger(v) && (room.widthM <= 10 || v % 2 === 0))
            .map((v) => (
              <text key={`lx${v}`} x={px(v)} y={py(room.depthM) + 15} textAnchor="middle" className="num" fontSize={10} fill="rgb(var(--faint))">
                {v}
              </text>
            ))}
          {gridY
            .filter((v) => Number.isInteger(v) && (room.depthM <= 10 || v % 2 === 0))
            .map((v) => (
              <text key={`ly${v}`} x={px(0) - 8} y={py(v) + 3.5} textAnchor="end" className="num" fontSize={10} fill="rgb(var(--faint))">
                {v}
              </text>
            ))}
          <text x={px(room.widthM / 2)} y={py(0) - 10} textAnchor="middle" fontSize={10} letterSpacing={1.5} fill="rgb(var(--faint))">
            ▲ ÖN
          </text>

          {/* Çizgiler */}
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
                  strokeOpacity={0.55}
                  strokeWidth={1.25}
                  strokeDasharray="5 4"
                />
                <text
                  x={mx}
                  y={my - 4}
                  textAnchor="middle"
                  className="num"
                  fontSize={10}
                  fill="rgb(var(--muted))"
                  stroke="rgb(var(--surface))"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {fmt(d)} m
                </text>
              </g>
            )
          })}

          {/* Dinleyici */}
          <g
            transform={`translate(${px(room.listener.x)} ${py(room.listener.y)})`}
            onPointerDown={(e) => startDrag(e, LISTENER_ID, room.listener)}
            style={{ cursor: 'grab' }}
            role="button"
            tabIndex={0}
            aria-label="Dinleyici"
          >
            {listenerSel && <circle r={21} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} />}
            <circle r={15} fill="rgb(var(--raised))" stroke="rgb(var(--accent))" strokeWidth={2} />
            <path d="M0 -9 L5 3 L0 0 L-5 3 Z" fill="rgb(var(--accent))" />
            <circle cy={6.5} r={2.2} fill="rgb(var(--accent))" />
            <text y={32} textAnchor="middle" fontSize={11} fontWeight={600} fill="rgb(var(--fg))" stroke="rgb(var(--surface))" strokeWidth={3} paintOrder="stroke">
              Dinleyici
            </text>
          </g>

          {/* Hoparlörler */}
          {speakers.map((s) => {
            const color = deviceColorVar(s.outputDeviceId, devices)
            const dev = devices.find((d) => d.id === s.outputDeviceId)
            const disabled = lowLatency && dev?.kind === 'network'
            const ch = primaryChannel(s.source)
            const sel = selection === s.id
            return (
              <g
                key={s.id}
                transform={`translate(${px(s.x)} ${py(s.y)})`}
                opacity={disabled ? 0.3 : s.mute ? 0.5 : 1}
                style={{ cursor: 'grab' }}
                role="button"
                tabIndex={0}
                aria-label={`${s.name}, ${ch ?? 'kanalsız'}`}
                onPointerDown={(e) => startDrag(e, s.id, s)}
                onPointerEnter={() => setHover(s.id)}
                onPointerLeave={() => setHover((h) => (h === s.id ? null : h))}
                onFocus={() => select(s.id)}
              >
                {sel && <circle r={21} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} />}
                <circle r={15} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} strokeDasharray={s.mute ? '3 3' : undefined} />
                {/* hoparlör simgesi */}
                <rect x={-5} y={-6} width={10} height={12} rx={1.5} fill="none" stroke={color} strokeWidth={1.5} />
                <circle cy={2} r={2.4} fill={color} />
                <circle cy={-3} r={1} fill={color} />
                {s.elevated && (
                  <g transform="translate(13 -16)">
                    <rect x={-13} y={-7.5} width={26} height={15} rx={3} fill="rgb(var(--accent))" />
                    <text y={3.5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="rgb(var(--accent-fg))">
                      Üst
                    </text>
                  </g>
                )}
                <text y={30} textAnchor="middle" fontSize={11} fontWeight={600} fill="rgb(var(--fg))" stroke="rgb(var(--surface))" strokeWidth={3} paintOrder="stroke">
                  {s.name}
                </text>
                {ch && (
                  <g transform="translate(0 40)">
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

        {/* Üzerine gelince bilgi */}
        {hovered && !drag.current && (
          <div
            className="pointer-events-none absolute z-10 w-[188px] rounded-md border border-line-strong bg-raised p-2.5 text-xs shadow-[var(--shadow)]"
            style={{
              left: Math.min(size.w - 200, px(hovered.x) + 24),
              top: Math.max(8, Math.min(size.h - 150, py(hovered.y) - 40)),
            }}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate font-semibold">{hovered.name}</span>
              <span className="text-faint">{auto[hovered.id]?.delay && auto[hovered.id]?.gain ? 'Otomatik' : 'Manuel'}</span>
            </div>
            <Row k="Rol" v={roleLabel(effectiveRole(hovered))} />
            <Row k="Mesafe" v={`${fmt(byId[hovered.id]?.distance ?? 0)} m`} />
            <Row k="Gecikme" v={`${fmt(hovered.delayMs)} ms`} />
            <Row k="Kazanç" v={`${fmt(hovered.gainDb, 1)} dB`} />
            <Row k="Konum" v={`${fmt(hovered.x)}, ${fmt(hovered.y)}`} />
          </div>
        )}

        {/* Alt bilgi */}
        <div className="pointer-events-none absolute bottom-3 left-4 flex flex-wrap gap-x-4 gap-y-1">
          {usedDevices.map((d) => (
            <span key={d.id} className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: deviceColorVar(d.id, devices) }} />
              {d.name}
            </span>
          ))}
        </div>
        <div className={cx('pointer-events-none absolute bottom-3 right-4 text-right text-xs text-faint')}>
          <div>
            En uzak: <span className="num text-muted">{fmt(dMax)} m</span>
            {listenerSel && ' · dinleyici seçili'}
          </div>
          <div>Sürükle · ←↑↓→ 5 cm · Delete sil</div>
        </div>
        {speakers.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted">
            Hoparlör yok. Bir düzen yazın (örn. 5.1.2) veya “Hoparlör ekle”ye basın.
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-px">
      <span className="text-muted">{k}</span>
      <span className="num">{v}</span>
    </div>
  )
}
