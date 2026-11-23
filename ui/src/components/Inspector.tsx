import { useState } from 'react'
import { CHANNEL_LABELS, HEIGHT_CHANNELS, LOGICAL_CHANNELS, flatEq, isHighLatencyKind, type Speaker } from '../api/types'
import { EqEditor } from './EqEditor'
import { EqCurve } from './EqCurve'
import { PeqEditor } from './PeqEditor'
import { PresetManager } from './PresetManager'
import {
  CUSTOM_ID,
  CUSTOM_LABEL,
  SPEAKER_PRESETS,
  isUserPresetKey,
  speakerPresetPatch,
  speakerPresetValue,
  userPresetKey,
} from '../lib/presets'
import { LISTENER_ID, selectSpeaker, useStore } from '../store/useStore'
import { computeAuto } from '../lib/geometry'
import { positionalRows } from '../lib/positional'
import {
  CUSTOM_MANUAL_LABEL,
  CUSTOM_MAP_LABEL,
  ROLES,
  ROLE_CUSTOM_MANUAL,
  ROLE_CUSTOM_MAP,
  angleFromListener,
  effectiveRole,
} from '../lib/roles'
import { deviceColorVar } from '../lib/colors'
import { fmt } from '../lib/format'
import { Badge, Button, Field, NumberField, SectionTitle, Segmented, Select, Switch, cx } from './ui'
import { IconCopy, IconTrash, IconVolume, IconWarn } from './icons'

