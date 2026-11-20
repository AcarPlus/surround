import type { ReactNode } from 'react'
import { useStore, type Screen } from '../store/useStore'
import { IconEq, IconGear, IconMic, IconRoom } from './icons'
import { cx } from './ui'

const ITEMS: { id: Screen; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Oda', icon: <IconRoom /> },
  { id: 'sound', label: 'Ses', icon: <IconEq /> },
  { id: 'calibration', label: 'Ölçüm', icon: <IconMic /> },
]

/** Alta sabitlenir. */
const SETTINGS_ITEM: { id: Screen; label: string; icon: ReactNode } = { id: 'settings', label: 'Ayarlar', icon: <IconGear /> }

export function NavRail() {
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  return (
    <nav aria-label="Ana gezinme" className="glass flex w-[84px] shrink-0 flex-col items-center gap-1.5 border-r border-line/70 py-4">
      {[...ITEMS, SETTINGS_ITEM].map((it) => {
        const active = screen === it.id
        return (
          <button
            key={it.id}
            onClick={() => setScreen(it.id)}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex h-[58px] w-[64px] flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium transition-colors',
              it.id === 'settings' && 'mt-auto',
              active
                ? 'bg-accent/[0.14] text-accent shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.25),0_0_24px_rgb(var(--accent)/0.18)]'
                : 'text-muted hover:bg-raised/60 hover:text-fg',
            )}
          >
            {it.icon}
            {it.label}
          </button>
        )
      })}
    </nav>
  )
}
