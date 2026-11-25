import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { cx } from './ui'

/** Kalıcı pencere: arka plana tıklama veya Esc kapatır (closable değilse kapatmaz). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
  closable = true,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
  closable?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  // onClose çoğu yerde satır içi oktur (her çizimde yeni); etkiye bağımlı olsaydı her tuş vuruşunda odak kutuya
  // geri sıçrardı. Güncel hali ref'te tutulur.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closable) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const prev = document.activeElement as HTMLElement | null
    if (!box.current?.contains(document.activeElement)) box.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prev?.focus?.()
    }
  }, [open, closable])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && closable) onClose()
          }}
        >
          <motion.div
            ref={box}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className="flex max-h-full w-full flex-col rounded-lg border border-line-strong bg-surface shadow-[var(--shadow)] outline-none"
            style={{ maxWidth: width }}
            initial={{ y: 8, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            <div className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">{title}</div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export interface MenuItem {
  label: ReactNode
  hint?: string
  onSelect: () => void
  disabled?: boolean
  /** Bölüm başlığı (tıklanamaz). */
  header?: boolean
}

/** Açılır menü: tetikleyici düğme + liste. */
export function Menu({
  trigger,
  items,
  align = 'left',
  className,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode
  items: MenuItem[]
  align?: 'left' | 'right'
  className?: string
}) {
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
    <div ref={root} className={cx('relative', className)}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute top-full z-40 mt-1 max-h-[60vh] min-w-[220px] overflow-y-auto rounded-md border border-line-strong bg-raised py-1 shadow-[var(--shadow)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((it, i) =>
            it.header ? (
              <div key={i} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                {it.label}
              </div>
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.onSelect()
                }}
                className="flex w-full flex-col items-start px-3 py-1.5 text-left text-[13px] hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span>{it.label}</span>
                {it.hint && <span className="text-xs text-faint">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
