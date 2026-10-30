import { useStore } from '../store/useStore'
import type { Device, DeviceKind, SinkStatus } from '../api/types'
import { deviceColorVar } from '../lib/colors'
import { fmt, fmtRate, fmtSigned } from '../lib/format'
import { Badge, Button, Card, Field, NumberField, ScreenHeader, SectionTitle, cx } from '../components/ui'
import { IconPlus } from '../components/icons'

const KIND: Record<DeviceKind, string> = { local: 'Yerel', network: 'Ağ', multichannel: 'Çok kanallı' }

export function DevicesScreen() {
  const devices = useStore((s) => s.devices)
  const outputs = useStore((s) => s.outputs)
  const speakers = useStore((s) => s.speakers)
  const status = useStore((s) => s.status)
  const runState = useStore((s) => s.runState)
  const lowLatency = useStore((s) => s.lowLatency)
  const setOutput = useStore((s) => s.setOutput)
  const addOutput = useStore((s) => s.addOutput)
  const select = useStore((s) => s.select)
  const setScreen = useStore((s) => s.setScreen)

  const used = outputs
    .map((o) => ({ out: o, dev: devices.find((d) => d.id === o.deviceId) }))
    .filter((x): x is { out: typeof x.out; dev: Device } => !!x.dev)
  const unused = devices.filter((d) => d.flow === 'render' && !outputs.some((o) => o.deviceId === d.id))

  return (
    <div className="h-full overflow-y-auto p-5">
      <ScreenHeader title="Cihazlar" sub="Çıkış cihazlarının tampon ayarları ve canlı durumu." />

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2">
        {used.map(({ out, dev }) => {
          const st = status.find((s) => s.deviceId === dev.id)
          const users = speakers.filter((s) => s.outputDeviceId === dev.id)
          const off = lowLatency && dev.kind === 'network'
          return (
            <Card key={dev.id} className={cx('overflow-hidden', off && 'opacity-60')}>
              <div className="flex h-1" style={{ background: deviceColorVar(dev.id, devices) }} />
              <div className="p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-semibold">{dev.name}</h2>
                    <p className="num mt-0.5 text-xs text-muted">
                      {dev.channels} kanal · {fmtRate(dev.sampleRate)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {off && <Badge tone="warn">Devre dışı</Badge>}
                    <Badge tone={dev.kind === 'network' ? 'warn' : dev.kind === 'multichannel' ? 'accent' : 'neutral'}>
                      {KIND[dev.kind]}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Gecikme (latencyMs)">
                    <NumberField
                      ariaLabel={`${dev.name} gecikme`}
                      value={out.latencyMs}
                      min={0}
                      max={1000}
                      step={5}
                      decimals={0}
                      unit="ms"
                      onChange={(v) => setOutput(dev.id, { latencyMs: v })}
                    />
                  </Field>
                  <Field label="Tampon (bufferMs)">
                    <NumberField
                      ariaLabel={`${dev.name} tampon`}
                      value={out.bufferMs}
                      min={10}
                      max={1000}
                      step={5}
                      decimals={0}
                      unit="ms"
                      onChange={(v) => setOutput(dev.id, { bufferMs: v })}
                    />
                  </Field>
                </div>

                <div className="mt-4">
                  <SectionTitle>Canlı durum</SectionTitle>
                  <LiveStatus st={st} target={out.bufferMs} running={runState === 'running'} />
                </div>

                <div className="mt-4">
                  <SectionTitle>Kullanan hoparlörler</SectionTitle>
                  {users.length === 0 ? (
                    <p className="text-xs text-faint">Bu cihazı kullanan hoparlör yok.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {users.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => {
                            select(u.id)
                            setScreen('room')
                          }}
                          className="flex items-center gap-1.5 rounded border border-line-strong px-2 py-0.5 text-xs hover:border-muted"
                        >
                          {u.name}
                          <span className="num text-faint">k{u.deviceChannel}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {unused.length > 0 && (
        <div className="mt-6">
          <SectionTitle>Kullanılmayan çıkış cihazları</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {unused.map((d) => (
              <Button key={d.id} size="sm" onClick={() => addOutput(d.id)}>
                <IconPlus /> {d.name}
                <span className="num text-faint">{d.channels}k</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LiveStatus({ st, target, running }: { st?: SinkStatus; target: number; running: boolean }) {
  if (!running || !st) {
    return (
      <div className="rounded border border-dashed border-line-strong px-3 py-3 text-xs text-faint">
        Çalışmıyor. Başlat’a basınca canlı değerler burada görünür.
      </div>
    )
  }
  const max = target * 2
  const pct = Math.min(100, (st.fillMs / max) * 100)
  const low = st.fillMs < target * 0.5
  const barColor = low ? 'bg-warn' : 'bg-ok'
  const drift = Math.abs(st.corrPpm)
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-muted">Doluluk</span>
          <span className="num">
            {fmt(st.fillMs, 1)} <span className="text-faint">/ hedef {target} ms</span>
          </span>
        </div>
        <div className="relative h-2 rounded-full bg-raised">
          <div className={cx('h-full rounded-full transition-[width] duration-700', barColor)} style={{ width: `${pct}%` }} />
          <div className="absolute -top-0.5 h-3 w-px bg-fg" style={{ left: '50%' }} title="Hedef doluluk" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Kayma" value={`${fmtSigned(st.corrPpm)} ppm`} tone={drift > 60 ? 'warn' : undefined} />
        <Stat label="Underrun" value={String(st.underruns)} tone={st.underruns > 0 ? 'warn' : undefined} />
        <Stat label="Overrun" value={String(st.overruns)} tone={st.overruns > 0 ? 'warn' : undefined} />
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded border border-line bg-bg/40 px-2.5 py-1.5">
      <div className="text-[11px] text-faint">{label}</div>
      <div className={cx('num text-[13px]', tone === 'warn' && 'text-warn')}>{value}</div>
    </div>
  )
}
