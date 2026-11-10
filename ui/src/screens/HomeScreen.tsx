import { useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { checkHealth, type HealthItem } from '../lib/health'
import { countLayout, formatLayout } from '../lib/layout'
import { upmixStateLabel } from '../lib/upmix'
import { RoomCanvas } from '../components/RoomCanvas'
import { RunButton } from '../components/TopBar'
import { Badge, Button, Card, SectionTitle, cx } from '../components/ui'
import { IconCheck, IconInfo, IconVolume, IconWarn } from '../components/icons'

export function HomeScreen() {
  const s = useStore()
  // Bu ekrandan başlatılan "sırayla çal" ekrandan çıkınca dursun.
  useEffect(() => () => useStore.getState().stopTour(), [])
  const items = useMemo(
    () =>
      checkHealth({
        devices: s.devices,
        source: s.source,
        speakers: s.speakers,
        upmix: s.upmix,
        upmixOptions: s.upmixOptions,
        processing: s.processing,
        running: s.runState === 'running',
        status: s.status,
        lowLatency: s.lowLatency,
        calibrated: !!s.lastCalibration,
        waiting: s.runState === 'waiting' ? { missing: s.waitingFor, message: s.waitMessage } : null,
      }),
    [s.devices, s.source, s.speakers, s.upmix, s.upmixOptions, s.processing, s.runState, s.status, s.lowLatency, s.lastCalibration, s.waitingFor, s.waitMessage],
  )
  const counts = countLayout(s.speakers)
  // 2.1 setin dahili subwoofer'ı (bas alıcısı ön hoparlörler) da ".1" sayılır.
  if (counts.sub === 0 && s.speakers.some((sp) => sp.bassReceiver && !sp.mute)) counts.sub = 1
  const layout = formatLayout(counts)
  const running = s.runState === 'running'
  const src = s.devices.find((d) => d.id === s.source.deviceId)

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card className="flex flex-wrap items-center gap-5 p-5">
            <RunButton big />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">
                {running ? 'Ses tüm hoparlörlere dağıtılıyor' : s.speakers.length ? 'Hazır' : 'Kurulum gerekli'}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {s.speakers.length === 0
                  ? 'Önce hoparlörlerini tanıtalım; birkaç soru yeterli.'
                  : `${layout} düzen · ${s.speakers.length} hoparlör · kaynak: ${src?.name ?? 'yok'}`}
              </p>
              {running && s.engine && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={s.engine.upmix === 'stereo' ? 'accent' : s.engine.upmix === 'native' ? 'ok' : 'neutral'}>
                    {upmixStateLabel(s.engine)}
                  </Badge>
                  {s.engine.upmixLatencyMs > 0 && s.engine.upmix === 'stereo' && (
                    <span className="num text-xs text-faint">+{Math.round(s.engine.upmixLatencyMs)} ms</span>
                  )}
                </div>
              )}
            </div>
            {s.speakers.length === 0 && (
              <Button variant="primary" onClick={s.openWizard}>
                Kurulum sihirbazı
              </Button>
            )}
          </Card>

          <ProfileCards />

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <SectionTitle>Oda</SectionTitle>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => (s.playing ? s.stopTour() : void s.playTour())} disabled={!s.speakers.length}>
                  <IconVolume /> {s.playing ? 'Durdur' : 'Sırayla çal'}
                </Button>
                <Button size="sm" onClick={() => s.setScreen('room')}>
                  Düzenle
                </Button>
              </div>
            </div>
            <div className="h-[340px]">
              <RoomCanvas editable={false} compact />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle right={<HealthSummary items={items} />}>Sistem kontrolü</SectionTitle>
            {items.length === 0 ? (
              <p className="flex items-center gap-2 text-[13px] text-ok">
                <IconCheck /> Her şey yolunda.
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map((it) => (
                  <HealthRow key={it.id} item={it} onFix={() => it.fix && s.fixHealth(it.fix.id, it.fix.arg)} />
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <SectionTitle>Hoparlörler</SectionTitle>
            {s.speakers.length === 0 ? (
              <p className="text-[13px] text-muted">Tanımlı hoparlör yok.</p>
            ) : (
              <ul className="divide-y divide-line">
                {s.speakers.map((sp) => (
                  <li key={sp.id} className="flex items-center gap-2 py-1.5">
                    <span className={cx('min-w-0 flex-1 truncate text-[13px]', sp.mute && 'text-faint line-through')}>{sp.name}</span>
                    {sp.calibratedAt && <Badge tone="ok">Ölçüldü</Badge>}
                    <button
                      type="button"
                      onClick={() => void s.playTone(sp.id)}
                      className={cx('rounded p-1 text-muted hover:text-fg', s.playing === sp.id && 'text-accent')}
                      aria-label={`${sp.name} test sesi`}
                      title="Test sesi"
                    >
                      <IconVolume />
                    </button>
                    <button
                      type="button"
                      onClick={() => s.updateSpeaker(sp.id, { mute: !sp.mute })}
                      className="w-14 rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-muted hover:text-fg"
                    >
                      {sp.mute ? 'Aç' : 'Sustur'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function HealthSummary({ items }: { items: HealthItem[] }) {
  const e = items.filter((i) => i.level === 'error').length
  const w = items.filter((i) => i.level === 'warn').length
  if (e) return <Badge tone="err">{e} hata</Badge>
  if (w) return <Badge tone="warn">{w} uyarı</Badge>
  return <Badge tone="ok">Sorun yok</Badge>
}

function HealthRow({ item, onFix }: { item: HealthItem; onFix: () => void }) {
  const tone = item.level === 'error' ? 'text-err' : item.level === 'warn' ? 'text-warn' : 'text-muted'
  return (
    <li className="flex gap-2.5 rounded-md border border-line p-2.5">
      <span className={cx('mt-0.5 shrink-0', tone)}>{item.level === 'info' ? <IconInfo /> : <IconWarn />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{item.title}</p>
        <p className="mt-0.5 text-xs text-muted">{item.detail}</p>
        {item.fix && (
          <Button size="sm" className="mt-2" variant={item.level === 'info' ? 'default' : 'primary'} onClick={onFix}>
            {item.fix.label}
          </Button>
        )}
      </div>
    </li>
  )
}

function ProfileCards() {
  const profiles = useStore((s) => s.profiles)
  const active = useStore((s) => s.activeProfileId)
  const select = useStore((s) => s.selectProfile)
  const hint: Record<string, string> = {
    'builtin-film': 'Diyalog önde, geniş sahne',
    'builtin-game': 'Düşük gecikme, net yön',
    'builtin-music': 'Doğal, temiz stereo',
  }
  return (
    <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
      {profiles.slice(0, 4).map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => select(p.id)}
          aria-pressed={active === p.id}
          className={cx(
            'rounded-lg border p-3 text-left transition-colors',
            active === p.id ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-line-strong',
          )}
        >
          <span className={cx('block text-[14px] font-semibold', active === p.id && 'text-accent')}>{p.name}</span>
          <span className="mt-0.5 block text-xs text-muted">{hint[p.id] ?? (p.upmix ? 'Upmix açık' : 'Upmix kapalı')}</span>
        </button>
      ))}
    </div>
  )
}
