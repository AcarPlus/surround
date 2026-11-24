import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { RoomStage } from '../components/RoomStage'
import { DemoOverlay } from '../components/DemoOverlay'
import { SpeakerPopover } from '../components/SpeakerPopover'
import { LayoutPicker } from '../components/LayoutPicker'
import { Inspector } from '../components/Inspector'
import { Menu, type MenuItem } from '../components/Dialog'
import { Button, NumberField, cx } from '../components/ui'
import { IconPlus, IconVolume, IconX } from '../components/icons'
import { ROLES, effectiveRole } from '../lib/roles'
import { GHOST_ROLES } from '../components/RoomStage'
import { primaryChannel } from '../lib/geometry'
import { deviceColorVar } from '../lib/colors'
import { speakerLevel, useLevels } from '../lib/useLevels'
import { upmixStateLabel } from '../lib/upmix'

/** Ana ekran: odanın kendisi. Hoparlörler burada yerleştirilir, eklenir, ayarlanır; altta canlı seviyeler. */
export function HomeScreen() {
  const speakers = useStore((s) => s.speakers)
  const playing = useStore((s) => s.playing)
  const selection = useStore((s) => s.selection)
  const playTour = useStore((s) => s.playTour)
  const stopTour = useStore((s) => s.stopTour)
  const openWizard = useStore((s) => s.openWizard)
  const positional = useStore((s) => s.positionalMix)
  const setPositional = useStore((s) => s.setPositionalMix)
  const [editing, setEditing] = useState(false)
  const [details, setDetails] = useState(false)
  const [demo, setDemo] = useState(false)

  // Bu ekrandan başlatılan "sırayla çal" ekrandan çıkınca dursun.
  useEffect(() => () => useStore.getState().stopTour(), [])
  // Seçim kalkınca ayrıntı paneli de kapansın.
  useEffect(() => {
    if (!selection) setDetails(false)
  }, [selection])
  useEffect(() => {
    if (speakers.length === 0) setEditing(false)
  }, [speakers.length])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tek sıra: düzen çipleri solda (sığmazsa yatay kayar), araçlar sağda; hiçbir şey alt satıra düşmez. */}
      <div className="flex shrink-0 items-center gap-4 px-6 pb-1 pt-4">
        <ChipScroller>
          <LayoutPicker />
        </ChipScroller>
        <div className="flex shrink-0 items-center gap-1.5">
          <ToolButton
            active={demo}
            onClick={() => setDemo((v) => !v)}
            disabled={speakers.length === 0}
            title="Ses turu: sentez bir ses odada döner, sağa sola gider; çevresel sesin sende çalışıp çalışmadığını duy."
          >
            Ses turu
          </ToolButton>
          <ToolButton
            active={positional}
            onClick={() => setPositional(!positional)}
            disabled={speakers.length === 0}
            title="Açıkken her kanal standart yönünden duyulur: o yöne en yakın iki hoparlör arasında paylaştırılır (ör. orta 0°, sağ 60° ise ön sağ ikisinden eşit çalar). Rol yerine sahnedeki yönler kullanılır; yönleri doğru yerleştir."
          >
            Konuma göre dağıt
          </ToolButton>
          <ToolButton onClick={() => (playing ? stopTour() : void playTour())} disabled={speakers.length === 0}>
            <IconVolume width={15} height={15} /> {playing ? 'Durdur' : 'Sırayla çal'}
          </ToolButton>
          {editing && <OtherRolesMenu />}
          <ToolButton active={editing} onClick={() => setEditing((v) => !v)} disabled={speakers.length === 0}>
            <IconPlus width={15} height={15} /> {editing ? 'Bitti' : 'Hoparlör ekle'}
          </ToolButton>
          <RoomMenu />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <RoomStage
          editing={editing}
          renderPopover={(sp, anchor) =>
            details ? null : <SpeakerPopover speaker={sp} anchor={anchor} onDetails={() => setDetails(true)} />
          }
        />
        {demo && <DemoOverlay onClose={() => setDemo(false)} />}
        {editing && (
          <p className="pointer-events-none absolute inset-x-0 top-2 text-center text-xs text-accent">
            Eklemek istediğin yere dokun · kaldırmak için hoparlöre dokun
          </p>
        )}
        {speakers.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
            <p className="aurora-text text-[26px] font-semibold tracking-tight">Odanı kuralım</p>
            <p className="max-w-[420px] text-[14px] text-muted">
              Hangi hoparlörlerin bağlı olduğunu birkaç soruyla öğrenip odaya yerleştiririz. Sonra istediğin gibi sürükleyip
              düzenlersin.
            </p>
            <Button variant="primary" className="h-11 px-6 text-[14px]" onClick={openWizard}>
              Kurulumu başlat
            </Button>
          </div>
        )}
        {details && selection && (
          <div className="screen-in absolute inset-y-0 right-0 z-30 flex shadow-[-20px_0_60px_rgb(0_0_0/0.45)]">
            <button
              type="button"
              aria-label="Ayrıntıları kapat"
              onClick={() => setDetails(false)}
              className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-fg"
            >
              <IconX width={13} height={13} />
            </button>
            <Inspector />
          </div>
        )}
      </div>

      <LevelStrip />
    </div>
  )
}

