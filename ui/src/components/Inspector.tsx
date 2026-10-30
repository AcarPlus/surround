import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LOGICAL_CHANNELS, flatEq, type Speaker } from '../api/types'
import { EqEditor } from './EqEditor'
import {
  CUSTOM_ID,
  CUSTOM_LABEL,
  SPEAKER_PRESETS,
  speakerPresetPatch,
  speakerPresetValue,
} from '../lib/presets'
import { LISTENER_ID, selectSpeaker, useStore } from '../store/useStore'
import { computeAuto } from '../lib/geometry'
import { deviceColorVar } from '../lib/colors'
import { fmt } from '../lib/format'
import { Badge, Button, Field, NumberField, SectionTitle, Select, Switch, cx } from './ui'
import { IconTrash, IconVolume, IconWarn } from './icons'

export function Inspector() {
  const selection = useStore((s) => s.selection)
  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-surface">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={selection ?? 'none'}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="p-4"
        >
          {selection === LISTENER_ID ? <ListenerPanel /> : selection ? <SpeakerPanel /> : <EmptyPanel />}
        </motion.div>
      </AnimatePresence>
    </aside>
  )
}

function EmptyPanel() {
  const room = useStore((s) => s.room)
  const speakers = useStore((s) => s.speakers)
  const { dMax } = computeAuto(speakers, room.listener)
  return (
    <div>
      <SectionTitle>Özet</SectionTitle>
      <dl className="mb-5 space-y-1.5 text-[13px]">
        <KV k="Oda" v={`${fmt(room.widthM, 1)} × ${fmt(room.depthM, 1)} m`} />
        <KV k="Hoparlör" v={String(speakers.length)} />
        <KV k="En uzak mesafe" v={`${fmt(dMax)} m`} />
        <KV k="Dinleyici" v={`${fmt(room.listener.x)}, ${fmt(room.listener.y)}`} />
      </dl>
      <p className="text-[13px] leading-relaxed text-muted">
        Ayarlarını görmek için odada bir hoparlör seç. Sürükleyerek taşıyabilir, ok tuşlarıyla 5 cm
        kaydırabilir, Delete ile silebilirsin.
      </p>
    </div>
  )
}

function ListenerPanel() {
  const room = useStore((s) => s.room)
  const move = useStore((s) => s.moveListener)
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Dinleyici</h2>
        <p className="mt-0.5 text-xs text-muted">Gecikme ve kazanç hesapları bu noktaya göre yapılır.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="X (m)">
          <NumberField value={room.listener.x} min={0} max={room.widthM} step={0.05} onChange={(v) => move(v, room.listener.y)} />
        </Field>
        <Field label="Y (m)">
          <NumberField value={room.listener.y} min={0} max={room.depthM} step={0.05} onChange={(v) => move(room.listener.x, v)} />
        </Field>
      </div>
    </div>
  )
}

