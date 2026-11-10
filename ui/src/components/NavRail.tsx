import type { ReactNode } from 'react'
import { useStore, type Screen } from '../store/useStore'
import { checkHealth } from '../lib/health'
import { IconEq, IconGear, IconHome, IconMic, IconPlug, IconRoom } from './icons'
import { cx } from './ui'

const ITEMS: { id: Screen; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Ana sayfa', icon: <IconHome /> },
  { id: 'room', label: 'Oda', icon: <IconRoom /> },
  { id: 'sound', label: 'Ses', icon: <IconEq /> },
  { id: 'calibration', label: 'Kalibrasyon', icon: <IconMic /> },
  { id: 'connection', label: 'Bağlantı', icon: <IconPlug /> },
]

/** Alta sabitlenir. */
const SETTINGS_ITEM: { id: Screen; label: string; icon: ReactNode } = { id: 'settings', label: 'Ayarlar', icon: <IconGear /> }

/** Ana sayfa simgesinde hata/uyarı sayısı rozeti. */
function useProblemCount(): { n: number; error: boolean } {
  const s = useStore()
  const items = checkHealth({
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
  })
  const bad = items.filter((i) => i.level !== 'info')
  return { n: bad.length, error: bad.some((i) => i.level === 'error') }
}

export function NavRail() {
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  const problems = useProblemCount()
  return (
    <nav aria-label="Ana gezinme" className="flex w-[84px] shrink-0 flex-col gap-1 border-r border-line bg-surface px-2 py-3">
      {[...ITEMS, SETTINGS_ITEM].map((it) => {
        const active = screen === it.id
        return (
          <button
            key={it.id}
            onClick={() => setScreen(it.id)}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'relative flex flex-col items-center gap-1 rounded-md py-2 text-[11px] font-medium transition-colors',
              it.id === 'settings' && 'mt-auto',
              active ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg',
            )}
          >
            {active && <span className="absolute -left-2 bottom-2 top-2 w-[3px] rounded-r bg-accent" />}
            <span className={cx('relative', active && 'text-accent')}>
              {it.icon}
              {it.id === 'home' && problems.n > 0 && (
                <span
                  className={cx(
                    'num absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-bg',
                    problems.error ? 'bg-err' : 'bg-warn',
                  )}
                  aria-label={`${problems.n} sorun`}
                >
                  {problems.n}
                </span>
              )}
            </span>
            {it.label}
          </button>
        )
      })}
    </nav>
  )
}
