import { motion } from 'framer-motion'
import { useState } from 'react'
import { useStore, type LayoutPreview } from '../store/useStore'
import { countLayout, formatLayout, parseLayout, type LayoutSpec } from '../lib/layout'
import { Dialog } from './Dialog'
import { Button, cx } from './ui'

export const LAYOUT_TEMPLATES = ['2.0', '2.1', '3.1', '5.1', '7.1', '5.1.2', '7.1.4']

/**
 * Düzen çipleri: tek tıkla şablona geçer. Hiçbir hoparlör silinmeyecekse hemen uygulanır, silinecekse önce sorulur.
 * Elle kurulan düzen şablona uymuyorsa "Özel" çipi gerçek sayımı gösterir.
 */
export function LayoutPicker() {
  const speakers = useStore((s) => s.speakers)
  const previewLayout = useStore((s) => s.previewLayout)
  const applyLayout = useStore((s) => s.applyLayout)
  const [pending, setPending] = useState<{ spec: LayoutSpec; label: string; preview: LayoutPreview } | null>(null)
  const [custom, setCustom] = useState<string | null>(null)
  const [customErr, setCustomErr] = useState<string | null>(null)

  const current = formatLayout(countLayout(speakers))
  const isTemplate = LAYOUT_TEMPLATES.includes(current)

  const choose = (text: string) => {
    const r = parseLayout(text)
    if (!r.ok) {
      setCustomErr(r.error)
      return
    }
    setCustom(null)
    setCustomErr(null)
    const preview = previewLayout(r.spec)
    if (preview.removed.length === 0) applyLayout(r.spec)
    else setPending({ spec: r.spec, label: formatLayout(r.spec), preview })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Hoparlör düzeni">
      <span className="mr-1.5 text-[11px] font-medium tracking-[0.08em] text-muted">DÜZEN</span>
      {LAYOUT_TEMPLATES.map((t) => {
        const on = speakers.length > 0 && current === t
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            onClick={() => !on && choose(t)}
            className={cx(
              'num relative h-8 rounded-lg border px-3 text-xs font-semibold transition-colors duration-300',
              on ? 'border-transparent text-fg' : 'border-line bg-surface/60 text-fg/80 backdrop-blur-sm hover:border-accent/40 hover:text-fg',
            )}
          >
            {on && (
              <motion.span
                layoutId="layout-pill"
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                aria-hidden
                className="chip-aurora absolute -inset-px rounded-lg border"
              />
            )}
            <span className="relative">{t}</span>
          </button>
        )
      })}
      {speakers.length > 0 && !isTemplate && (
        <span className="num chip-aurora flex h-8 items-center rounded-lg border px-3 text-xs font-semibold">
          Özel · {current}
        </span>
      )}
      <button
        type="button"
        onClick={() => setCustom('')}
        className="h-8 rounded-lg px-2.5 text-xs font-medium text-muted hover:bg-surface hover:text-fg"
      >
        Başka…
      </button>

      <Dialog
        open={custom !== null}
        onClose={() => {
          setCustom(null)
          setCustomErr(null)
        }}
        title="Düzen yaz"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCustom(null)}>
              Vazgeç
            </Button>
            <Button variant="primary" onClick={() => choose(custom ?? '')} disabled={!custom?.trim()}>
              Devam
            </Button>
          </>
        }
      >
        <p className="mb-2 text-[13px] text-muted">Zemin.sub.üst hoparlör sayısı, örneğin 5.1 ya da 5.1.2.</p>
        <input
          autoFocus
          aria-label="Düzen"
          value={custom ?? ''}
          onChange={(e) => {
            setCustom(e.target.value)
            setCustomErr(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && choose(custom ?? '')}
          placeholder="5.1.2"
          className={cx(
            'num h-9 w-32 rounded-lg border bg-surface px-2.5 text-[13px] outline-none focus:border-accent',
            customErr ? 'border-err' : 'border-line-strong',
          )}
        />
        {customErr && <p className="mt-1.5 text-xs text-err">{customErr}</p>}
      </Dialog>

      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending ? `${pending.label} düzenine geç` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Vazgeç
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pending) applyLayout(pending.spec)
                setPending(null)
              }}
            >
              Uygula ({pending?.preview.removed.length ?? 0} hoparlör kaldırılacak)
            </Button>
          </>
        }
      >
        {pending && <PreviewBody p={pending.preview} />}
      </Dialog>
    </div>
  )
}

function PreviewBody({ p }: { p: LayoutPreview }) {
  const block = (title: string, names: string[], tone: string) =>
    names.length > 0 && (
      <div>
        <h3 className={cx('mb-1 text-xs font-semibold', tone)}>
          {title} ({names.length})
        </h3>
        <p className="text-[13px]">{names.join(', ')}</p>
      </div>
    )
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        Hoparlörler önce rolüne, sonra konumuna göre yeni yuvalara eşlenir; cihaz, EQ ve bas ayarları korunur.
      </p>
      {block('Korunacak', p.kept, 'text-ok')}
      {block('Eklenecek', p.added, 'text-accent')}
      {block('Kaldırılacak', p.removed, 'text-err')}
      <p className="text-xs text-faint">Uyguladıktan sonra Ctrl+Z ile geri alabilirsin.</p>
    </div>
  )
}