function SpeakerPanel() {
  const sp = useStore(selectSpeaker)
  const devices = useStore((s) => s.devices)
  const room = useStore((s) => s.room)
  const speakers = useStore((s) => s.speakers)
  const auto = useStore((s) => s.auto)
  const lowLatency = useStore((s) => s.lowLatency)
  const updateSpeaker = useStore((s) => s.updateSpeaker)
  const setMix = useStore((s) => s.setMix)
  const setAuto = useStore((s) => s.setAuto)
  const removeSpeaker = useStore((s) => s.removeSpeaker)
  const playTone = useStore((s) => s.playTone)
  const [playing, setPlaying] = useState(false)

  if (!sp) return null
  const dev = devices.find((d) => d.id === sp.outputDeviceId)
  const renders = devices.filter((d) => d.flow === 'render')
  const a = auto[sp.id] ?? { delay: true, gain: true }
  const { dMax, byId } = computeAuto(speakers, room.listener)
  const d = byId[sp.id]?.distance ?? 0
  const disabled = lowLatency && dev?.kind === 'network'
  const clash = speakers.some(
    (o) => o.id !== sp.id && o.outputDeviceId === sp.outputDeviceId && o.deviceChannel === sp.deviceChannel,
  )

  const test = async () => {
    setPlaying(true)
    await playTone(sp.id)
    setPlaying(false)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: deviceColorVar(sp.outputDeviceId, devices) }}
        />
        <div className="min-w-0 flex-1">
          <input
            aria-label="Hoparlör adı"
            value={sp.name}
            onChange={(e) => updateSpeaker(sp.id, { name: e.target.value })}
            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold outline-none hover:border-line focus:border-accent"
          />
          <p className="px-1 text-xs text-muted">
            Dinleyiciye <span className="num text-fg">{fmt(d)} m</span> · konum{' '}
            <span className="num">
              {fmt(sp.x)}, {fmt(sp.y)}
            </span>
          </p>
        </div>
      </div>

      {disabled && (
        <div className="flex gap-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
          <IconWarn className="mt-px shrink-0" />
          Düşük gecikme modunda ağ cihazları devre dışı; bu hoparlör çalmaz.
        </div>
      )}

      <section>
        <SectionTitle>Çıkış</SectionTitle>
        <div className="space-y-3">
          <Field label="Cihaz">
            <Select
              ariaLabel="Çıkış cihazı"
              value={sp.outputDeviceId}
              onChange={(v) => {
                const nd = devices.find((x) => x.id === v)
                updateSpeaker(sp.id, {
                  outputDeviceId: v,
                  deviceChannel: Math.min(sp.deviceChannel, nd?.channels ?? 1),
                })
              }}
            >
              {renders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.channels} kn)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cihaz kanalı" hint={clash ? 'Başka hoparlörle çakışıyor' : undefined}>
            <Select
              ariaLabel="Cihaz kanalı"
              value={sp.deviceChannel}
              onChange={(v) => updateSpeaker(sp.id, { deviceChannel: Number(v) })}
              className={cx(clash && 'border-warn')}
            >
              {Array.from({ length: dev?.channels ?? 2 }, (_, i) => (
                <option key={i} value={i + 1}>
                  Kanal {i + 1}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      <section>
        <SectionTitle>Kanal karışımı</SectionTitle>
        <div className="space-y-1">
          {LOGICAL_CHANNELS.map((ch) => {
            const v = sp.source[ch] ?? 0
            return (
              <div key={ch} className="flex items-center gap-2">
                <span className={cx('num w-8 text-xs', v > 0 ? 'text-fg' : 'text-faint')}>{ch}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={v}
                  aria-label={`${ch} kazancı`}
                  style={{ ['--fill' as string]: `${v * 100}%` }}
                  onChange={(e) => setMix(sp.id, ch, Number(e.target.value))}
                />
                <NumberField
                  ariaLabel={`${ch} değeri`}
                  className="w-[58px]"
                  value={v}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(n) => setMix(sp.id, ch, n)}
                />
              </div>
            )
          })}
        </div>
      </section>

      <EqBassSection sp={sp} />

      <section>
        <SectionTitle
          right={<Badge tone={a.delay && a.gain ? 'accent' : 'neutral'}>{a.delay && a.gain ? 'Otomatik' : 'Elle'}</Badge>}
        >
          Zamanlama ve seviye
        </SectionTitle>
        <div className="space-y-3">
          <AutoRow
            label="Gecikme"
            auto={a.delay}
            onAuto={(v) => setAuto(sp.id, { delay: v })}
            value={sp.delayMs}
            unit="ms"
            min={0}
            max={500}
            step={0.1}
            onChange={(v) => updateSpeaker(sp.id, { delayMs: v })}
          />
          <AutoRow
            label="Kazanç"
            auto={a.gain}
            onAuto={(v) => setAuto(sp.id, { gain: v })}
            value={sp.gainDb}
            unit="dB"
            min={-60}
            max={12}
            step={0.5}
            decimals={1}
            onChange={(v) => updateSpeaker(sp.id, { gainDb: v })}
          />
          <p className="text-xs text-faint">
            Otomatik: en uzak hoparlör <span className="num">{fmt(dMax)} m</span> referans alınır;
            gecikme = (dMax − d) / 343 m/s, kazanç = 20·log₁₀(d / dMax).
          </p>
          <label className="flex items-center justify-between pt-1 text-[13px]">
            Sessize al
            <Switch checked={sp.mute} onChange={(v) => updateSpeaker(sp.id, { mute: v })} label="Sessize al" />
          </label>
        </div>
      </section>

      <div className="flex gap-2 border-t border-line pt-4">
        <Button className="flex-1" onClick={test} disabled={playing}>
          <IconVolume /> {playing ? 'Çalıyor…' : 'Test sesi'}
        </Button>
        <Button variant="danger" onClick={() => removeSpeaker(sp.id)} aria-label="Hoparlörü sil" title="Sil (Delete)">
          <IconTrash /> Sil
        </Button>
      </div>
    </div>
  )
}

