import { useStore, type PresetChoice } from '../store/useStore'
import { Segmented, Switch, Tip, cx } from './ui'
import { IconMoon, IconPlay, IconStop, IconSun } from './icons'

const PRESETS: { value: PresetChoice; label: string }[] = [
  { value: '2.0', label: '2.0' },
  { value: '5.1', label: '5.1' },
  { value: '7.1', label: '7.1' },
  { value: 'custom', label: 'Özel' },
]

function StatusPill() {
  const runState = useStore((s) => s.runState)
  const status = useStore((s) => s.status)
  const drops = status.reduce((a, s) => a + s.underruns + s.overruns, 0)

  let tone = 'text-muted border-line-strong'
  let dot = 'bg-faint'
  let text = 'Durdu'
  if (runState === 'starting') {
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
      className={cx('inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-xs font-medium', tone)}
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', dot)} />
      {text}
    </span>
  )
}

export function TopBar() {
  const runState = useStore((s) => s.runState)
  const toggleRun = useStore((s) => s.toggleRun)
  const preset = useStore((s) => s.preset)
  const setPreset = useStore((s) => s.setPreset)
  const lowLatency = useStore((s) => s.lowLatency)
  const setLowLatency = useStore((s) => s.setLowLatency)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)

  const running = runState === 'running'
  const starting = runState === 'starting'

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <div className="flex w-[104px] items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="text-accent">
          <circle cx="12" cy="12" r="2.2" fill="currentColor" />
          <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
        </svg>
        <span className="text-[15px] font-semibold tracking-tight">Surround</span>
      </div>

      <button
        onClick={() => void toggleRun()}
        disabled={starting}
        className={cx(
          'inline-flex h-9 min-w-[124px] items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors',
          running
            ? 'border-err/60 bg-err/10 text-err hover:bg-err/20'
            : 'border-accent bg-accent text-accent-fg hover:brightness-110',
          starting && 'opacity-60',
        )}
      >
        {running ? <IconStop width={14} height={14} /> : <IconPlay width={14} height={14} />}
        {starting ? 'Başlıyor…' : running ? 'Durdur' : 'Başlat'}
      </button>

      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-faint xl:inline">Düzen</span>
        <Segmented value={preset} options={PRESETS} onChange={setPreset} />
      </div>

      <Tip text="Bluetooth/ağ cihazlarını devre dışı bırakır">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
          <Switch checked={lowLatency} onChange={setLowLatency} label="Düşük gecikme" />
          <span className="whitespace-nowrap">Düşük gecikme</span>
        </label>
      </Tip>

      <div className="ml-auto flex items-center gap-3">
        <StatusPill />
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
          title={theme === 'dark' ? 'Açık tema' : 'Koyu tema'}
          className="flex h-8 w-8 items-center justify-center rounded border border-line-strong text-muted hover:text-fg"
        >
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </div>
    </header>
  )
}
