import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { LOGICAL_CHANNELS, type LevelFrame, type LogicalChannel } from '../api/types'
import { useStore } from '../store/useStore'
import { Card, Field, ScreenHeader, SectionTitle, Segmented, Select, Switch, cx } from '../components/ui'
import { IconWarn } from '../components/icons'
import { fmt } from '../lib/format'

const MIN_DB = -60

const emptyFrame = (): LevelFrame =>
  Object.fromEntries(LOGICAL_CHANNELS.map((c) => [c, -90])) as LevelFrame

export function SourceScreen() {
  const devices = useStore((s) => s.devices)
  const source = useStore((s) => s.source)
  const upmix = useStore((s) => s.upmix)
  const setSource = useStore((s) => s.setSource)
  const setUpmix = useStore((s) => s.setUpmix)

  const flow = source.mode === 'capture' ? 'capture' : 'render'
  const options = devices.filter((d) => d.flow === flow)
  const current = devices.find((d) => d.id === source.deviceId)
  const hasCable = devices.some((d) => d.flow === 'capture' && d.channels >= 8)

  return (
    <div className="h-full overflow-y-auto p-5">
      <ScreenHeader title="Kaynak" sub="Sesin yakalandığı cihaz ve kanal seviyeleri." />

      {!hasCable && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[13px]">
          <IconWarn className="mt-0.5 shrink-0 text-warn" />
          <div>
            <p className="font-semibold text-warn">Gerçek 7.1 için VB-Cable önerilir</p>
            <p className="mt-0.5 text-muted">
              8 kanallı bir yakalama cihazı bulunamadı. Oyun/medya uygulamaları ayrık 5.1/7.1 gönderebilmek için sanal
              bir 8 kanallı cihaza ihtiyaç duyar; aksi halde yalnızca 2 kanal alınır ve yükseltme (upmix) kullanılır.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Card className="space-y-4 self-start p-4">
          <SectionTitle>Giriş</SectionTitle>
          <Field label="Mod">
            <Segmented
              value={source.mode}
              onChange={(mode) => setSource({ mode })}
              options={[
                { value: 'loopback', label: 'Loopback' },
                { value: 'capture', label: 'Yakalama' },
              ]}
            />
          </Field>
          <p className="-mt-2 text-xs text-faint">
            {source.mode === 'loopback'
              ? 'Bir çıkış cihazına giden sistem sesini dinler.'
              : 'Bir kayıt (giriş) cihazından, örn. VB-Cable, okur.'}
          </p>
          <Field label="Kaynak cihaz">
            <Select ariaLabel="Kaynak cihaz" value={source.deviceId} onChange={(v) => setSource({ deviceId: v })}>
              {options.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.channels} kn){d.isDefault ? ' · varsayılan' : ''}
                </option>
              ))}
            </Select>
          </Field>
          {current && (
            <p className="num text-xs text-muted">
              {current.channels} kanal · {(current.sampleRate / 1000).toString().replace('.', ',')} kHz
            </p>
          )}

          <div className="border-t border-line pt-4">
            <label className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-[13px] font-medium">Upmix</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Kaynak yalnızca 2 kanallıysa FC, LFE ve arka/yan kanallar üretilir.
                </span>
              </span>
              <Switch checked={upmix} onChange={setUpmix} label="Upmix" />
            </label>
          </div>
        </Card>

        <Card className="p-4">
          <Meters />
        </Card>
      </div>
    </div>
  )
}

function Meters() {
  const runState = useStore((s) => s.runState)
  const [levels, setLevels] = useState<LevelFrame>(emptyFrame)
  const peaks = useRef<Record<string, { v: number; t: number }>>({})

  useEffect(() => {
    return api.onLevels((frame) => {
      const now = performance.now()
      for (const c of LOGICAL_CHANNELS) {
        const p = peaks.current[c]
        if (!p || frame[c] >= p.v || now - p.t > 1200) peaks.current[c] = { v: frame[c], t: now }
      }
      setLevels(frame)
    })
  }, [])

  return (
    <div>
      <SectionTitle>Kanal seviyeleri</SectionTitle>
      <div className="flex h-[300px] items-stretch justify-between gap-2.5 rounded border border-line bg-bg/40 px-4 pb-3 pt-4">
        {LOGICAL_CHANNELS.map((c) => (
          <Meter key={c} ch={c} db={levels[c]} peak={peaks.current[c]?.v ?? -90} />
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">
        {runState === 'running' ? 'Örnek veri · canlı' : 'Başlat’a basınca seviyeler hareket eder (örnek veri).'}
      </p>
    </div>
  )
}

function Meter({ ch, db, peak }: { ch: LogicalChannel; db: number; peak: number }) {
  const pos = (v: number) => Math.min(1, Math.max(0, (v - MIN_DB) / -MIN_DB))
  const hot = db > -6
  const warm = db > -18
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <span className="num text-[11px] text-muted">{db <= -89 ? '−∞' : fmt(db, 0)}</span>
      <div className="relative w-full max-w-[34px] flex-1 overflow-hidden rounded-[3px] bg-raised">
        {/* Bölme çizgileri */}
        {[-12, -24, -36, -48].map((t) => (
          <div key={t} className="absolute inset-x-0 h-px bg-line" style={{ bottom: `${pos(t) * 100}%` }} />
        ))}
        <div
          className={cx('absolute inset-x-0 bottom-0', hot ? 'bg-err' : warm ? 'bg-warn' : 'bg-ok')}
          style={{ height: `${pos(db) * 100}%`, transition: 'height 80ms linear' }}
        />
        <div className="absolute inset-x-0 h-0.5 bg-fg" style={{ bottom: `calc(${pos(peak) * 100}% - 1px)` }} />
      </div>
      <span className="num text-xs font-semibold">{ch}</span>
    </div>
  )
}