const HIGH_PASS_OPTIONS = [80, 100, 120, 150, 200]

function EqBassSection({ sp }: { sp: Speaker }) {
  const speakers = useStore((s) => s.speakers)
  const updateSpeaker = useStore((s) => s.updateSpeaker)
  const hp = sp.highPassHz ?? 0
  const presetValue = speakerPresetValue(sp)
  const anyHighPass = speakers.some((s) => (s.highPassHz ?? 0) > 0)
  const anyReceiver = speakers.some((s) => s.bassReceiver)

  return (
    <section>
      <SectionTitle>EQ ve bas</SectionTitle>
      <div className="space-y-3">
        <Field label="Hoparlör ön ayarı">
          <Select
            ariaLabel="Hoparlör ön ayarı"
            value={presetValue}
            onChange={(v) => {
              const patch = speakerPresetPatch(v)
              if (patch) updateSpeaker(sp.id, patch)
            }}
          >
            {SPEAKER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            {presetValue === CUSTOM_ID && <option value={CUSTOM_ID}>{CUSTOM_LABEL}</option>}
          </Select>
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
            <span>10 bant EQ</span>
            <button
              type="button"
              className="text-faint hover:text-fg disabled:opacity-40 disabled:hover:text-faint"
              disabled={!sp.eq}
              onClick={() => updateSpeaker(sp.id, { eq: undefined, eqPreset: 'flat' })}
            >
              Sıfırla
            </button>
          </div>
          <EqEditor
            compact
            value={sp.eq ?? flatEq()}
            onChange={(eq) => updateSpeaker(sp.id, { eq, eqPreset: CUSTOM_ID })}
          />
        </div>

        <Field label="Küçük hoparlör (bas kes)">
          <Select
            ariaLabel="Küçük hoparlör bas kesme"
            value={hp}
            onChange={(v) => updateSpeaker(sp.id, { highPassHz: Number(v) || undefined, ...(Number(v) ? { bassReceiver: undefined } : {}) })}
          >
            <option value={0}>Kapalı</option>
            {hp > 0 && !HIGH_PASS_OPTIONS.includes(hp) && <option value={hp}>{hp} Hz</option>}
            {HIGH_PASS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} Hz
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            Bas alıcısı (dahili sub / subwoofer)
            <Switch
              checked={!!sp.bassReceiver}
              onChange={(v) => updateSpeaker(sp.id, { bassReceiver: v || undefined, ...(v ? { highPassHz: undefined } : {}) })}
              label="Bas alıcısı"
            />
          </label>
          <p className="mt-1 text-xs text-faint">Kesilen baslar ve LFE bu hoparlöre gider.</p>
        </div>

        {anyHighPass && !anyReceiver && (
          <div className="flex gap-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
            <IconWarn className="mt-px shrink-0" />
            Bir hoparlörün basları kesiliyor ama bas alıcısı yok; kesilen bas kaybolur. Bir hoparlörü (örn. dahili sub)
            bas alıcısı yap.
          </div>
        )}
      </div>
    </section>
  )
}

function AutoRow(props: {
  label: string
  auto: boolean
  onAuto: (v: boolean) => void
  value: number
  unit: string
  min: number
  max: number
  step: number
  decimals?: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>{props.label}</span>
        <label className="flex cursor-pointer items-center gap-1.5">
          Otomatik
          <Switch small checked={props.auto} onChange={props.onAuto} label={`${props.label} otomatik`} />
        </label>
      </div>
      <NumberField
        ariaLabel={props.label}
        value={props.value}
        unit={props.unit}
        min={props.min}
        max={props.max}
        step={props.step}
        decimals={props.decimals ?? 2}
        disabled={props.auto}
        onChange={props.onChange}
      />
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  )
}
