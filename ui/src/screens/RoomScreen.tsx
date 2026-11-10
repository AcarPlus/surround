import { useEffect, useMemo, useState } from 'react'
import { useStore, type LayoutPreview } from '../store/useStore'
import { countLayout, formatLayout, parseLayout, type LayoutSpec } from '../lib/layout'
import { ROLES, effectiveRole } from '../lib/roles'
import { Button, NumberField, cx } from '../components/ui'
import { Dialog, Menu, type MenuItem } from '../components/Dialog'
import { RoomCanvas } from '../components/RoomCanvas'
import { IconChevron, IconPlus, IconVolume, IconWand } from '../components/icons'

const TEMPLATES = ['2.0', '2.1', '3.1', '4.0', '4.1', '5.1', '7.1', '5.1.2', '7.1.4']

export function RoomScreen() {
  const room = useStore((s) => s.room)
  const speakers = useStore((s) => s.speakers)
  const playing = useStore((s) => s.playing)
  const setRoomSize = useStore((s) => s.setRoomSize)
  const addSpeaker = useStore((s) => s.addSpeaker)
  const autoAll = useStore((s) => s.autoAll)
  const previewLayout = useStore((s) => s.previewLayout)
  const applyLayout = useStore((s) => s.applyLayout)
  const openWizard = useStore((s) => s.openWizard)
  const playTour = useStore((s) => s.playTour)
  const stopTour = useStore((s) => s.stopTour)
  // Bu ekrandan başlatılan "sırayla çal" ekrandan çıkınca dursun.
  useEffect(() => () => useStore.getState().stopTour(), [])

  const current = useMemo(() => formatLayout(countLayout(speakers)), [speakers])
  const [pending, setPending] = useState<{ spec: LayoutSpec; label: string; preview: LayoutPreview } | null>(null)
  const [custom, setCustom] = useState('')
  const [customErr, setCustomErr] = useState<string | null>(null)

  const ask = (text: string) => {
    const r = parseLayout(text)
    if (!r.ok) {
      setCustomErr(r.error)
      return
    }
    setCustomErr(null)
    setPending({ spec: r.spec, label: formatLayout(r.spec), preview: previewLayout(r.spec) })
  }

  const used = new Set(speakers.map((s) => effectiveRole(s)))
  const roleItems = (filter: (r: (typeof ROLES)[number]) => boolean): MenuItem[] =>
    ROLES.filter(filter).map((r) => ({
      label: used.has(r.id) ? r.label : <span className="font-medium">{r.label}</span>,
      hint: used.has(r.id) ? 'zaten var' : undefined,
      onSelect: () => addSpeaker(r.id),
    }))
  const addItems: MenuItem[] = [
    { header: true, label: 'Zemin', onSelect: () => {} },
    ...roleItems((r) => !r.elevated && !r.bassReceiver),
    { header: true, label: 'Bas', onSelect: () => {} },
    ...roleItems((r) => !!r.bassReceiver),
    { header: true, label: 'Üst', onSelect: () => {} },
    ...roleItems((r) => !!r.elevated),
    { header: true, label: 'Diğer', onSelect: () => {} },
    { label: 'Rolsüz hoparlör', hint: 'Boş kalan kanala atanır', onSelect: () => addSpeaker() },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Oda</span>
          <NumberField ariaLabel="Oda genişliği (m)" className="w-[76px]" value={room.widthM} min={2} max={20} step={0.5} unit="m" onChange={(v) => setRoomSize(v, room.depthM)} />
          <span className="text-faint">×</span>
          <NumberField ariaLabel="Oda derinliği (m)" className="w-[76px]" value={room.depthM} min={2} max={20} step={0.5} unit="m" onChange={(v) => setRoomSize(room.widthM, v)} />
        </div>
        <span className="num rounded border border-line px-2 py-0.5 text-xs text-muted" title="Zemin.sub.üst hoparlör sayısı">
          {current}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={openWizard} title="Cihazlara ne bağlı olduğunu sorarak yeniden kur">
            Sihirbaz
          </Button>
          <Menu
            align="right"
            trigger={({ toggle, open }) => (
              <Button size="sm" onClick={toggle} aria-expanded={open}>
                Düzen şablonu <IconChevron width={12} height={12} />
              </Button>
            )}
            items={[
              { header: true, label: 'Önce önizlenir, sonra uygulanır', onSelect: () => {} },
              ...TEMPLATES.map((t) => ({ label: <span className="num">{t}</span>, onSelect: () => ask(t) })),
              { label: 'Başka bir düzen…', hint: 'X.Y veya X.Y.Z yaz', onSelect: () => setPending({ spec: { floor: 0, sub: 0, height: 0 }, label: '', preview: { kept: [], added: [], removed: [] } }) },
            ]}
          />
          <Button size="sm" onClick={autoAll} title="Tüm gecikme ve kazançları mesafeden hesapla (ölçülen değerler de mesafeye döner)">
            <IconWand /> Mesafeden hesapla
          </Button>
          <Button size="sm" onClick={() => (playing ? stopTour() : void playTour())} disabled={speakers.length === 0} title="Her hoparlörden sırayla test sesi çalar">
            <IconVolume /> {playing ? 'Durdur' : 'Sırayla çal'}
          </Button>
          <Menu
            align="right"
            items={addItems}
            trigger={({ toggle, open }) => (
              <Button size="sm" variant="primary" onClick={toggle} aria-expanded={open}>
                <IconPlus /> Hoparlör ekle
              </Button>
            )}
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <RoomCanvas />
        {speakers.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
            <p>Henüz hoparlör yok.</p>
            <Button variant="primary" onClick={openWizard}>
              Kurulum sihirbazını başlat
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={!!pending}
        onClose={() => {
          setPending(null)
          setCustom('')
          setCustomErr(null)
        }}
        title={pending?.label ? `${pending.label} düzenine geç` : 'Düzen yaz'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Vazgeç
            </Button>
            {pending?.label ? (
              <Button
                variant={pending.preview.removed.length ? 'danger' : 'primary'}
                onClick={() => {
                  applyLayout(pending.spec)
                  setPending(null)
                }}
              >
                {pending.preview.removed.length ? `Uygula (${pending.preview.removed.length} hoparlör silinecek)` : 'Uygula'}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => ask(custom)} disabled={!custom.trim()}>
                Önizle
              </Button>
            )}
          </>
        }
      >
        {pending && !pending.label ? (
          <div>
            <p className="mb-2 text-[13px] text-muted">Zemin.sub.üst hoparlör sayısı, örn. 5.1 veya 5.1.2.</p>
            <input
              autoFocus
              aria-label="Düzen"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value)
                setCustomErr(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && ask(custom)}
              placeholder="5.1.2"
              className={cx('num h-8 w-32 rounded border bg-surface px-2 text-[13px] outline-none focus:border-accent', customErr ? 'border-err' : 'border-line-strong')}
            />
            {customErr && <p className="mt-1.5 text-xs text-err">{customErr}</p>}
          </div>
        ) : (
          pending && <PreviewBody p={pending.preview} />
        )}
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
        Mevcut hoparlörler önce rolüne, sonra konumuna göre yeni yuvalara eşlenir; cihaz, EQ ve bas ayarları korunur.
      </p>
      {block('Korunacak', p.kept, 'text-ok')}
      {block('Eklenecek', p.added, 'text-accent')}
      {block('Silinecek', p.removed, 'text-err')}
      <p className="text-xs text-faint">Uyguladıktan sonra Ctrl+Z ile geri alabilirsin.</p>
    </div>
  )
}
