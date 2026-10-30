import type { ReactNode } from 'react'
import { useStore, type Screen } from '../store/useStore'
import { IconDevices, IconEq, IconMic, IconRoom, IconSource } from './icons'
import { cx } from './ui'

const ITEMS: { id: Screen; label: string; icon: ReactNode }[] = [
  { id: 'room', label: 'Oda', icon: <IconRoom /> },
  { id: 'devices', label: 'Cihazlar', icon: <IconDevices /> },
  { id: 'source', label: 'Kaynak', icon: <IconSource /> },
  { id: 'sound', label: 'Ses', icon: <IconEq /> },
  { id: 'calibration', label: 'Kalibrasyon', icon: <IconMic /> },
]

export function NavRail() {
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  return (
    <nav aria-label="Ana gezinme" className="flex w-[76px] shrink-0 flex-col gap-1 border-r border-line bg-surface px-2 py-3">
      {ITEMS.map((it) => {
        const active = screen === it.id
        return (
          <button
            key={it.id}
            onClick={() => setScreen(it.id)}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'relative flex flex-col items-center gap-1 rounded-md py-2 text-[11px] font-medium transition-colors',
              active ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg',
            )}
          >
            {active && <span className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-r bg-accent" />}
            <span className={active ? 'text-accent' : ''}>{it.icon}</span>
            {it.label}
          </button>
        )
      })}
    </nav>
  )
}
