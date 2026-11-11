import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import {
  CHANNEL_LABELS,
  HEIGHT_CHANNELS,
  HEIGHT_DB_MAX,
  HEIGHT_DB_MIN,
  HIGH_CUT_MAX_HZ,
  HIGH_CUT_MIN_HZ,
  LOGICAL_CHANNELS,
  SURROUND_DELAY_MAX_MS,
  UPMIX_DB_MAX,
  UPMIX_DB_MIN,
  type Device,
  type LevelFrame,
  type LogicalChannel,
} from '../api/types'
import { useStore } from '../store/useStore'
import {
  Badge,
  BigSlider,
  Button,
  Card,
  Chip,
  Field,
  SectionTitle,
  Segmented,
  Select,
  Switch,
  cx,
} from '../components/ui'
import { IconCheck, IconWarn } from '../components/icons'
import { fmt, fmtSigned } from '../lib/format'
import { upmixStateLabel } from '../lib/upmix'
import { findCable } from '../lib/health'

const MIN_DB = -60

const FLOOR_CHANNELS = LOGICAL_CHANNELS.filter((c) => !HEIGHT_CHANNELS.includes(c))

/** Hoparlörlerin satırında geçen kanallar (üst şeritlerin etkin olup olmadığını belirler). */
function useUsedLanes(): Set<LogicalChannel> {
  const speakers = useStore((s) => s.speakers)
  const used = new Set<LogicalChannel>()
  for (const sp of speakers) for (const c of LOGICAL_CHANNELS) if ((sp.source[c] ?? 0) > 0) used.add(c)
  return used
}

const emptyFrame = (): LevelFrame =>
  Object.fromEntries(LOGICAL_CHANNELS.map((c) => [c, -90])) as LevelFrame

/** Kaynak seçimi (Bağlantı ekranı). */
export function SourcePanel() {
  const devices = useStore((s) => s.devices)
  const source = useStore((s) => s.source)
  const setSource = useStore((s) => s.setSource)

  const flow = source.mode === 'capture' ? 'capture' : 'render'
  const options = devices.filter((d) => d.flow === flow)
  const current = devices.find((d) => d.id === source.deviceId)
  const selectedIsCable = !!current && /cable/i.test(current.name)
  const twoChannel = selectedIsCable && current.channels <= 2

  return (
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
          ? 'Bir çıkış cihazına giden sistem sesini dinler (önerilen: CABLE Input).'
          : 'Bir kayıt (giriş) cihazından okur.'}
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
      {twoChannel && (
        <p className="flex items-start gap-1.5 text-xs text-warn">
          <IconWarn className="mt-px shrink-0" />
          Windows’ta 7.1 olarak yapılandırılmamış — yukarıdaki 3. adım.
        </p>
      )}
    </Card>
  )
}

/** VB-Cable kurulum rehberi; kablo zaten doğru kuruluysa daraltılmış tek satır. */
export function CableSetup() {
  const devices = useStore((s) => s.devices)
  const source = useStore((s) => s.source)
  const setSource = useStore((s) => s.setSource)
  const current = devices.find((d) => d.id === source.deviceId)
  const cable = findCable(devices)
  const cableSelected = !!cable && source.mode === 'loopback' && source.deviceId === cable.id
  const twoChannel = !!current && /cable/i.test(current.name) && current.channels <= 2
  return (
    <CableGuide
      cable={cable}
      cableSelected={cableSelected}
      twoChannel={twoChannel}
      onSelect={() => cable && setSource({ mode: 'loopback', deviceId: cable.id })}
    />
  )
}

/** Motorun bildirdiği anlık upmix durumu (yalnızca çalışırken). */
export function UpmixStateBadge() {
  const engine = useStore((s) => s.engine)
  const runState = useStore((s) => s.runState)
  if (runState !== 'running' || !engine) return null
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <Badge tone={engine.upmix === 'stereo' ? 'accent' : engine.upmix === 'native' ? 'ok' : 'neutral'}>
        {upmixStateLabel(engine)}
      </Badge>
      {engine.upmix === 'stereo' && engine.upmixLatencyMs > 0 && (
        <span className="num text-[11px] text-faint">+{fmt(engine.upmixLatencyMs, 0)} ms</span>
      )}
    </div>
  )
}