function ToolButton({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cx(
        'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-all duration-300 active:scale-[0.96] disabled:opacity-40 disabled:active:scale-100',
        active ? 'chip-aurora' : 'border-line bg-surface/60 backdrop-blur-sm hover:border-accent/40 hover:shadow-[0_0_16px_-6px_rgb(var(--accent)/0.6)]',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Düzen çiplerinin kabı: sığmazsa yatay kayar (fare tekerleği de kaydırır), taşan kenar keskin kesilmek yerine yumuşakça
 * solar; hangi kenarda devamı varsa orada.
 */
function ChipScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const upd = () => setEdge({ l: el.scrollLeft > 1, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 })
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    upd()
    const ro = new ResizeObserver(upd)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    el.addEventListener('scroll', upd, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', upd)
      el.removeEventListener('wheel', wheel)
    }
  }, [])
  const f = 36
  const mask = `linear-gradient(90deg, ${edge.l ? 'transparent' : '#000'} 0, #000 ${edge.l ? f : 0}px, #000 calc(100% - ${edge.r ? f : 0}px), ${edge.r ? 'transparent' : '#000'} 100%)`
  return (
    <div ref={ref} className="min-w-0 flex-1 overflow-x-auto py-1" style={{ scrollbarWidth: 'none', maskImage: mask, WebkitMaskImage: mask }}>
      {children}
    </div>
  )
}

/** Sahnede yuvası olmayan roller (geniş, arka orta, üst orta, rolsüz). */
function OtherRolesMenu() {
  const speakers = useStore((s) => s.speakers)
  const addSpeaker = useStore((s) => s.addSpeaker)
  const used = new Set(speakers.map((s) => effectiveRole(s)))
  const items: MenuItem[] = [
    { header: true, label: 'Diğer konumlar', onSelect: () => {} },
    ...ROLES.filter((r) => !GHOST_ROLES.includes(r.id)).map((r) => ({
      label: r.label,
      hint: used.has(r.id) ? 'zaten var' : undefined,
      onSelect: () => addSpeaker(r.id),
    })),
    { label: 'Rolsüz hoparlör', hint: 'boş kalan kanala atanır', onSelect: () => addSpeaker() },
  ]
  return (
    <Menu
      align="right"
      items={items}
      trigger={({ toggle, open }) => (
        <ToolButton onClick={toggle} active={open}>
          Diğer…
        </ToolButton>
      )}
    />
  )
}

