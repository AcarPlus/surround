import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { CalibrationProgress, CalibrationResult } from '../api/types'
import { describeError, useStore } from '../store/useStore'
import {
  calibrationPatches,
  calibrationPercent,
  computeCalibration,
  isSubwoofer,
  msToMeters,
  type LevelTarget,
} from '../lib/calibration'
import { fmt, fmtSigned } from '../lib/format'
import { RoomCanvas } from '../components/RoomCanvas'
import { Badge, Button, Card, Field, NumberField, ScreenHeader, SectionTitle, Segmented, Select, Switch, cx } from '../components/ui'
import { IconCheck, IconMic, IconVolume, IconWarn } from '../components/icons'

type Phase = 'setup' | 'running' | 'result'

/** Backend'in kullanıcı iptalinde döndürdüğü metin (hata sayılmaz). */
const CANCELLED = 'Kalibrasyon iptal edildi.'

const LEVELS = [
  { value: '-30', label: 'Kısık' },
  { value: '-20', label: 'Orta' },
  { value: '-12', label: 'Yüksek' },
]

export function CalibrationScreen() {
  const devices = useStore((s) => s.devices)
  const speakers = useStore((s) => s.speakers)
  const outputs = useStore((s) => s.outputs)
  const source = useStore((s) => s.source)
  const runState = useStore((s) => s.runState)
  const lastCalibration = useStore((s) => s.lastCalibration)
  const applyCalibration = useStore((s) => s.applyCalibration)
  const showToast = useStore((s) => s.showToast)
  const openWizard = useStore((s) => s.openWizard)

  const mics = devices.filter((d) => d.flow === 'capture' && !/cable/i.test(d.name))
  const [micId, setMicId] = useState(() => (mics.find((d) => d.isDefault) ?? mics[0])?.id ?? '')
  const [loopback, setLoopback] = useState(false)
  const [loopbackId, setLoopbackId] = useState('')
  const [level, setLevel] = useState('-20')
  const [repeats, setRepeats] = useState('2')
  // Loopback kaynağında, kaynak cihazdaki hoparlörler ölçülemez (backend tüm ölçümü reddeder).
  const onSource = (sp: { outputDeviceId: string }) => source.mode === 'loopback' && sp.outputDeviceId === source.deviceId
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(speakers.filter((s) => !s.mute && !onSource(s)).map((s) => s.id)),
  )
  const [refId, setRefId] = useState(() => speakers.find((s) => !s.mute && !isSubwoofer(s))?.id ?? speakers[0]?.id ?? '')
  const [advanced, setAdvanced] = useState(false)

  const [phase, setPhase] = useState<Phase>('setup')
  const [progress, setProgress] = useState<CalibrationProgress | null>(null)
  const [result, setResult] = useState<CalibrationResult | null>(null)
  const [target, setTarget] = useState<LevelTarget>('quietest')
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!micId && mics[0]) setMicId(mics[0].id)
  }, [micId, mics])

  useEffect(
    () =>
      api.onCalibration((p) => {
        setProgress(p)
        useStore.setState({ playing: p.phase === 'measuring' ? (p.speakerId ?? null) : null })
      }),
    [],
  )
  // Ölçüm sürerken ekrandan çıkılırsa iptal et: aksi halde sonuç kaybolur ve sonraki başlatma "zaten sürüyor" der.
  const runningRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      useStore.setState({ playing: null })
      if (runningRef.current) void api.cancelCalibration().catch(() => {})
    }
  }, [])

  const list = speakers.filter((s) => chosen.has(s.id) && !onSource(s))
  const ref = list.some((s) => s.id === refId) ? refId : (list.find((s) => !isSubwoofer(s))?.id ?? list[0]?.id)
  const renders = devices.filter((d) => d.flow === 'render')
  const effectiveMic = loopback ? loopbackId || renders[0]?.id : micId
  const canStart = list.length >= 1 && !!effectiveMic

  const start = async () => {
    setPhase('running')
    setResult(null)
    setExcluded(new Set())
    setProgress({ phase: 'preparing', index: 0, total: list.length, message: 'Hazırlanıyor…' })
    runningRef.current = true
    try {
      // Backend yapılandırmayı diskten okur: bekleyen kaydı önce yaz.
      await useStore.getState().flushSave()
      const r = await api.calibrate({
        micDeviceId: effectiveMic!,
        micLoopback: loopback || undefined,
        speakerIds: list.map((s) => s.id),
        referenceSpeakerId: ref,
        lowBandSpeakerIds: list.filter(isSubwoofer).map((s) => s.id),
        repeats: Number(repeats),
        levelDb: Number(level),
      })
      if (!mounted.current) return
      setResult(r)
      setPhase('result')
    } catch (e) {
      if (!mounted.current) return
      setPhase('setup')
      const msg = describeError(e)
      if (msg === CANCELLED) showToast(msg, 3000)
      else showToast(msg, 7000, { tone: 'error' })
    } finally {
      runningRef.current = false
      useStore.setState({ playing: null })
      // Backend ölçümden sonra motoru yeniden başlatır; başarısız olduysa üst çubuk eski durumu göstermesin.
      void useStore.getState().syncRunState()
    }
  }

  const rows = useMemo(
    () => (result ? computeCalibration(result, speakers, { target, excluded, outputs }) : []),
    [result, speakers, target, excluded, outputs],
  )

  if (speakers.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <ScreenHeader title="Kalibrasyon" sub="Mikrofonla gecikme ve seviye ölçümü." />
        <Card className="mx-auto max-w-[620px] p-6 text-center">
          <p className="text-[13px] text-muted">Önce hoparlörlerini tanıtmalısın.</p>
          <Button variant="primary" className="mt-3" onClick={openWizard}>
            Kurulum sihirbazı
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <ScreenHeader
        title="Kalibrasyon"
        sub="Her hoparlörden kısa bir tarama sesi çalınır, mikrofon dinleme noktasında kaydeder. Cihaz gecikmeleri ve seviye farkları ölçülüp düzeltilir."
        right={
          lastCalibration ? (
            <Badge tone="ok">
              Son ölçüm: {new Date(lastCalibration.at).toLocaleDateString('tr-TR')} · {lastCalibration.speakers} hoparlör
            </Badge>
          ) : undefined
        }
      />

      {phase === 'setup' && (
        <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <Card className="p-4">
              <SectionTitle>1 · Mikrofon</SectionTitle>
              {mics.length === 0 && !loopback ? (
                <p className="flex items-center gap-2 text-[13px] text-warn">
                  <IconWarn /> Kayıt cihazı bulunamadı. Bir mikrofon (kulaklık mikrofonu da olur) tak.
                </p>
              ) : (
                <Field label="Kayıt cihazı">
                  <Select ariaLabel="Mikrofon" value={micId} onChange={setMicId} disabled={loopback}>
                    {mics.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.isDefault ? ' · varsayılan' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <ul className="mt-3 space-y-1.5 text-[13px] text-muted">
                <li>• Mikrofonu oturduğun yere, kulak hizasına koy; ölçüm boyunca kıpırdatma.</li>
                <li>• Kulaklık mikrofonu: kulaklığı başına takmadan, mikrofonu tavana bakacak şekilde bırak.</li>
                <li>• Odayı sessizleştir; ölçüm hoparlör başına ~2 sn sürer.</li>
                <li>
                  • Gürültü engellemeli (ENC) mikrofonlar sesi bastırabilir; sonuçta “zayıf sinyal” görürsen seviyeyi artır.
                </li>
              </ul>
            </Card>

            <Card className="p-4">
              <SectionTitle>2 · Ölçülecek hoparlörler</SectionTitle>
              <ul className="divide-y divide-line rounded-md border border-line">
                {speakers.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[rgb(var(--accent))]"
                      checked={chosen.has(s.id) && !onSource(s)}
                      disabled={onSource(s)}
                      aria-label={`${s.name} ölçülsün`}
                      onChange={(e) => {
                        const n = new Set(chosen)
                        if (e.target.checked) n.add(s.id)
                        else n.delete(s.id)
                        setChosen(n)
                      }}
                    />
                    <span className={cx('flex-1 text-[13px]', (s.mute || onSource(s)) && 'text-faint')}>
                      {s.name}
                      {onSource(s) && (
                        <span className="block text-xs text-faint">
                          Ses kaynağıyla aynı cihazda: ölçülemez (kaynağı VB-Cable yap ya da hoparlörü başka cihaza taşı).
                        </span>
                      )}
                    </span>
                    {isSubwoofer(s) && <Badge>bas bandı</Badge>}
                    {s.calibratedAt && <Badge tone="ok">ölçülmüş</Badge>}
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <input
                        type="radio"
                        name="ref"
                        className="accent-[rgb(var(--accent))]"
                        checked={ref === s.id}
                        disabled={!chosen.has(s.id) || onSource(s)}
                        onChange={() => setRefId(s.id)}
                      />
                      referans
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-faint">
                Referans hoparlör her ölçümde zaman damgası olarak birlikte çalar; genelde ön sol iyi bir seçimdir.
              </p>
            </Card>

            <Card className="p-4">
              <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setAdvanced((v) => !v)}>
                {advanced ? '▾' : '▸'} Gelişmiş
              </button>
              {advanced && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Tarama seviyesi">
                      <Segmented value={level} onChange={setLevel} options={LEVELS} size="sm" />
                    </Field>
                    <Field label="Tekrar (medyan alınır)">
                      <Segmented
                        value={repeats}
                        onChange={setRepeats}
                        size="sm"
                        options={[
                          { value: '1', label: '1' },
                          { value: '2', label: '2' },
                          { value: '3', label: '3' },
                        ]}
                      />
                    </Field>
                  </div>
                  <label className="flex items-center justify-between gap-3 text-[13px]">
                    <span>
                      Mikrofon yerine çıkış cihazının loopback’i (deneme)
                      <span className="block text-xs text-faint">Sesi dijital olarak geri okur; akustik ölçmez, zinciri sınar.</span>
                    </span>
                    <Switch checked={loopback} onChange={setLoopback} label="Loopback ile dene" />
                  </label>
                  {loopback && (
                    <Select ariaLabel="Loopback cihazı" value={loopbackId || renders[0]?.id || ''} onChange={setLoopbackId}>
                      {renders.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="h-[280px] overflow-hidden">
              <RoomCanvas editable={false} compact showLegend={false} />
            </Card>
            <Card className="p-4">
              <Button variant="primary" className="h-10 w-full text-[14px]" onClick={() => void start()} disabled={!canStart}>
                <IconMic width={16} height={16} /> Ölçümü başlat ({list.length} hoparlör)
              </Button>
              {runState === 'running' && (
                <p className="mt-2 text-xs text-muted">Ses motoru ölçüm sırasında durdurulur, sonra yeniden başlatılır.</p>
              )}
            </Card>
            <EarLevelCard />
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_420px]">
          <Card className="p-5">
            <SectionTitle>Ölçülüyor</SectionTitle>
            <p className="text-[15px] font-semibold">{progress?.message ?? 'Hazırlanıyor…'}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${calibrationPercent(progress)}%` }}
              />
            </div>
            <p className="num mt-2 text-xs text-muted">
              {progress?.phase === 'measuring'
                ? `${progress.index} / ${progress.total}`
                : progress?.phase === 'analyzing'
                  ? `Çözümleniyor ${progress.index} / ${progress.total}`
                  : ''}
            </p>
            <p className="mt-4 text-[13px] text-muted">Lütfen sessiz kal ve mikrofonu oynatma.</p>
            <Button className="mt-4" variant="danger" onClick={() => void api.cancelCalibration()}>
              İptal
            </Button>
          </Card>
          <Card className="h-[320px] overflow-hidden">
            <RoomCanvas editable={false} compact showLegend={false} />
          </Card>
        </div>
      )}

      {phase === 'result' && result && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <SectionTitle>Sonuç</SectionTitle>
              <span className="num text-xs text-muted">Ortam gürültüsü {fmt(result.noiseFloorDb, 0)} dBFS</span>
              {result.micClipped && (
                <Badge tone="warn">Mikrofon kırpıldı: seviyeyi düşürüp tekrar ölç</Badge>
              )}
              <div className="ml-auto flex items-center gap-2 text-xs text-muted">
                Seviye hedefi
                <Segmented
                  size="sm"
                  value={target}
                  onChange={setTarget}
                  options={[
                    { value: 'quietest', label: 'En sessize eşitle' },
                    { value: 'median', label: 'Ortancaya eşitle' },
                  ]}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="text-[11px] uppercase tracking-[0.06em] text-faint">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-2 font-semibold">Uygula</th>
                    <th className="py-2 pr-2 font-semibold">Hoparlör</th>
                    <th className="py-2 pr-2 text-right font-semibold">Varış</th>
                    <th className="py-2 pr-2 text-right font-semibold">Seviye</th>
                    <th className="py-2 pr-2 text-right font-semibold">SNR</th>
                    <th className="py-2 pr-2 text-right font-semibold">Gecikme</th>
                    <th className="py-2 pr-2 text-right font-semibold">Kazanç</th>
                    <th className="py-2 font-semibold">Not</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.speakerId} className={cx('border-b border-line align-top', !r.include && 'text-faint')}>
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[rgb(var(--accent))]"
                          checked={r.include}
                          disabled={!r.ok}
                          aria-label={`${r.name} uygulansın`}
                          onChange={(e) => {
                            const n = new Set(excluded)
                            if (e.target.checked) n.delete(r.speakerId)
                            else n.add(r.speakerId)
                            setExcluded(n)
                          }}
                        />
                      </td>
                      <td className="py-2 pr-2 font-medium">
                        {r.name}
                        {r.speakerId === result.referenceSpeakerId && <span className="ml-1.5 text-xs text-faint">(referans)</span>}
                      </td>
                      <td className="num py-2 pr-2 text-right">
                        {r.ok ? (
                          <>
                            {fmtSigned(r.arrivalMs, 2)} ms
                            <span className="block text-[11px] text-faint">≈ {fmtSigned(msToMeters(r.arrivalMs), 2)} m</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num py-2 pr-2 text-right">{r.ok ? `${fmtSigned(r.levelDb, 1)} dB` : '—'}</td>
                      <td className={cx('num py-2 pr-2 text-right', r.snrDb < 15 && 'text-warn')}>{fmt(r.snrDb, 0)} dB</td>
                      <td className="num py-2 pr-2 text-right">
                        <Change from={r.prevDelayMs} to={r.delayMs} unit="ms" active={r.include} />
                      </td>
                      <td className="num py-2 pr-2 text-right">
                        {r.gainDb === null ? (
                          <span className="text-faint">değişmez</span>
                        ) : (
                          <Change from={r.prevGainDb} to={r.gainDb} unit="dB" active={r.include} dp={1} />
                        )}
                      </td>
                      <td className="py-2 text-xs">
                        {r.warning ? (
                          <span className={cx(r.ok ? 'text-muted' : 'text-warn')}>{r.warning}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-ok">
                            <IconCheck width={13} height={13} /> İyi
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-faint">
              Varış farkı mesafeye ek olarak cihazların kendi gecikmesini de içerir (ör. iki ayrı ses kartı). En geç ulaşan
              hoparlör 0 ms alır, diğerleri ona göre bekletilir. Uygulanan değerler “Otomatik”ten çıkar; Ctrl+Z ile geri alınabilir.
            </p>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!rows.some((r) => r.include)}
              onClick={() => {
                const at = new Date().toISOString()
                applyCalibration(calibrationPatches(rows, at), result.micDeviceId, at)
                setPhase('setup')
              }}
            >
              <IconCheck /> Uygula ({rows.filter((r) => r.include).length} hoparlör)
            </Button>
            <Button onClick={() => void start()}>Tekrar ölç</Button>
            <Button variant="ghost" onClick={() => setPhase('setup')}>
              Vazgeç
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Mikrofon yoksa ya da ölçüm güvenilmezse: her hoparlörü çalıp kazancını kulakla ayarla. */
function EarLevelCard() {
  const speakers = useStore((s) => s.speakers)
  const auto = useStore((s) => s.auto)
  const playing = useStore((s) => s.playing)
  const playTone = useStore((s) => s.playTone)
  const updateSpeaker = useStore((s) => s.updateSpeaker)
  const setAuto = useStore((s) => s.setAuto)
  const [open, setOpen] = useState(false)
  return (
    <Card className="p-4">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
        <span>
          <span className="block text-[13px] font-semibold">Mikrofon yok mu? Kulakla eşitle</span>
          <span className="block text-xs text-muted">Her hoparlörü çal, hepsi aynı yükseklikte duyulana kadar kazancı ayarla.</span>
        </span>
        <span className="text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="mt-3 space-y-1.5">
          {speakers.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void playTone(s.id)}
                className={cx('rounded p-1 text-muted hover:text-fg', playing === s.id && 'text-accent')}
                aria-label={`${s.name} test sesi`}
              >
                <IconVolume />
              </button>
              <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
              <NumberField
                ariaLabel={`${s.name} kazanç`}
                className="w-[92px]"
                value={s.gainDb}
                min={-30}
                max={6}
                step={0.5}
                decimals={1}
                unit="dB"
                onChange={(v) => {
                  if (auto[s.id]?.gain !== false) setAuto(s.id, { gain: false })
                  updateSpeaker(s.id, { gainDb: v })
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Change({ from, to, unit, active, dp = 2 }: { from: number; to: number; unit: string; active: boolean; dp?: number }) {
  const same = Math.abs(from - to) < 10 ** -dp
  return (
    <span className="whitespace-nowrap">
      {!same && active && <span className="text-faint line-through">{fmt(from, dp)}</span>}
      {!same && active && ' → '}
      <span className={cx(active && !same && 'font-semibold text-fg')}>
        {fmt(active ? to : from, dp)} {unit}
      </span>
    </span>
  )
}
