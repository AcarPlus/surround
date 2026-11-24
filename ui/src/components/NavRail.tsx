import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
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

/** Seçili sekmenin arkasındaki cam hap: sekmeler arasında yaylanarak kayar (Aurora hareket dili). */
const PILL_SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 } as const

export function NavRail() {
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  return (
    <nav aria-label="Ana gezinme" className="glass stagger flex w-[84px] shrink-0 flex-col items-center gap-1.5 border-r border-line/60 py-4">
      {[...ITEMS, SETTINGS_ITEM].map((it) => {
        const active = screen === it.id
        return (
          <button
            key={it.id}
            onClick={() => setScreen(it.id)}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'group relative flex h-[58px] w-[64px] flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium transition-colors duration-300',
              it.id === 'settings' && 'mt-auto',
              active ? 'text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-pill"
                transition={PILL_SPRING}
                aria-hidden
                className="absolute inset-0 rounded-2xl border border-accent/40 bg-[linear-gradient(160deg,rgb(var(--aurora-1)/0.2),rgb(var(--aurora-2)/0.16)_60%,rgb(var(--aurora-3)/0.12))] shadow-[0_0_26px_-4px_rgb(var(--aurora-1)/0.5),inset_0_1px_0_rgb(255_255_255/0.08)]"
              />
            )}
            {active && (
              <motion.span
                layoutId="nav-tick"
                transition={PILL_SPRING}
                aria-hidden
                className="absolute -left-[10px] top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-full bg-[linear-gradient(180deg,rgb(var(--aurora-1)),rgb(var(--aurora-2)))] shadow-[0_0_10px_rgb(var(--aurora-1))]"
              />
            )}
            <span
              className={cx(
                'relative transition-transform duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] group-hover:-translate-y-0.5 group-active:scale-90',
                active && 'text-accent drop-shadow-[0_0_8px_rgb(var(--accent)/0.7)]',
              )}
            >
              {it.icon}
            </span>
            <span className="relative">{it.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
