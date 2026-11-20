import { useMemo, useState } from 'react'
import type { Speaker } from '../api/types'
import { useStore } from '../store/useStore'
import { computeAuto, primaryChannel } from '../lib/geometry'
import { effectiveRole, roleLabel } from '../lib/roles'
import { deviceColorVar } from '../lib/colors'
import { fmt } from '../lib/format'
import type { Anchor } from './RoomStage'
import { IconCheck, IconTrash, IconVolume, IconX } from './icons'
import { cx } from './ui'

const W = 296
const H = 410

/** Seçili hoparlörün yanında açılan kısa ayar paneli; ayrıntılı ayarlar `onDetails` ile açılır. */
export function SpeakerPopover({ speaker: s, anchor, onDetails }: { speaker: Speaker; anchor: Anchor; onDetails: () => void }) {
  const devices = useStore((st) => st.devices)
  const source = useStore((st) => st.source)
  const room = useStore((st) => st.room)
  const speakers = useStore((st) => st.speakers)
  const auto = useStore((st) => st.auto[s.id])
  const playing = useStore((st) => st.playing)
  const select = useStore((st) => st.select)
  const updateSpeaker = useStore((st) => st.updateSpeaker)
  const setAuto = useStore((st) => st.setAuto)
  const removeSpeaker = useStore((st) => st.removeSpeaker)
  const playTone = useStore((st) => st.playTone)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dist = useMemo(() => computeAuto(speakers, room.listener).byId[s.id]?.distance ?? 0, [speakers, room.listener, s.id])
  const dev = devices.find((d) => d.id === s.outputDeviceId)
  // Hoparlörün çalacağı cihaz: kaynak (VB-Cable) ve sanal kablolar hariç tüm çıkışlar, Bluetooth dahil.
  const targets = devices.filter((d) => d.flow === 'render' && d.id !== source.deviceId && !/cable/i.test(d.name))
  const channels = dev?.channels ?? 2
  const clash = speakers.some((o) => o.id !== s.id && o.outputDeviceId === s.outputDeviceId && o.deviceChannel === s.deviceChannel)
  const color = deviceColorVar(s.outputDeviceId, devices)
  const ch = primaryChannel(s.source)

  // Sağda yer yoksa sola aç; dikeyde sahnenin içinde kal.
  const right = anchor.x + 44 + W < anchor.w - 8
  const left = right ? anchor.x + 44 : Math.max(8, anchor.x - 44 - W)
  const top = Math.max(8, Math.min(anchor.h - H - 8, anchor.y - 72))

  const gainPct = ((s.gainDb + 24) / 36) * 100
  const status = s.calibratedAt
    ? s.roomEq?.length
      ? 'Ölçüldü · tını eşlendi'
      : 'Ölçüldü'
    : auto?.delay && auto?.gain
      ? 'Mesafeden hesaplandı'
      : 'Elle ayarlandı'

  return (
    <div
      role="dialog"
      aria-label={`${s.name} ayarları`}
      className="screen-in absolute z-20 flex flex-col gap-3.5 rounded-2xl border border-line-strong bg-surface/95 p-4 shadow-[0_30px_70px_rgb(0_0_0/0.55)] backdrop-blur-md"
      style={{ left, top, width: W }}
    >
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{s.name}</span>
        <button
          type="button"
          aria-label="Kapat"
          onClick={() => select(null)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-fg"
        >
          <IconX width={13} height={13} />
        </button>
      </div>
      <p className="-mt-2.5 truncate text-xs text-muted">
        {roleLabel(effectiveRole(s))}
        {ch ? ` (${ch})` : ''}
        {!dev && ' · cihaz bağlı değil'}
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] text-muted">Çalan cihaz</span>
          <select
            value={s.outputDeviceId}
            aria-label={`${s.name} çıkış cihazı`}
            onChange={(e) => {
              const nd = devices.find((x) => x.id === e.target.value)
              updateSpeaker(s.id, { outputDeviceId: e.target.value, deviceChannel: Math.min(s.deviceChannel, nd?.channels ?? 1) })
            }}
            className="h-9 w-full truncate rounded-xl border border-line-strong bg-bg px-2.5 text-[13px] outline-none focus:border-accent"
          >
            {!dev && <option value={s.outputDeviceId}>Bağlı değil</option>}
            {targets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name.split(' (')[0]}
                {d.kind === 'bluetooth' ? ' · Bluetooth' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={cx('text-[11px]', clash ? 'text-warn' : 'text-muted')}>{clash ? 'Kanal çakışıyor' : 'Kanal'}</span>
          <select
            value={s.deviceChannel}
            aria-label={`${s.name} cihaz kanalı`}
            onChange={(e) => updateSpeaker(s.id, { deviceChannel: Number(e.target.value) })}
            className={cx(
              'h-9 w-full rounded-xl border bg-bg px-2.5 text-[13px] outline-none focus:border-accent',
              clash ? 'border-warn' : 'border-line-strong',
            )}
          >
            {Array.from({ length: channels }, (_, i) => (
              <option key={i} value={i + 1}>
                {channels === 2 ? (i === 0 ? 'Sol' : 'Sağ') : `Kanal ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-2">
        <span className="flex justify-between text-xs text-muted">
          Seviye
          <span className="num text-fg">
            {s.gainDb > 0 ? '+' : s.gainDb < 0 ? '−' : ''}
            {fmt(Math.abs(s.gainDb), 1)} dB
          </span>
        </span>
        <input
          type="range"
          min={-24}
          max={12}
          step={0.5}
          value={s.gainDb}
          aria-label={`${s.name} seviyesi`}
          style={{ ['--fill' as string]: `${gainPct}%` }}
          onChange={(e) => {
            if (auto?.gain) setAuto(s.id, { gain: false })
            updateSpeaker(s.id, { gainDb: Number(e.target.value) })
          }}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <Stat k="Gecikme" v={`${fmt(s.delayMs, 1)} ms`} />
        <Stat k="Mesafe" v={`${fmt(dist, 2)} m`} />
      </div>

      <p className={cx('flex items-center gap-1.5 text-xs', s.calibratedAt ? 'text-ok' : 'text-muted')}>
        {s.calibratedAt && <IconCheck width={13} height={13} />}
        {status}
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void playTone(s.id)}
          disabled={!!playing}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-raised text-[13px] font-medium hover:border-accent/60 disabled:opacity-50"
        >
          <IconVolume width={14} height={14} /> {playing === s.id ? 'Çalıyor…' : 'Test sesi'}
        </button>
        <button
          type="button"
          onClick={() => updateSpeaker(s.id, { mute: !s.mute })}
          className="h-9 flex-1 rounded-xl border border-line-strong bg-raised text-[13px] font-medium hover:border-accent/60"
        >
          {s.mute ? 'Sesi aç' : 'Sustur'}
        </button>
        <button
          type="button"
          aria-label={confirmDelete ? `${s.name} silinsin mi? Onaylamak için tekrar bas` : `${s.name} hoparlörünü kaldır`}
          title={confirmDelete ? 'Silmek için tekrar bas' : 'Kaldır'}
          onClick={() => (confirmDelete ? removeSpeaker(s.id) : setConfirmDelete(true))}
          onBlur={() => setConfirmDelete(false)}
          className={cx(
            'flex h-9 items-center justify-center rounded-xl border text-err transition-all',
            confirmDelete ? 'w-20 border-err bg-err/15 text-[12px] font-semibold' : 'w-10 border-line-strong bg-raised hover:border-err/60',
          )}
        >
          {confirmDelete ? 'Sil' : <IconTrash width={15} height={15} />}
        </button>
      </div>

      <button type="button" onClick={onDetails} className="-mb-1 self-start text-xs font-medium text-accent hover:underline">
        Tüm ayarlar (kanal, EQ, bas) →
      </button>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-bg px-3 py-2">
      <span className="text-[11px] text-muted">{k}</span>
      <span className="num text-[14px] font-medium">{v}</span>
    </div>
  )
}
