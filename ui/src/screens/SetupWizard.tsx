import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Device } from '../api/types'
import { describeError, useStore } from '../store/useStore'
import {
  KIT_OPTIONS,
  PAIR_TYPE_OPTIONS,
  PLACE_OPTIONS,
  PLACE_ROLES,
  buildSpeakers,
  candidateDevices,
  initialKits,
  planLabel,
  planSpeakers,
  plannedName,
  type DeviceKit,
} from '../lib/setup'
import { ROLES } from '../lib/roles'
import { findCable } from '../lib/health'
import { deviceColorVar } from '../lib/colors'
import { RoomCanvas } from '../components/RoomCanvas'
import { RunButton } from '../components/TopBar'
import { Badge, Button, Card, NumberField, Select, Switch, cx } from '../components/ui'
import { IconCheck, IconVolume, IconWarn, IconX } from '../components/icons'
import { CableSetup } from './SourcePanels'

const STEPS = ['Ses kaynağı', 'Hoparlörler', 'Yerleşim', 'Bitti']

/** İlk kurulum ve "yeniden kur": cihaz → ne bağlı → yerleşim → test. */
export function SetupWizard() {
  const devices = useStore((s) => s.devices)
  const source = useStore((s) => s.source)
  const speakers = useStore((s) => s.speakers)
  const outputs = useStore((s) => s.outputs)
  const room = useStore((s) => s.room)
  const applySetup = useStore((s) => s.applySetup)
  const closeWizard = useStore((s) => s.closeWizard)
  const setScreen = useStore((s) => s.setScreen)

  const [step, setStep] = useState(0)
  const candidates = useMemo(() => candidateDevices(devices, source.deviceId), [devices, source.deviceId])
  const [kits, setKits] = useState<DeviceKit[]>(() => initialKits(candidates, speakers))
  // Sihirbaz açıkken takılan yeni cihazlar da listelensin.
  const allKits = useMemo(() => {
    const have = new Set(kits.map((k) => k.deviceId))
    const extra = initialKits(
      candidates.filter((d) => !have.has(d.id)),
      [],
    ).map((k) => ({ ...k, kind: 'none' as const }))
    return [...kits.filter((k) => candidates.some((d) => d.id === k.deviceId)), ...extra]
  }, [kits, candidates])
  const plan = useMemo(() => planSpeakers(allKits, devices), [allKits, devices])
  const setKit = (id: string, patch: Partial<DeviceKit>) =>
    setKits((ks) => {
      const exists = ks.some((k) => k.deviceId === id)
      const base = exists ? ks : [...ks, allKits.find((k) => k.deviceId === id)!]
      return base.map((k) => (k.deviceId === id ? { ...k, ...patch } : k))
    })

  const apply = () => applySetup(buildSpeakers(plan, speakers, outputs, room))
  const finish = () => {
    closeWizard()
    setScreen('home')
  }

  const cable = findCable(devices)
  const cableOk = !!cable && source.mode === 'loopback' && source.deviceId === cable.id && cable.channels >= 6

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Kurulum sihirbazı">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
        <span className="text-[15px] font-semibold">Kurulum sihirbazı</span>
        <ol className="flex items-center gap-1.5">
          {STEPS.map((t, i) => (
            <li key={t} className="flex items-center gap-1.5">
              <span
                className={cx(
                  'num flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold',
                  i < step ? 'border-ok bg-ok text-bg' : i === step ? 'border-accent text-accent' : 'border-line-strong text-faint',
                )}
              >
                {i < step ? <IconCheck width={11} height={11} strokeWidth={2.4} /> : i + 1}
              </span>
              <span className={cx('text-[13px]', i === step ? 'font-semibold text-fg' : 'text-muted')}>{t}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line-strong" />}
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={closeWizard}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg"
          aria-label="Sihirbazı kapat"
          title="Kapat (yapılan değişiklikler kalır, Ctrl+Z ile geri alınır)"
        >
          <IconX />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx('mx-auto p-6', step === 2 ? 'h-full max-w-[1200px]' : 'max-w-[880px]')}>
          {step === 0 && (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Ses nereden gelecek?</h1>
              <p className="mb-4 mt-1 text-[13px] text-muted">
                Windows tüm sesi sanal bir 7.1 kabloya (VB-Cable) gönderir; Surround bu kanalları alıp hoparlörlerine dağıtır.
                Böylece oyun ve filmlerin gerçek 5.1/7.1 sesi de korunur.
              </p>
              <CableSetup />
              {!cableOk && (
                <p className="flex items-start gap-2 text-xs text-muted">
                  <IconWarn className="mt-px shrink-0 text-warn" />
                  Bu adımı şimdilik atlayabilirsin; Ana sayfadaki sistem kontrolü eksik kalanı hatırlatır.
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Hangi cihaza ne bağlı?</h1>
              <p className="mb-4 mt-1 text-[13px] text-muted">
                Her ses çıkışı için seç. Emin değilsen “Çal” düğmeleriyle hangi hoparlörün öttüğünü dinle.
              </p>
              {candidates.length === 0 ? (
                <Card className="p-5 text-[13px] text-muted">Kullanılabilir çıkış cihazı bulunamadı.</Card>
              ) : (
                <div className="space-y-3">
                  {candidates.map((d) => {
                    const k = allKits.find((v) => v.deviceId === d.id)!
                    return <DeviceKitCard key={d.id} device={d} kit={k} onChange={(p) => setKit(d.id, p)} />
                  })}
                </div>
              )}
              <Card className="mt-4 flex items-center gap-3 p-3.5">
                <span className="num rounded border border-line-strong px-2 py-0.5 text-[13px] font-semibold">{planLabel(plan)}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {plan.length ? plan.map((p) => p.name).join(' · ') : 'Henüz hoparlör seçilmedi.'}
                </span>
              </Card>
            </div>
          )}

          {step === 2 && <PlacementStep />}

          {step === 3 && (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Hazır!</h1>
              <p className="mb-5 mt-1 text-[13px] text-muted">
                {speakers.length} hoparlör tanımlandı. Hepsini sırayla dinleyip doğru yerde çaldıklarından emin ol.
              </p>
              <div className="grid grid-cols-1 gap-3 min-[800px]:grid-cols-3">
                <NextCard title="Sırayla dinle" text="Her hoparlörden kısa bir ton; haritada hangisinin çaldığı yanar.">
                  <TourButton />
                </NextCard>
                <NextCard title="Mikrofonla kalibre et" text="Cihaz gecikmelerini ve seviye farklarını ölçüp düzeltir. Önerilir.">
                  <Button
                    onClick={() => {
                      closeWizard()
                      setScreen('calibration')
                    }}
                  >
                    Kalibrasyona git
                  </Button>
                </NextCard>
                <NextCard title="Başlat" text="Ses motorunu çalıştır; profili üst çubuktan seçebilirsin.">
                  <RunButton />
                </NextCard>
              </div>
              <Card className="mt-4 h-[340px] overflow-hidden">
                <RoomCanvas editable={false} compact />
              </Card>
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-5 py-3">
        {step > 0 && step < 3 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Geri
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {step === 0 && (
            <Button variant="primary" onClick={() => setStep(1)}>
              {cableOk ? 'Devam' : 'Şimdilik atla'}
            </Button>
          )}
          {step === 1 && (
            <Button
              variant="primary"
              disabled={plan.length === 0}
              onClick={() => {
                apply()
                setStep(2)
              }}
            >
              Hoparlörleri oluştur
            </Button>
          )}
          {step === 2 && (
            <Button variant="primary" onClick={() => setStep(3)}>
              Devam
            </Button>
          )}
          {step === 3 && (
            <Button variant="primary" onClick={finish}>
              Bitir
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}

function NextCard({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col p-4">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      <p className="mb-3 mt-1 flex-1 text-xs text-muted">{text}</p>
      <div>{children}</div>
    </Card>
  )
}

function TourButton() {
  const playing = useStore((s) => s.playing)
  const playTour = useStore((s) => s.playTour)
  const stopTour = useStore((s) => s.stopTour)
  return (
    <Button onClick={() => (playing ? stopTour() : void playTour())}>
      <IconVolume /> {playing ? 'Durdur' : 'Sırayla çal'}
    </Button>
  )
}

function PlacementStep() {
  const room = useStore((s) => s.room)
  const setRoomSize = useStore((s) => s.setRoomSize)
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Hoparlörleri yerleştir</h1>
          <p className="mt-1 text-[13px] text-muted">
            Simgeleri odadaki gerçek yerlerine sürükle; “Sen” oturduğun nokta. Mesafeden gecikme ve seviye hesaplanır
            (kalibrasyon bunu sonra ölçerek düzeltir). Ekran yukarıda.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Oda</span>
          <NumberField ariaLabel="Oda genişliği" className="w-[76px]" value={room.widthM} min={2} max={20} step={0.5} unit="m" onChange={(v) => setRoomSize(v, room.depthM)} />
          <span className="text-faint">×</span>
          <NumberField ariaLabel="Oda derinliği" className="w-[76px]" value={room.depthM} min={2} max={20} step={0.5} unit="m" onChange={(v) => setRoomSize(room.widthM, v)} />
        </div>
      </div>
      <Card className="min-h-0 flex-1 overflow-hidden">
        <RoomCanvas />
      </Card>
    </div>
  )
}

/** Bir çıkış cihazı için "ne bağlı?" kartı. */
function DeviceKitCard({ device, kit, onChange }: { device: Device; kit: DeviceKit; onChange: (p: Partial<DeviceKit>) => void }) {
  const devices = useStore((s) => s.devices)
  const showToast = useStore((s) => s.showToast)
  const [testing, setTesting] = useState<number | null>(null)
  const color = deviceColorVar(device.id, devices)

  const test = async (ch: number) => {
    setTesting(ch)
    try {
      await api.playTone(device.id, ch)
      await new Promise((r) => setTimeout(r, 1800))
    } catch (e) {
      showToast(describeError(e), 5000, { tone: 'error' })
    } finally {
      setTesting(null)
    }
  }
  const TestBtn = ({ ch, label }: { ch: number; label: string }) => (
    <Button size="sm" onClick={() => void test(ch)} disabled={testing !== null} title={`${device.name} — ${ch}. kanal`}>
      <IconVolume /> {testing === ch ? 'Çalıyor…' : label}
    </Button>
  )
  const pair = kit.kind === 'pair' || kit.kind === 'pair21'
  const [l, r] = PLACE_ROLES[kit.place]
  const roleOpts = (allowEmpty: boolean) => (
    <>
      {allowEmpty && <option value="">— boş —</option>}
      <optgroup label="Zemin">
        {ROLES.filter((x) => !x.elevated && !x.bassReceiver).map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Bas">
        {ROLES.filter((x) => x.bassReceiver).map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Üst">
        {ROLES.filter((x) => x.elevated).map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </optgroup>
    </>
  )

  return (
    <Card className={cx('overflow-hidden', kit.kind === 'none' && 'opacity-80')}>
      <div className="flex h-1" style={{ background: kit.kind === 'none' ? 'rgb(var(--line))' : color }} />
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold">{device.name}</h2>
            <p className="num text-xs text-muted">
              {device.channels} kanal{device.isDefault ? ' · Windows varsayılanı' : ''}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {device.channels >= 2 ? (
              <>
                <TestBtn ch={1} label="Sol çal" />
                <TestBtn ch={2} label="Sağ çal" />
              </>
            ) : (
              <TestBtn ch={1} label="Çal" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 min-[760px]:grid-cols-5" role="radiogroup" aria-label={`${device.name}: ne bağlı`}>
          {KIT_OPTIONS.filter((o) => o.kind !== 'multi' || device.channels > 2).map((o) => (
            <button
              key={o.kind}
              type="button"
              role="radio"
              aria-checked={kit.kind === o.kind}
              aria-label={o.label}
              onClick={() => onChange({ kind: o.kind })}
              title={o.hint}
              className={cx(
                'rounded-md border px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                kit.kind === o.kind ? 'border-accent bg-accent/10 text-fg' : 'border-line-strong text-muted hover:border-muted hover:text-fg',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        {pair && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <label className="flex items-center gap-2 text-[13px]">
              <span className="text-muted">Nerede?</span>
              <Select ariaLabel="Çiftin yeri" className="w-[140px]" value={kit.place} onChange={(v) => onChange({ place: v as DeviceKit['place'] })}>
                {PLACE_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </label>
            {kit.kind === 'pair' && (
              <label className="flex items-center gap-2 text-[13px]">
                <span className="text-muted">Hoparlör</span>
                <Select ariaLabel="Hoparlör tipi" className="w-[150px]" value={kit.pairType} onChange={(v) => onChange({ pairType: v as DeviceKit['pairType'] })}>
                  {PAIR_TYPE_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <Switch small checked={kit.swap} onChange={(swap) => onChange({ swap })} label="Sol ve sağ ters" />
              Sol/sağ ters takılı
            </label>
            <span className="text-xs text-faint">
              1. kanal → {plannedName(kit.swap ? r : l)}, 2. kanal → {plannedName(kit.swap ? l : r)}
            </span>
          </div>
        )}
        {kit.kind === 'pair' && kit.pairType === 'small-satellite' && (
          <p className="mt-2 text-xs text-faint">150 Hz altı bu hoparlörlerden kesilip bas çalabilen hoparlörlere (2.1 set / subwoofer) gönderilir.</p>
        )}

        {kit.kind === 'single' && (
          <label className="mt-3 flex items-center gap-2 text-[13px]">
            <span className="text-muted">Rolü</span>
            <Select ariaLabel="Tek hoparlörün rolü" className="w-[180px]" value={kit.role} onChange={(role) => onChange({ role })}>
              {roleOpts(false)}
            </Select>
          </label>
        )}

        {kit.kind === 'multi' && (
          <div className="mt-3 grid grid-cols-2 gap-2 min-[760px]:grid-cols-4">
            {Array.from({ length: device.channels }, (_, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void test(i + 1)}
                  disabled={testing !== null}
                  className={cx('num w-7 shrink-0 rounded border border-line-strong py-1 text-[11px] hover:border-muted', testing === i + 1 && 'border-accent text-accent')}
                  title={`${i + 1}. kanalı çal`}
                >
                  {i + 1}
                </button>
                <Select
                  ariaLabel={`${i + 1}. kanal rolü`}
                  value={kit.roles[i] ?? ''}
                  onChange={(v) => {
                    const roles = [...kit.roles]
                    roles[i] = v
                    onChange({ roles })
                  }}
                >
                  {roleOpts(true)}
                </Select>
              </div>
            ))}
          </div>
        )}
        {kit.kind === 'pair21' && <Badge className="mt-3">Bas: bu set kesilen basları ve LFE’yi alır</Badge>}
      </div>
    </Card>
  )
}
