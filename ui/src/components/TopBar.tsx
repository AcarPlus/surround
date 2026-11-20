import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { waitedLongEnough } from '../lib/waiting'
import { cx } from './ui'
import { ProfileMenu } from './ProfileMenu'
import { VolumeControl } from './VolumeControl'
import { api } from '../api/client'
import { useUpdate } from '../lib/useSystem'
import { IconMoon, IconPlay, IconRedo, IconStop, IconSun, IconUndo } from './icons'

function StatusPill() {
  const runState = useStore((s) => s.runState)
  const status = useStore((s) => s.status)
  const waitingFor = useStore((s) => s.waitingFor)
  const drops = status.reduce((a, s) => a + s.underruns + s.overruns, 0)

  let tone = 'text-muted border-line-strong'
  let dot = 'bg-faint'
  let text = 'Durdu'
  if (runState === 'waiting') {
    tone = 'text-warn border-warn/40'
    dot = 'bg-warn animate-pulse'
    text = waitingFor.length > 0 ? `Cihaz bekleniyor: ${waitingFor.join(', ')}` : 'Yeniden başlatılıyor…'
  } else if (runState === 'starting') {
    tone = 'text-warn border-warn/40'
    dot = 'bg-warn animate-pulse'
    text = 'Başlatılıyor…'
  } else if (runState === 'running') {
    if (drops > 0) {
      tone = 'text-warn border-warn/40'
      dot = 'bg-warn'
      text = `Çalışıyor · ${drops} kesinti`
    } else {
      tone = 'text-ok border-ok/40'
      dot = 'bg-ok'
      text = 'Çalışıyor · sorunsuz'
    }
  }
  return (
    <span
      role="status"
      title={text}
      className={cx('inline-flex h-7 max-w-[420px] items-center gap-2 whitespace-nowrap rounded-full border px-3 text-xs font-medium', tone)}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
      <span className="truncate">{text}</span>
    </span>
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
        'inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition-colors',
        big ? 'h-12 min-w-[180px] px-6 text-[15px]' : 'h-9 min-w-[124px] px-4 text-sm',
        running ? 'border-err/60 bg-err/10 text-err hover:bg-err/20' : 'border-accent bg-accent text-accent-fg hover:brightness-110',
        starting && 'opacity-60',
      )}
    >
      {running ? <IconStop width={big ? 16 : 14} height={big ? 16 : 14} /> : <IconPlay width={big ? 16 : 14} height={big ? 16 : 14} />}
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
  const setScreen = useStore((s) => s.setScreen)
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
      <button onClick={() => setScreen('connection')} className="rounded px-2.5 py-1 font-semibold text-accent hover:bg-surface">
        Cihaz seç
      </button>
    </div>
  )
}

/** Yeni sürüm indirildi: yeniden başlatınca kurulur (kapatılırsa bir sonraki açılışta kendiliğinden kurulur). */
function UpdateStrip() {
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

  return (
    <>
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <div className="flex w-[104px] items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="text-accent">
          <circle cx="12" cy="12" r="2.4" fill="currentColor" />
          <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M16.1 7.9a5.8 5.8 0 0 1 0 8.2M7.9 16.1a5.8 5.8 0 0 1 0-8.2" />
            <path d="M19.6 4.4a10.8 10.8 0 0 1 0 15.2M4.4 19.6a10.8 10.8 0 0 1 0-15.2" opacity="0.6" />
          </g>
        </svg>
        <span className="text-[15px] font-semibold tracking-tight">Surround</span>
      </div>

      <RunButton />
      <ProfileMenu />

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
        <StatusPill />
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