export function Inspector() {
  const selection = useStore((s) => s.selection)
  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-surface">
      <div key={selection ?? 'none'} className="screen-in p-4">
        {selection === LISTENER_ID ? <ListenerPanel /> : selection ? <SpeakerPanel /> : <EmptyPanel />}
      </div>
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
        Ayarlarını görmek için odada bir hoparlör seç. Sürükleyerek taşıyabilir, ok tuşlarıyla 5 cm kaydırabilir, Delete
        ile silebilirsin. Her değişiklik Ctrl+Z ile geri alınır.
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
          <NumberField
            value={room.listener.x}
            min={0}
            max={room.widthM}
            step={0.05}
            onChange={(v) => move(v, room.listener.y)}
          />
        </Field>
        <Field label="Y (m)">
          <NumberField
            value={room.listener.y}
            min={0}
            max={room.depthM}
            step={0.05}
            onChange={(v) => move(room.listener.x, v)}
          />
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
  const positional = useStore((s) => s.positionalMix)
  const updateSpeaker = useStore((s) => s.updateSpeaker)
  const setMix = useStore((s) => s.setMix)
  const setRole = useStore((s) => s.setRole)
  const setAuto = useStore((s) => s.setAuto)
  const removeSpeaker = useStore((s) => s.removeSpeaker)
  const duplicateSpeaker = useStore((s) => s.duplicateSpeaker)
  const playTone = useStore((s) => s.playTone)
  const playing = useStore((s) => s.playing === s.selection)
  const [tab, setTab] = useState<'general' | 'sound' | 'advanced'>('general')

  if (!sp) return null
  const dev = devices.find((d) => d.id === sp.outputDeviceId)
  const renders = devices.filter((d) => d.flow === 'render')
  const a = auto[sp.id] ?? { delay: true, gain: true }
  const { dMax, byId } = computeAuto(speakers, room.listener)
  const d = byId[sp.id]?.distance ?? 0
  const disabled = lowLatency && isHighLatencyKind(dev?.kind)
  const fromMap = sp.role === ROLE_CUSTOM_MAP
  // "Konuma göre dağıt" açıkken motora giden gerçek satır (rol satırı yerine) gösterilir ve elle değiştirilemez.
  const posRow = positional ? positionalRows(speakers, room.listener).get(sp.id) : undefined
  const shownRow = posRow && Object.keys(posRow).length > 0 ? posRow : null
  const mixLocked = fromMap || !!shownRow
  const clash = speakers.some(
    (o) => o.id !== sp.id && o.outputDeviceId === sp.outputDeviceId && o.deviceChannel === sp.deviceChannel,
  )

  const test = () => void playTone(sp.id)

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

      <Segmented
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'general', label: 'Genel' },
          { value: 'sound', label: 'Ses' },
          { value: 'advanced', label: 'Gelişmiş' },
        ]}
      />

      {tab === 'general' && <RoleSection sp={sp} onRole={(r) => setRole(sp.id, r)} />}

      {disabled && (
        <div className="flex gap-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
          <IconWarn className="mt-px shrink-0" />
          Düşük gecikme modunda ağ cihazları devre dışı; bu hoparlör çalmaz.
        </div>
      )}

      {tab === 'general' && (
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
          <label className="mt-3 flex items-center justify-between text-[13px]">
            Sessize al
            <Switch checked={sp.mute} onChange={(v) => updateSpeaker(sp.id, { mute: v })} label="Sessize al" />
          </label>
        </section>
      )}

      {tab === 'sound' && <EqBassSection sp={sp} />}

      {tab === 'advanced' && (
        <section>
          <SectionTitle>Kanal karışımı</SectionTitle>
          {shownRow && (
            <p className="mb-2 text-xs text-accent">
              Konuma göre dağıtılıyor: her kanal yönünden duyulsun diye bu hoparlör dinleyiciye göre{' '}
              <span className="num">{fmt(angleFromListener(sp, room.listener), 0)}°</span> yönündeki payını çalıyor. Elle
              değiştirmek için üstteki “Konuma göre dağıt”ı kapat.
            </p>
          )}
          {fromMap && !shownRow && (
            <p className="mb-2 text-xs text-faint">
              Konumdan hesaplanıyor: dinleyiciye göre{' '}
              <span className="num">{fmt(angleFromListener(sp, room.listener), 0)}°</span>
              {sp.elevated ? ', üst şeritler' : ''}. Elle değiştirmek için rolü “{CUSTOM_MANUAL_LABEL}” yap.
            </p>
          )}
          <div className="space-y-1">
            {LOGICAL_CHANNELS.map((ch) => {
              const v = (shownRow ?? sp.source)[ch] ?? 0
              const first = ch === HEIGHT_CHANNELS[0]
              return (
                <div key={ch} className={cx('flex items-center gap-2', first && 'mt-2 border-t border-line pt-2')}>
                  <span title={CHANNEL_LABELS[ch]} className={cx('num w-8 text-xs', v > 0 ? 'text-fg' : 'text-faint')}>
                    {ch}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={v}
                    disabled={mixLocked}
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
                    decimals={2}
                    disabled={mixLocked}
                    onChange={(n) => setMix(sp.id, ch, n)}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {tab === 'advanced' && (
        <section>
          <SectionTitle
            right={
              sp.calibratedAt && !a.delay ? (
                <Badge tone="ok" className="whitespace-nowrap">
                  Ölçüldü · {new Date(sp.calibratedAt).toLocaleDateString('tr-TR')}
                </Badge>
              ) : (
                <Badge tone={a.delay && a.gain ? 'accent' : 'neutral'}>
                  {a.delay && a.gain ? 'Mesafeden' : 'Elle'}
                </Badge>
              )
            }
          >
            Zamanlama ve seviye
          </SectionTitle>
          <div className="space-y-3">
            <AutoRow
              label="Gecikme"
              auto={a.delay}
              onAuto={(v) => {
                setAuto(sp.id, { delay: v })
                if (v && sp.calibratedAt) updateSpeaker(sp.id, { calibratedAt: undefined })
              }}
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
              Otomatik: en uzak hoparlör <span className="num">{fmt(dMax)} m</span> referans alınır; gecikme = (dMax −
              d) / 343 m/s, kazanç = 20·log₁₀(d / dMax). Kalibrasyon bunları ölçerek değiştirir.
            </p>
          </div>
        </section>
      )}

      <div className="flex gap-2 border-t border-line pt-4">
        <Button className="flex-1" onClick={test} disabled={playing}>
          <IconVolume /> {playing ? 'Çalıyor…' : 'Test sesi'}
        </Button>
        <Button onClick={() => duplicateSpeaker(sp.id)} aria-label="Hoparlörü kopyala" title="Kopyala">
          <IconCopy />
        </Button>
        <Button variant="danger" onClick={() => removeSpeaker(sp.id)} aria-label="Hoparlörü sil" title="Sil (Delete)">
          <IconTrash /> Sil
        </Button>
      </div>
    </div>
  )
}

/** Rol açılır listesi (docs/duzen.md): seçim karışım satırını yazar; satırı elle değiştirmek rolü "Özel (elle)" yapar. */
function RoleSection({ sp, onRole }: { sp: Speaker; onRole: (role: string) => void }) {
  const updateSpeaker = useStore((s) => s.updateSpeaker)
  const role = effectiveRole(sp)
  const floor = ROLES.filter((r) => !r.elevated && !r.bassReceiver)
  const top = ROLES.filter((r) => r.elevated)
  const bass = ROLES.filter((r) => r.bassReceiver)
  const opt = (r: { id: string; label: string }) => (
    <option key={r.id} value={r.id}>
      {r.label}
    </option>
  )
  return (
    <section>
      <Field label="Rol">
        <Select ariaLabel="Hoparlör rolü" value={role} onChange={onRole}>
          <optgroup label="Zemin">{floor.map(opt)}</optgroup>
          <optgroup label="Bas">{bass.map(opt)}</optgroup>
          <optgroup label="Üst">{top.map(opt)}</optgroup>
          <optgroup label="Özel">
            <option value={ROLE_CUSTOM_MAP}>{CUSTOM_MAP_LABEL}</option>
            <option value={ROLE_CUSTOM_MANUAL}>{CUSTOM_MANUAL_LABEL}</option>
          </optgroup>
        </Select>
      </Field>
      {role === ROLE_CUSTOM_MAP && (
        <label className="mt-2.5 flex items-center justify-between gap-3 text-[13px]">
          Üst hoparlör (tavan / yükseklik)
          <Switch
            checked={!!sp.elevated}
            onChange={(v) => updateSpeaker(sp.id, { elevated: v || undefined })}
            label="Üst hoparlör"
          />
        </label>
      )}
    </section>
  )
}

const HIGH_PASS_OPTIONS = [80, 100, 120, 150, 200]

function EqBassSection({ sp }: { sp: Speaker }) {
  const speakers = useStore((s) => s.speakers)
  const updateSpeaker = useStore((s) => s.updateSpeaker)
  const hp = sp.highPassHz ?? 0
  const user = useStore((s) => s.userSpeakerPresets)
  const applyUser = useStore((s) => s.applyUserSpeakerPreset)
  const saveUser = useStore((s) => s.saveUserSpeakerPreset)
  const overwriteUser = useStore((s) => s.overwriteUserSpeakerPreset)
  const renameUser = useStore((s) => s.renameUserSpeakerPreset)
  const deleteUser = useStore((s) => s.deleteUserSpeakerPreset)
  const [peqSel, setPeqSel] = useState<string | null>(null)
  const presetValue = speakerPresetValue(sp, user)
  const activeUser = user.find((u) => userPresetKey(u.id) === presetValue) ?? null
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
              if (isUserPresetKey(v)) {
                const u = user.find((x) => userPresetKey(x.id) === v)
                if (u) applyUser(u.id, sp.id)
                return
              }
              const patch = speakerPresetPatch(v)
              if (patch) updateSpeaker(sp.id, { ...patch, peq: undefined })
            }}
          >
            {SPEAKER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            {user.length > 0 && (
              <optgroup label="Kendi ön ayarların">
                {user.map((u) => (
                  <option key={u.id} value={userPresetKey(u.id)}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            )}
            {presetValue === CUSTOM_ID && <option value={CUSTOM_ID}>{CUSTOM_LABEL}</option>}
          </Select>
          <PresetManager
            compact
            count={user.length}
            active={activeUser}
            onSave={(name) => saveUser(sp.id, name)}
            onOverwrite={(id) => overwriteUser(id, sp.id)}
            onRename={renameUser}
            onDelete={deleteUser}
          />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
            <span>10 bant EQ</span>
            <button
              type="button"
              className="text-faint hover:text-fg disabled:opacity-40 disabled:hover:text-faint"
              disabled={!sp.eq && !sp.peq?.length}
              onClick={() => updateSpeaker(sp.id, { eq: undefined, peq: undefined, eqPreset: 'flat' })}
            >
              Sıfırla
            </button>
          </div>
          <EqCurve
            compact
            eq={sp.eq ?? flatEq()}
            onEqChange={(eq) => updateSpeaker(sp.id, { eq, eqPreset: CUSTOM_ID })}
            peq={sp.peq ?? []}
            onPeqChange={(peq) => updateSpeaker(sp.id, { peq: peq.length ? peq : undefined, eqPreset: CUSTOM_ID })}
            selectedId={peqSel}
            onSelect={setPeqSel}
            className="mb-1.5"
          />
          <EqEditor
            compact
            value={sp.eq ?? flatEq()}
            onChange={(eq) => updateSpeaker(sp.id, { eq, eqPreset: CUSTOM_ID })}
          />
          <div className="mt-2">
            <PeqEditor
              compact
              bands={sp.peq ?? []}
              onChange={(peq) => updateSpeaker(sp.id, { peq: peq.length ? peq : undefined, eqPreset: CUSTOM_ID })}
              selectedId={peqSel}
              onSelect={setPeqSel}
            />
          </div>
        </div>

        <Field label="Küçük hoparlör (bas kes)">
          <Select
            ariaLabel="Küçük hoparlör bas kesme"
            value={hp}
            onChange={(v) =>
              updateSpeaker(sp.id, {
                highPassHz: Number(v) || undefined,
                ...(Number(v) ? { bassReceiver: undefined } : {}),
              })
            }
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
              onChange={(v) =>
                updateSpeaker(sp.id, { bassReceiver: v || undefined, ...(v ? { highPassHz: undefined } : {}) })
              }
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