export function UpmixControls() {
  const o = useStore((s) => s.upmixOptions)
  const set = useStore((s) => s.setUpmixOptions)
  const used = useUsedLanes()
  const heightUsed = HEIGHT_CHANNELS.some((c) => used.has(c))
  const db = (v: number) => `${v === 0 ? '0,0' : fmtSigned(v, 1).replace('.', ',')} dB`
  return (
    <div className="mt-4 space-y-4">
      <div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Upmix modu">
          <Chip active={o.mode === 'game'} onClick={() => set({ mode: 'game' })}>
            Oyun (düşük gecikme)
          </Chip>
          <Chip active={o.mode === 'film'} onClick={() => set({ mode: 'film' })}>
            Film (yüksek kalite)
          </Chip>
        </div>
        <p className="mt-1.5 text-xs text-faint">
          {o.mode === 'game'
            ? 'Anlık yön çözümleme; ön hoparlörlere gecikme eklemez.'
            : 'Frekans bandı başına ayrıştırma; diyalog daha temiz ortalanır, ~21 ms gecikme ekler.'}
        </p>
      </div>
      <BigSlider
        label="Orta (diyalog)"
        hint="Ortadaki konuşmanın seviyesi. Orta hoparlör yoksa ön hoparlörlerde etki eder."
        value={o.centerDb}
        min={UPMIX_DB_MIN}
        max={UPMIX_DB_MAX}
        step={0.5}
        display={db(o.centerDb)}
        onChange={(centerDb) => set({ centerDb })}
      />
      <BigSlider
        label="Surround seviyesi"
        hint="Yan ve arka hoparlörlere giden ortam ve efektlerin seviyesi."
        value={o.surroundDb}
        min={UPMIX_DB_MIN}
        max={UPMIX_DB_MAX}
        step={0.5}
        display={db(o.surroundDb)}
        onChange={(surroundDb) => set({ surroundDb })}
      />
      <BigSlider
        label="Yükseklik seviyesi"
        hint={
          heightUsed
            ? 'Üst hoparlörlere (TFL/TFR/TBL/TBR) giden ortam sinyalinin seviyesi.'
            : 'Üst hoparlör yok; odada bir hoparlöre “Üst …” rolü verince etkinleşir.'
        }
        value={o.heightDb}
        min={HEIGHT_DB_MIN}
        max={HEIGHT_DB_MAX}
        step={0.5}
        display={db(o.heightDb)}
        disabled={!heightUsed}
        onChange={(heightDb) => set({ heightDb })}
      />
      <label className="flex items-start justify-between gap-3">
        <span>
          <span className="block text-[13px] font-medium">LFE (sub kanalı)</span>
          <span className="mt-0.5 block text-xs text-muted">
            Yalnızca LFE’ye atanmış bir hoparlör varsa duyulur; 2.1 ön hoparlörler bası zaten çalar.
          </span>
        </span>
        <Switch checked={o.lfeEnabled} onChange={(lfeEnabled) => set({ lfeEnabled })} label="LFE" />
      </label>
      <RearControls />
    </div>
  )
}

/** Yan/arka kanalların karakteri: gecikme, tiz kesme, ayrıştırma. Üçü de canlı uygulanır (docs/upmix.md). */
function RearControls() {
  const o = useStore((s) => s.upmixOptions)
  const set = useStore((s) => s.setUpmixOptions)
  // Kaydırıcının sol ucu (2500) "Kapalı"; 3000..16000 arası kHz.
  const cutPos = o.surroundHighCutHz > 0 ? o.surroundHighCutHz : HIGH_CUT_MIN_HZ - 500
  const cutText = o.surroundHighCutHz > 0 ? `${(o.surroundHighCutHz / 1000).toFixed(1).replace('.', ',')} kHz` : 'Kapalı'
  return (
    <div className="space-y-4 border-t border-line pt-4">
      <h3 className="text-[13px] font-semibold">Arka kanallar</h3>
      <BigSlider
        label="Arka gecikme"
        hint="Arka sesin ön sesten ne kadar sonra geldiği. Varsayılan 10 ms; düşürmek arkayı daha doğrudan yapar."
        value={o.surroundDelayMs}
        min={0}
        max={SURROUND_DELAY_MAX_MS}
        step={0.5}
        display={`${o.surroundDelayMs.toFixed(1).replace('.', ',')} ms`}
        onChange={(surroundDelayMs) => set({ surroundDelayMs })}
      />
      <BigSlider
        label="Arka tiz kesme"
        hint="Arka hoparlörlerin keskin tizlerini yumuşatır (sinema tarzı). Ucuz küçük uydularda sert ses için dene."
        value={cutPos}
        min={HIGH_CUT_MIN_HZ - 500}
        max={HIGH_CUT_MAX_HZ}
        step={500}
        display={cutText}
        onChange={(v) => set({ surroundHighCutHz: v < HIGH_CUT_MIN_HZ ? 0 : v })}
      />
      <BigSlider
        label="Ayrıştırma (dağınıklık)"
        hint="Arka sesi ne kadar “dağıtıp” yaydığı. Düşürmek yankı hissini azaltır, arka ses daha net ve doğrudan olur."
        value={o.diffusion}
        min={0}
        max={1}
        step={0.05}
        display={`${Math.round(o.diffusion * 100)}%`}
        onChange={(diffusion) => set({ diffusion })}
      />
    </div>
  )
}

