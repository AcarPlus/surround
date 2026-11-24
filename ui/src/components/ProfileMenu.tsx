import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { selectActiveProfile, selectProfileModified, useStore } from '../store/useStore'
import { IconCheck, IconChevron } from './icons'
import { cx } from './ui'

/** Üst çubuktaki profil seçici: tek tıkla açılır, bir tıkla profil uygulanır. */
export function ProfileMenu() {
  const profiles = useStore((s) => s.profiles)
  const active = useStore(selectActiveProfile)
  const modified = useStore(selectProfileModified)
  const selectProfile = useStore((s) => s.selectProfile)
  const updateActiveProfile = useStore((s) => s.updateActiveProfile)
  const setScreen = useStore((s) => s.setScreen)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Yerleşik dört profil (Film/Oyun/Müzik/Flat) tek dokunuşla; seçili profil başka biriyse o da görünür.
  const quick = profiles.slice(0, 4)
  if (active && !quick.some((p) => p.id === active.id)) quick.push(active)

  return (
    <div ref={root} className="flex items-center">
      <div role="group" aria-label="Ses profili" className="flex gap-0.5 rounded-xl border border-line bg-bg/40 p-1 backdrop-blur-sm">
        {quick.map((p) => {
          const on = p.id === active?.id
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => !on && selectProfile(p.id)}
              title={on && modified ? 'Profil değiştirildi (kaydedilmedi)' : p.name}
              className={cx(
                'relative flex h-8 max-w-[120px] items-center gap-1 rounded-lg px-3.5 text-[13px] font-semibold transition-colors duration-300',
                on ? 'text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {on && (
                <motion.span
                  layoutId="profile-pill"
                  transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                  aria-hidden
                  className="chip-aurora absolute inset-0 rounded-lg border"
                />
              )}
              <span className="relative truncate">{p.name}</span>
              {on && modified && (
                <span aria-label="değiştirildi" className="relative text-warn">
                  •
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Tüm profiller"
        title="Tüm profiller"
        className={cx(
          'ml-1 flex h-9 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:text-fg',
          open && 'text-accent',
        )}
      >
        <IconChevron className={cx('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Profiller"
          className="glass-card screen-in absolute right-0 top-full z-50 mt-1.5 w-[220px] p-1 shadow-[var(--shadow)]"
        >
          {profiles.map((p) => {
            const isActive = p.id === active?.id
            return (
              <button
                key={p.id}
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  selectProfile(p.id)
                  setOpen(false)
                }}
                className={cx(
                  'flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] transition-colors hover:bg-surface',
                  isActive ? 'text-fg' : 'text-muted hover:text-fg',
                )}
              >
                <span className="flex w-4 shrink-0 justify-center text-accent">{isActive && <IconCheck width={14} height={14} />}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {isActive && modified && <span className="text-warn">•</span>}
              </button>
            )
          })}
          <div className="my-1 border-t border-line" />
          {active && modified && (
            <button
              role="menuitem"
              onClick={() => {
                updateActiveProfile()
                setOpen(false)
              }}
              className="flex h-8 w-full items-center rounded px-2 text-left text-[13px] text-warn hover:bg-surface"
            >
              “{active.name}” profilini güncelle
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setScreen('settings')
              setOpen(false)
            }}
            className="flex h-8 w-full items-center rounded px-2 text-left text-[13px] text-muted hover:bg-surface hover:text-fg"
          >
            Profilleri yönet…
          </button>
        </div>
      )}
      </div>
    </div>
  )
}
