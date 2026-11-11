import { useState } from 'react'
import {
  PEQ_FREQ_MAX,
  PEQ_FREQ_MIN,
  PEQ_GAIN_MAX,
  PEQ_MAX_BANDS,
  PEQ_Q_MAX,
  PEQ_Q_MIN,
  PEQ_TYPE_LABELS,
  newPeqId,
  type PeqBand,
  type PeqType,
} from '../api/types'
import { Button, NumberField, Select, Switch, cx } from './ui'
import { IconChevron } from './icons'

const SUGGESTED_FREQS = [1000, 250, 4000, 100, 8000, 2000]

/** Yeni bant: henüz kullanılmayan bir frekansta, 0 dB (eğriyi değiştirmez; noktayı sürükleyip ayarla). */
export function newPeqBand(existing: readonly PeqBand[]): PeqBand {
  const used = new Set(existing.map((b) => Math.round(b.freqHz)))
  const freqHz = SUGGESTED_FREQS.find((f) => !used.has(f)) ?? 1000
  return { id: newPeqId(), type: 'peak', freqHz, gainDb: 0, q: 1 }
}

/**
 * "Parametrik bantlar": en fazla 6 bant; tür, frekans, kazanç, Q. Aynı bantlar eğri üzerinde sürüklenebilir
 * (bkz. EqCurve). Katlanabilir; bant varken açık başlar.
 */
export function PeqEditor({
  bands,
  onChange,
  selectedId,
  onSelect,
  compact,
  title = 'Parametrik bantlar',
}: {
  bands: PeqBand[]
  onChange: (next: PeqBand[]) => void
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  compact?: boolean
  title?: string
}) {
  const [open, setOpen] = useState(bands.length > 0)
  const patch = (id: string | undefined, p: Partial<PeqBand>) => onChange(bands.map((b) => (b.id === id ? { ...b, ...p } : b)))

  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between gap-2 px-3 text-left text-[13px] font-medium"
      >
        <span>
          {title}
          <span className="ml-2 text-xs font-normal text-faint">
            {bands.length > 0 ? `${bands.length}/${PEQ_MAX_BANDS} bant` : 'yok'}
          </span>
        </span>
        <IconChevron className={cx('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          {bands.length === 0 && (
            <p className="text-xs text-faint">
              Belirli bir frekansı yükseltmek/kısmak için bant ekle. Noktayı eğri üzerinde sürükleyebilirsin: yatay = frekans,
              dikey = kazanç, fare tekerleği = Q (genişlik).
            </p>
          )}
          {bands.map((b, i) => {
            const on = b.enabled !== false
            const sel = selectedId === b.id
            return (
              <div
                key={b.id ?? i}
                className={cx(
                  'rounded-md border p-2',
                  sel ? 'border-accent' : 'border-line',
                  !on && 'opacity-60',
                )}
                onFocusCapture={() => onSelect?.(b.id ?? null)}
                onPointerDownCapture={() => onSelect?.(b.id ?? null)}
              >
                <div className="flex items-center gap-2">
                  <Switch checked={on} onChange={(v) => patch(b.id, { enabled: v ? undefined : false })} label={`Bant ${i + 1} açık`} />
                  <Select
                    ariaLabel={`Bant ${i + 1} türü`}
                    value={b.type}
                    onChange={(v) => patch(b.id, { type: v as PeqType })}
                    className="!h-7 flex-1"
                  >
                    {(Object.keys(PEQ_TYPE_LABELS) as PeqType[]).map((t) => (
                      <option key={t} value={t}>
                        {PEQ_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    aria-label={`Bant ${i + 1}'i kaldır`}
                    title="Bandı kaldır"
                    className="h-7 w-7 shrink-0 rounded text-muted hover:bg-raised hover:text-fg"
                    onClick={() => onChange(bands.filter((x) => x.id !== b.id))}
                  >
                    ×
                  </button>
                </div>
                <div className={cx('mt-1.5 grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-3')}>
                  <LabeledNumber label="Frekans">
                    <NumberField
                      ariaLabel={`Bant ${i + 1} frekansı`}
                      value={b.freqHz}
                      min={PEQ_FREQ_MIN}
                      max={PEQ_FREQ_MAX}
                      step={10}
                      decimals={0}
                      unit="Hz"
                      onChange={(freqHz) => patch(b.id, { freqHz })}
                    />
                  </LabeledNumber>
                  <LabeledNumber label="Kazanç">
                    <NumberField
                      ariaLabel={`Bant ${i + 1} kazancı`}
                      value={b.gainDb}
                      min={-PEQ_GAIN_MAX}
                      max={PEQ_GAIN_MAX}
                      step={0.5}
                      decimals={1}
                      unit="dB"
                      onChange={(gainDb) => patch(b.id, { gainDb })}
                    />
                  </LabeledNumber>
                  <LabeledNumber label="Q">
                    <NumberField
                      ariaLabel={`Bant ${i + 1} Q değeri`}
                      value={b.q}
                      min={PEQ_Q_MIN}
                      max={PEQ_Q_MAX}
                      step={0.1}
                      decimals={2}
                      onChange={(q) => patch(b.id, { q })}
                    />
                  </LabeledNumber>
                </div>
              </div>
            )
          })}
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              disabled={bands.length >= PEQ_MAX_BANDS}
              onClick={() => {
                const nb = newPeqBand(bands)
                onChange([...bands, nb])
                onSelect?.(nb.id ?? null)
              }}
            >
              Bant ekle
            </Button>
            {bands.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => onChange([])}>
                Hepsini kaldır
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LabeledNumber({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-faint">{label}</span>
      {children}
    </label>
  )
}