function CableGuide({
  cable,
  cableSelected,
  twoChannel,
  onSelect,
}: {
  cable: Device | undefined
  cableSelected: boolean
  twoChannel: boolean
  onSelect: () => void
}) {
  const showToast = useStore((s) => s.showToast)
  const [autoDefault, setAutoDefault] = useState(false)
  useEffect(() => {
    api
      .getAppSettings()
      .then((s) => setAutoDefault(s.switchDefaultDevice))
      .catch(() => {})
  }, [])
  const multichannel = !!cable && cable.channels >= 6
  const openPanel = async () => {
    try {
      await api.openSoundPanel()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 6000)
    }
  }

  const steps: { done: boolean; title: ReactNode; body?: ReactNode }[] = [
    {
      done: !!cable,
      title: (
        <>
          VB-Cable’ı <span className="num">vb-audio.com</span>’dan kur ve bilgisayarı yeniden başlat.
        </>
      ),
    },
    {
      done: !!cable && (cable.isDefault || autoDefault),
      title: autoDefault ? (
        <>
          Başlat’a basınca Surround Windows varsayılan çıkışını <b className="font-semibold">“CABLE Input”</b> yapar,
          Durdur’da eskisine döndürür.
        </>
      ) : (
        <>
          Windows varsayılan çıkışını <b className="font-semibold">“CABLE Input”</b> yap.
        </>
      ),
    },
    {
      done: multichannel,
      title: (
        <>
          Ses panelinde <b className="font-semibold">CABLE Input</b> → Yapılandır → <b className="font-semibold">7.1</b>.
        </>
      ),
      body: (
        <Button size="sm" className="mt-1.5" onClick={openPanel}>
          Ses panelini aç
        </Button>
      ),
    },
    {
      done: cableSelected,
      title: (
        <>
          Burada kaynak olarak <b className="font-semibold">CABLE Input</b> + <b className="font-semibold">Loopback</b> seç.
        </>
      ),
      body: cable ? (
        <Button size="sm" variant={cableSelected ? 'default' : 'primary'} className="mt-1.5" onClick={onSelect} disabled={cableSelected}>
          {cableSelected ? 'Kaynak seçili' : 'Kaynak olarak seç'}
        </Button>
      ) : undefined,
    },
    {
      done: false,
      title: (
        <>
          Hoparlörlerini <b className="font-semibold">kurulum sihirbazı</b> ile tanıt (hangi cihaza ne bağlı).
        </>
      ),
    },
  ]

  const [expanded, setExpanded] = useState(false)
  if (cableSelected && multichannel && !expanded) {
    return (
      <Card className="mb-4 flex items-center gap-3 p-3.5">
        <IconCheck className="shrink-0 text-ok" />
        <p className="min-w-0 flex-1 text-[13px]">
          <span className="font-semibold">VB-Cable hazır.</span>{' '}
          <span className="text-muted">
            {cable!.name} · {cable!.channels} kanal; Windows sesi tüm hoparlörlere Surround üzerinden gider.
          </span>
        </p>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(true)}>
          Adımları göster
        </Button>
      </Card>
    )
  }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold">Tüm hoparlörleri uygulamadan geçir (önerilen)</h2>
          <p className="mt-0.5 text-xs text-muted">
            Windows sesi tek bir sanal 7.1 cihaza gönderir; uygulama kanalları ayırıp tüm hoparlörlere dağıtır.
          </p>
        </div>
        {cable ? (
          <Badge tone="ok" className="mt-0.5 shrink-0">
            VB-Cable bulundu
          </Badge>
        ) : (
          <Badge tone="warn" className="mt-0.5 shrink-0">
            VB-Cable bulunamadı
          </Badge>
        )}
      </div>

      {cable ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-ok/40 bg-ok/10 p-3 text-[13px]">
          <IconCheck className="shrink-0 text-ok" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ok">VB-Cable bulundu</p>
            <p className="num mt-0.5 truncate text-xs text-muted">
              {cable.name} · {cable.channels} kanal
            </p>
            {twoChannel && cableSelected && (
              <p className="mt-1 text-xs text-warn">Windows’ta 7.1 olarak yapılandırılmamış — 3. adım.</p>
            )}
          </div>
          <Button size="sm" variant={cableSelected ? 'default' : 'primary'} onClick={onSelect} disabled={cableSelected}>
            {cableSelected ? 'Kaynak seçili' : 'Kaynak olarak seç'}
          </Button>
        </div>
      ) : (
        <div className="mb-3 flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[13px]">
          <IconWarn className="mt-0.5 shrink-0 text-warn" />
          <div>
            <p className="font-semibold text-warn">VB-Cable bulunamadı</p>
            <p className="mt-0.5 text-muted">
              Oyun/medya uygulamalarının ayrık 5.1/7.1 gönderebilmesi için sanal 8 kanallı bir cihaz gerekir; kurulmazsa
              yalnızca 2 kanal alınır ve yükseltme (upmix) kullanılır. Kurulumdan sonra bu ekranı yenile.
            </p>
          </div>
        </div>
      )}

      <ol className="space-y-2.5">
        {steps.map((st, i) => (
          <li key={i} className="flex items-start gap-3 text-[13px]">
            <span
              className={cx(
                'num mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                st.done ? 'border-ok bg-ok text-bg' : 'border-line-strong text-muted',
              )}
            >
              {st.done ? <IconCheck width={11} height={11} strokeWidth={2.4} /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className="leading-5">{st.title}</p>
              {st.body}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export function Meters() {
  const runState = useStore((s) => s.runState)
  const [levels, setLevels] = useState<LevelFrame>(emptyFrame)
  const peaks = useRef<Record<string, { v: number; t: number }>>({})
  const used = useUsedLanes()

  useEffect(() => {
    return api.onLevels((frame) => {
      const now = performance.now()
      for (const c of LOGICAL_CHANNELS) {
        const v = frame[c] ?? -90
        const p = peaks.current[c]
        if (!p || v >= p.v || now - p.t > 1200) peaks.current[c] = { v, t: now }
      }
      setLevels(frame)
    })
  }, [])

  return (
    <div>
      <SectionTitle>Kanal seviyeleri</SectionTitle>
      <div className="flex h-[300px] items-stretch justify-between gap-2.5 rounded border border-line bg-bg/40 px-4 pb-3 pt-4">
        {FLOOR_CHANNELS.map((c) => (
          <Meter key={c} ch={c} db={levels[c] ?? -90} peak={peaks.current[c]?.v ?? -90} />
        ))}
        {/* Üst şeritler: türetilir; hiçbir hoparlör kullanmıyorsa soluk. */}
        <div className="flex min-w-0 flex-[4] items-stretch justify-between gap-2.5 border-l border-line pl-2.5" title="Üst şeritler">
          {HEIGHT_CHANNELS.map((c) => (
            <Meter
              key={c}
              ch={c}
              db={levels[c] ?? -90}
              peak={peaks.current[c]?.v ?? -90}
              dim={!used.has(c)}
            />
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-faint">
        {runState === 'running' ? 'Örnek veri · canlı' : 'Başlat’a basınca seviyeler hareket eder (örnek veri).'}
      </p>
    </div>
  )
}

function Meter({ ch, db, peak, dim }: { ch: LogicalChannel; db: number; peak: number; dim?: boolean }) {
  const pos = (v: number) => Math.min(1, Math.max(0, (v - MIN_DB) / -MIN_DB))
  const hot = db > -6
  const warm = db > -18
  return (
    <div
      className={cx('flex min-w-0 flex-1 flex-col items-center gap-1.5', dim && 'opacity-35')}
      title={dim ? `${CHANNEL_LABELS[ch]}: hiçbir hoparlör kullanmıyor` : CHANNEL_LABELS[ch]}
    >
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
