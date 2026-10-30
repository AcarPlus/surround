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

  return (
    <div ref={root} className="flex items-center gap-2">
      <span className="hidden text-xs text-faint xl:inline">Profil</span>
      <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={modified ? 'Profil değiştirildi (kaydedilmedi)' : 'Profil seç'}
        className={cx(
          'inline-flex h-8 w-[132px] items-center justify-between gap-1.5 rounded border bg-surface px-2.5 text-[13px] font-medium transition-colors',
          open ? 'border-accent' : 'border-line-strong hover:border-muted',
        )}
      >
        <span className={cx('flex min-w-0 items-center gap-1', !active && 'text-muted')}>
          <span className="truncate">{active ? active.name : 'Profil yok'}</span>
          {active && modified && (
            <span aria-label="değiştirildi" className="text-warn">
              •
            </span>
          )}
        </span>
        <IconChevron className={cx('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Profiller"
          className="absolute left-0 top-full z-50 mt-1.5 w-[220px] rounded-lg border border-line-strong bg-raised p-1 shadow-[var(--shadow)]"
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
