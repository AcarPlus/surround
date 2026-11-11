import { useEffect, useRef, useState } from 'react'
import { MAX_PRESET_NAME, MAX_USER_PRESETS } from '../lib/presets'
import { Button } from './ui'

type Mode = null | 'save' | 'rename'

/**
 * Kullanıcı ön ayarı yönetimi: "Ön ayarı kaydet" (adla), seçili kullanıcı ön ayarı için üzerine yaz / yeniden adlandır / sil.
 * Ön ayar çipleri/listesi dışarıda çizilir; bu bileşen yalnızca eylem satırıdır.
 */
export function PresetManager({
  count,
  active,
  onSave,
  onOverwrite,
  onRename,
  onDelete,
  compact,
  saveLabel = 'Ön ayarı kaydet',
}: {
  count: number
  /** Etkin kullanıcı ön ayarı (yoksa null). */
  active: { id: string; name: string } | null
  onSave: (name: string) => boolean
  onOverwrite: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  compact?: boolean
  saveLabel?: string
}) {
  const [mode, setMode] = useState<Mode>(null)
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (mode) input.current?.focus()
  }, [mode])
  // Etkin ön ayar değişince açık düzenleme kapanır.
  useEffect(() => setMode(null), [active?.id])

  const full = count >= MAX_USER_PRESETS
  const submit = () => {
    if (mode === 'save') {
      if (onSave(name)) setMode(null)
    } else if (mode === 'rename' && active) {
      onRename(active.id, name)
      setMode(null)
    }
  }

  if (mode) {
    return (
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          ref={input}
          value={name}
          maxLength={MAX_PRESET_NAME}
          aria-label="Ön ayar adı"
          placeholder="Ön ayar adı"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setMode(null)}
          className="h-8 min-w-0 flex-1 rounded border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-accent"
        />
        <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
          {mode === 'save' ? 'Kaydet' : 'Adı değiştir'}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setMode(null)}>
          Vazgeç
        </Button>
      </form>
    )
  }

  return (
    <div className={compact ? 'mt-2 flex flex-wrap gap-1.5' : 'mt-3 flex flex-wrap gap-2'}>
      <Button
        size="sm"
        disabled={full}
        title={full ? `En fazla ${MAX_USER_PRESETS} ön ayar saklanır.` : undefined}
        onClick={() => {
          setName('')
          setMode('save')
        }}
      >
        {saveLabel}
      </Button>
      {active && (
        <>
          <Button size="sm" variant="ghost" onClick={() => onOverwrite(active.id)} title={`“${active.name}” ön ayarını geçerli ayarlarla değiştirir`}>
            Üzerine yaz
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setName(active.name)
              setMode('rename')
            }}
          >
            Yeniden adlandır
          </Button>
          <Button size="sm" variant="danger" onClick={() => onDelete(active.id)}>
            Sil
          </Button>
        </>
      )}
    </div>
  )
}
