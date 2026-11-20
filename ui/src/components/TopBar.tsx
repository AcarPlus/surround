import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { waitedLongEnough } from '../lib/waiting'
import { checkHealth } from '../lib/health'
import { upmixStateLabel } from '../lib/upmix'
import { cx } from './ui'
import { ProfileMenu } from './ProfileMenu'
import { VolumeControl } from './VolumeControl'
import { api } from '../api/client'
import { useUpdate } from '../lib/useSystem'
import { IconMoon, IconPlay, IconRedo, IconStop, IconSun, IconUndo } from './icons'

/** Ara sıra bir kesinti (cihaz uykudan uyanırken vb.) duyulmaz; işaret ancak bu kadar birikince sarıya döner. */
const DROPS_WORTH_SHOWING = 10

/**
 * Tek durum işareti: yalnızca gerçekten bir şey yaptırması gereken sorunlar (hata/uyarı) ve motorun durumu. Bilgi
 * notları burada gösterilmez. Tıklayınca sorunlar düzeltme düğmeleriyle açılır.
 */
function StatusButton() {
  const s = useStore()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const items = useMemo(
    () =>
      checkHealth({
        devices: s.devices,
        source: s.source,
        speakers: s.speakers,
        upmix: s.upmix,
        upmixOptions: s.upmixOptions,
        processing: s.processing,
        running: s.runState === 'running',
        status: s.status,
        lowLatency: s.lowLatency,
        calibrated: true,
        waiting: s.runState === 'waiting' ? { missing: s.waitingFor, message: s.waitMessage } : null,
      }).filter((i) => i.level !== 'info'),
    [s.devices, s.source, s.speakers, s.upmix, s.upmixOptions, s.processing, s.runState, s.status, s.lowLatency, s.waitingFor, s.waitMessage],
  )
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const drops = s.status.reduce((a, st) => a + st.underruns + st.overruns, 0)
  const errors = items.filter((i) => i.level === 'error')
  let tone: 'ok' | 'warn' | 'err' | 'idle' = s.runState === 'running' ? 'ok' : 'idle'
  let text = s.runState === 'running' ? 'Her şey yolunda' : 'Hazır'
  if (errors.length) {
    tone = 'err'
    text = errors.length === 1 ? errors[0].title : `${errors.length} sorun`
  } else if (s.runState === 'waiting') {
    tone = 'warn'
    text = s.waitingFor.length > 0 ? `Bekleniyor: ${s.waitingFor.join(', ')}` : 'Yeniden başlatılıyor…'
  } else if (items.length) {
    tone = 'warn'
    text = items.length === 1 ? items[0].title : `${items.length} uyarı`
  } else if (s.runState === 'running' && drops >= DROPS_WORTH_SHOWING) {
    tone = 'warn'
    text = `${drops} kesinti`
  }
  const dot = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err', idle: 'bg-faint' }[tone]

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={text}
        className={cx(
          'flex h-9 max-w-[300px] items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors',
          tone === 'err'
            ? 'border-err/50 bg-err/10 text-err'
            : tone === 'warn'
              ? 'border-warn/50 bg-warn/10 text-warn'
              : 'border-line bg-surface text-fg/80 hover:border-line-strong',
        )}
      >
        <span className={cx('h-2 w-2 shrink-0 rounded-full', dot, (tone === 'ok' || s.runState === 'waiting') && 'breath')} />
        <span className="truncate">{text}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Durum"
          className="screen-in absolute right-0 top-11 z-50 w-[340px] rounded-2xl border border-line-strong bg-surface p-3 shadow-[var(--shadow)]"
        >
          {items.length === 0 ? (
            <p className="flex items-center gap-2 px-1 py-1.5 text-[13px] text-ok">
              <span className="h-2 w-2 rounded-full bg-ok" /> Sorun yok.
              {s.runState === 'running' && drops > 0 && <span className="text-warn">{drops} ses kesintisi oldu.</span>}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => (
                <li key={it.id} className="rounded-xl border border-line p-3">
                  <p className={cx('text-[13px] font-medium', it.level === 'error' ? 'text-err' : 'text-warn')}>{it.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{it.detail}</p>
                  {it.fix && (
                    <button
                      type="button"
                      onClick={() => {
                        s.fixHealth(it.fix!.id, it.fix!.arg)
                        setOpen(false)
                      }}
                      className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:brightness-110"
                    >
                      {it.fix.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Motorun şu an ne yaptığı, tek bakışta. */
function EngineReadout() {
  const runState = useStore((s) => s.runState)
  const engine = useStore((s) => s.engine)
  const running = runState === 'running'
  return (
    <div className="hidden min-w-0 flex-col gap-0.5 lg:flex">
      <span className={cx('flex items-center gap-1.5 text-xs font-medium', running ? 'text-accent' : 'text-muted')}>
        <span className={cx('h-1.5 w-1.5 rounded-full', running ? 'breath bg-accent shadow-[0_0_8px_rgb(var(--accent))]' : 'bg-faint')} />
        {running ? 'Ses odaya yayılıyor' : runState === 'starting' ? 'Başlatılıyor…' : 'Durdu'}
      </span>
      <span className="num truncate text-xs text-muted">
        {running && engine ? upmixStateLabel(engine) : 'Başlat’a bas, gerisi otomatik'}
      </span>
    </div>
  )
}

export function RunButton({ big }: { big?: boolean }) {
  const runState = useStore((s) => s.runState)
  const toggleRun = useStore((s) => s.toggleRun)
  // Cihaz beklerken de "Durdur": beklemeyi bitirir.
  const running = runState === 'running' || runState === 'waiting'
  const starting = runState === 'starting'
  return (
    <button
      onClick={() => void toggleRun()}
      disabled={starting}
      className={cx(
        'inline-flex items-center justify-center gap-2.5 rounded-2xl font-semibold transition-all',
        big ? 'h-12 min-w-[180px] px-7 text-[15px]' : 'h-11 min-w-[132px] px-6 text-[15px]',
        running
          ? 'run-live text-fg shadow-[0_0_30px_rgb(var(--accent)/0.25)] hover:brightness-125'
          : 'run-idle bg-accent text-accent-fg shadow-[0_10px_34px_rgb(var(--accent)/0.35)] hover:brightness-110',
        starting && 'opacity-60',
      )}
    >
      {running ? <IconStop width={15} height={15} /> : <IconPlay width={15} height={15} />}
      {starting ? 'Başlıyor…' : running ? 'Durdur' : 'Başlat'}
    </button>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded border border-line-strong text-muted hover:text-fg disabled:opacity-35 disabled:hover:text-muted"
    >
      {children}
    </button>
  )
}

/** Cihaz uzun süredir bekleniyorsa: eksiksiz başlat ya da cihazı değiştir. */
function WaitingActions() {
  const runState = useStore((s) => s.runState)
  const since = useStore((s) => s.waitingSince)
  const waitingFor = useStore((s) => s.waitingFor)
  const startWithoutMissing = useStore((s) => s.startWithoutMissing)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (runState !== 'waiting') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [runState])
  if (runState !== 'waiting' || waitingFor.length === 0 || !waitedLongEnough(since, now)) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-[13px]" role="status">
      <span className="text-warn">Bu cihazlar uzun süredir yok: {waitingFor.join(', ')}.</span>
      <button
        onClick={() => void startWithoutMissing()}
        className="rounded border border-warn/60 px-2.5 py-1 font-semibold text-warn hover:bg-warn/10"
      >
        Eksik cihaz olmadan başlat
      </button>
    </div>
  )
}

/** Yeni sürüm indirildi: yeniden başlatınca kurulur (kapatılırsa bir sonraki açılışta kendiliğinden kurulur). */
export function UpdateStrip() {
  const update = useUpdate()
  const showToast = useStore((s) => s.showToast)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  if (hidden || update?.state !== 'ready') return null
  const apply = () => {
    setBusy(true)
    api.applyUpdate().catch((e: unknown) => {
      setBusy(false)
      showToast(e instanceof Error ? e.message : 'Güncelleme başlatılamadı.', 5000, { tone: 'error' })
    })
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-accent/40 bg-accent/10 px-4 py-2 text-[13px]" role="status">
      <span>
        Surround <b>{update.version}</b> indirildi. Kurmak için uygulama yeniden başlar (birkaç saniye ses kesilir).
      </span>
      <button
        onClick={apply}
        disabled={busy}
        className="rounded border border-accent bg-accent px-2.5 py-1 font-semibold text-accent-fg hover:brightness-110 disabled:opacity-60"
      >
        {busy ? 'Yeniden başlatılıyor…' : 'Yeniden başlat ve güncelle'}
      </button>
      <button
        onClick={() => setHidden(true)}
        title="Uygulamayı bir dahaki açışında kendiliğinden kurulur"
        className="rounded px-2.5 py-1 font-semibold text-muted hover:bg-surface hover:text-fg"
      >
        Sonra
      </button>
    </div>
  )
}

export function TopBar() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const past = useStore((s) => s.past)
  const future = useStore((s) => s.future)
  const lastUndo = past[past.length - 1]?.label
  const lastRedo = future[future.length - 1]?.label
  const running = useStore((s) => s.runState === 'running')

  return (
    <>
    <header className="glass relative z-20 flex h-[72px] shrink-0 items-center gap-5 border-b border-line/70 px-5">
      {running && <span className="run-line" aria-hidden />}
      <div className="flex w-[124px] shrink-0 items-center gap-2.5">
        <span className="logo-pulse flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,rgb(var(--accent)),rgb(var(--dev-3)))] text-accent-fg">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="2.4" fill="currentColor" />
            <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16.1 7.9a5.8 5.8 0 0 1 0 8.2M7.9 16.1a5.8 5.8 0 0 1 0-8.2" />
              <path d="M19.6 4.4a10.8 10.8 0 0 1 0 15.2M4.4 19.6a10.8 10.8 0 0 1 0-15.2" opacity="0.6" />
            </g>
          </svg>
        </span>
        <span className="text-[16px] font-semibold tracking-tight">Surround</span>
      </div>

      <RunButton />
      <ProfileMenu />
      <EngineReadout />

      <div className="flex items-center gap-1.5">
        <IconButton label={lastUndo ? `Geri al: ${lastUndo} (Ctrl+Z)` : 'Geri alınacak değişiklik yok'} onClick={undo} disabled={!lastUndo}>
          <IconUndo />
        </IconButton>
        <IconButton label={lastRedo ? `Yinele: ${lastRedo} (Ctrl+Y)` : 'Yinelenecek değişiklik yok'} onClick={redo} disabled={!lastRedo}>
          <IconRedo />
        </IconButton>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <VolumeControl />
        <StatusButton />
        <IconButton label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </IconButton>
      </div>
    </header>
    <WaitingActions />
    <UpdateStrip />
    </>
  )
}