/** Oda boyutu ve seyrek kullanılan oda işlemleri. */
function RoomMenu() {
  const room = useStore((s) => s.room)
  const setRoomSize = useStore((s) => s.setRoomSize)
  const autoAll = useStore((s) => s.autoAll)
  const openWizard = useStore((s) => s.openWizard)
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <ToolButton onClick={() => setOpen((v) => !v)} active={open}>
        <span className="num">
          {room.widthM.toFixed(1).replace('.', ',')} × {room.depthM.toFixed(1).replace('.', ',')} m
        </span>
      </ToolButton>
      {open && (
        <div className="glass-card screen-in absolute right-0 top-10 z-40 w-[280px] space-y-3 p-4 shadow-[var(--shadow)]">
          <div>
            <p className="mb-2 text-xs text-muted">Oda boyutu</p>
            <div className="flex items-center gap-2">
              <NumberField ariaLabel="Oda genişliği (m)" className="w-[92px]" value={room.widthM} min={2} max={20} step={0.5} unit="m" onChange={(v) => setRoomSize(v, room.depthM)} />
              <span className="text-faint">×</span>
              <NumberField ariaLabel="Oda derinliği (m)" className="w-[92px]" value={room.depthM} min={2} max={20} step={0.5} unit="m" onChange={(v) => setRoomSize(room.widthM, v)} />
            </div>
          </div>
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => {
                autoAll()
                setOpen(false)
              }}
              className="rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-raised"
            >
              Gecikme ve seviyeyi mesafeden hesapla
              <span className="block text-xs text-muted">Ölçülen değerler de mesafeye döner</span>
            </button>
            <button
              type="button"
              onClick={() => {
                openWizard()
                setOpen(false)
              }}
              className="rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-raised"
            >
              Kurulumu baştan yap
              <span className="block text-xs text-muted">Cihazlara ne bağlı olduğunu yeniden sorar</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Alt şerit: her hoparlörün canlı seviyesi ve motorun ne yaptığı. */
function LevelStrip() {
  const speakers = useStore((s) => s.speakers)
  const devices = useStore((s) => s.devices)
  const runState = useStore((s) => s.runState)
  const engine = useStore((s) => s.engine)
  const status = useStore((s) => s.status)
  const source = useStore((s) => s.source)
  const running = runState === 'running'
  const levels = useLevels(running)
  const src = devices.find((d) => d.id === source.deviceId)
  const drops = status.reduce((a, s) => a + s.underruns + s.overruns, 0)

  const stats: { k: string; v: string }[] = [
    { k: 'Kaynak', v: src ? `${src.name.split(' (')[0]}${engine?.sourceRate ? ` · ${Math.round(engine.sourceRate / 1000)} kHz` : ''}` : 'seçilmedi' },
    { k: 'Yayılım', v: running && engine ? upmixStateLabel(engine) : '—' },
    { k: 'Ek gecikme', v: running && engine && engine.upmix === 'stereo' && engine.upmixLatencyMs > 0 ? `${Math.round(engine.upmixLatencyMs)} ms` : '—' },
    { k: 'Kesinti', v: running ? (drops > 0 ? String(drops) : 'yok') : '—' },
  ]

  return (
    <footer className="glass flex h-[118px] shrink-0 items-stretch gap-7 border-t border-line/70 px-6">
      <div className="flex w-[132px] shrink-0 flex-col justify-center gap-1">
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted">CANLI SEVİYE</span>
        <span className="text-xs text-faint">{running ? 'Her hoparlör, şu an çaldığı kadar' : 'Motor durdu'}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-end gap-3 overflow-x-auto pb-3 pt-4">
        {speakers.map((s) => {
          const lv = speakerLevel(s, levels)
          const color = deviceColorVar(s.outputDeviceId, devices)
          const ch = primaryChannel(s.source)
          return (
            <div key={s.id} className="flex w-10 shrink-0 flex-col items-center gap-1.5" title={s.name}>
              <div className="relative h-[60px] w-3 overflow-hidden rounded-[3px]">
                <div className="led absolute inset-0 bg-raised" />
                <div
                  className="led absolute inset-x-0 bottom-0 transition-[height] duration-100 ease-linear"
                  style={{
                    height: `${Math.round(lv * 100)}%`,
                    background: `linear-gradient(0deg, ${color} 0%, ${color} 70%, rgb(var(--warn)) 92%, rgb(var(--err)) 100%)`,
                    backgroundSize: '100% 60px',
                    backgroundPosition: 'bottom',
                    filter: `drop-shadow(0 0 6px ${color})`,
                  }}
                />
              </div>
              <span className={cx('num text-[11px]', s.mute ? 'text-faint line-through' : 'text-fg/80')}>{ch === 'LFE' ? 'SUB' : ch ?? '—'}</span>
            </div>
          )
        })}
      </div>
      <dl className="grid min-w-[360px] shrink-0 grid-cols-2 content-center gap-x-7 gap-y-2.5 border-l border-line pl-7">
        {stats.map((st) => (
          <div key={st.k} className="min-w-0">
            <dt className="text-[11px] text-muted">{st.k}</dt>
            <dd className="num truncate text-[13px] font-medium">{st.v}</dd>
          </div>
        ))}
      </dl>
    </footer>
  )
}
