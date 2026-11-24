import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { PHONE_MIC, type CalibrationResult, type Speaker } from '../api/types'
import { PhonePanel, usePhoneLink } from '../components/PhonePanel'
import { MatchCurve } from '../components/MatchCurve'
import { bandsDb, matchSpeakers, type MatchResult, type MatchTarget } from '../lib/roomEq'
import { useStore } from '../store/useStore'
import {
  calibrationPatches,
  calibrationPercent,
  calibrationRequest,
  computeCalibration,
  isSubwoofer,
  matchInputs,
  micDevices,
  msToMeters,
  offCentreSuspect,
  onSourceDevice,
  pickReference,
  withRoomEq,
  MIN_SNR_DB,
  type LevelTarget,
} from '../lib/calibration'
import { useCalibrationRun } from '../lib/useCalibrationRun'
import { fmt, fmtSigned } from '../lib/format'
import { RoomCanvas } from '../components/RoomCanvas'
import { MeasureRadar, ProgressRing, StepTimeline, Burst } from '../components/aurora'
import { radarStates, stepStates } from '../lib/aurora'
import { angleFromListener } from '../lib/roles'
import { deviceColorVar } from '../lib/colors'
import { Badge, Button, Card, Field, NumberField, ScreenHeader, SectionTitle, Select, cx } from '../components/ui'
import { IconCheck, IconMic, IconVolume, IconWarn } from '../components/icons'

type Phase = 'setup' | 'running' | 'between' | 'result'

/** Tını eşlemede ölçüm konumları: ilki dinleme noktası (gecikme/seviye oradan), diğerleri yalnızca EQ ortalaması için. */
const POSITIONS = [
  'Dinleme noktası: başının olduğu yer, kulak hizası',
  'Dinleme noktasının ~30 cm soluna',
  'Dinleme noktasının ~30 cm sağına',
  'Dinleme noktasının ~20 cm önüne',
  'Dinleme noktasının ~20 cm arkasına (ya da biraz yukarı)',
]

/**
 * Ölçüm her zaman en iyi ayarla yapılır, kullanıcıya seçenek bırakılmaz: tını eşleme açık, 5 nokta, 3 tekrar (medyan).
 * Tarama seviyesi kendiliğinden ayarlanır: "Yüksek"te başlar; bir hoparlör ortam gürültüsünden yeterince ayrılmazsa
 * aynı nokta bir kez "Çok yüksek"te tekrarlanır, mikrofon doyarsa kısılıp tekrarlanır.
 */
const POSITION_COUNT = POSITIONS.length
const REPEATS = 3
const LEVEL_HIGH_DB = -12
const LEVEL_VERY_HIGH_DB = -6
const LEVEL_SAFE_DB = -20

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

  const mics = micDevices(devices)
  const [micId, setMicId] = useState(() => (mics.find((d) => d.isDefault) ?? mics[0])?.id ?? PHONE_MIC)
  // Son kullanılan seviye: bir kez yükseltilmesi gerektiyse sonraki noktalar da o seviyede ölçülür.
  const [level, setLevel] = useState(LEVEL_HIGH_DB)
  // Loopback kaynağında, kaynak cihazdaki hoparlörler ölçülemez (backend tüm ölçümü reddeder).
  const onSource = (sp: { outputDeviceId: string }) => onSourceDevice(sp, source)
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(speakers.filter((s) => !s.mute && !onSource(s)).map((s) => s.id)),
  )
  // Referans (zaman damgası) kendiliğinden: ilk sessize alınmamış, subwoofer olmayan hoparlör (genelde ön sol).
  const refId = speakers.find((s) => !s.mute && !isSubwoofer(s))?.id ?? speakers[0]?.id ?? ''

  const [phase, setPhase] = useState<Phase>('setup')
  const [result, setResult] = useState<CalibrationResult | null>(null)
  // Seviye en sessiz hoparlöre eşitlenir: hiçbir hoparlör yükseltilmez, kırpılma payı korunur.
  const target: LevelTarget = 'quietest'
  // Mikrofon ortada değil şüphesi: kullanıcı onaylayana kadar uygulanmaz.
  const [askConfirm, setAskConfirm] = useState(false)
  // Tını eşleme: frekans yanıtları, birkaç konumda ölçülüp ortalanır.
  const [taken, setTaken] = useState<CalibrationResult[]>([])
  // Tını hedefi ölçülen en düz/en geniş bantlı hoparlör: iyi bir hoparlör, donuk küçük önlere (ör. monitör) benzetilip
  // boğulmaz; diğerleri ona çekilir. Gecikme/seviye referansı ayrı (ön sol) kalır.
  const eqTarget: MatchTarget = 'best'

  const matchEq = true
  const phoneMode = micId === PHONE_MIC
  const phone = usePhoneLink(phoneMode)
  const repeats = REPEATS
  const cal = useCalibrationRun()
  const progress = cal.progress
  const room = useStore((s) => s.room)

  useEffect(() => {
    if (!micId && mics[0]) setMicId(mics[0].id)
  }, [micId, mics])

  const list = speakers.filter((s) => chosen.has(s.id) && !onSource(s))
  const ref = pickReference(list, refId)
  const effectiveMic = micId
  const canStart = list.length >= 1 && !!effectiveMic && (!phoneMode || !!phone.status?.connected)
  const wantPositions = POSITION_COUNT

  /**
   * Bir ölçüm turu. `mode`: 'first' yeni ölçüm (konum 1), 'next' tını eşlemenin sonraki konumu, 'verify' düzeltmeler
   * açıkken doğrulama (tek konum).
   */
  const start = async (mode: 'first' | 'next' | 'verify' = 'first', levelDb = level, retried = false): Promise<void> => {
    const prev = mode === 'next' ? taken : []
    setPhase('running')
    if (mode !== 'next') {
      setResult(null)
      setTaken([])
    }
    setAskConfirm(false)
    const out = await cal.run(
      calibrationRequest({
        micDeviceId: effectiveMic!,
        loopback: false,
        speakers: list,
        referenceId: ref,
        repeats: Number(repeats),
        levelDb,
        responses: matchEq,
        verify: mode === 'verify',
      }),
      {
        beforeStart: () => {
          if (phoneMode) void api.phoneLinkPrompt(matchEq && mode !== 'verify' ? konum(prev.length, wantPositions) : null).catch(() => {})
        },
      },
    )
    if (!out) return
    if (!out.ok) {
      setPhase(mode === 'next' ? 'between' : 'setup')
      if (out.cancelled) showToast(out.message, 3000)
      else showToast(out.message, 7000, { tone: 'error' })
      return
    }
    // Otomatik seviye: zayıf ölçümde bir kez daha yüksek sesle, mikrofon doyduysa daha kısık tekrarla.
    if (!retried) {
      const weak = out.result.speakers.some((m) => m.ok && m.snrDb < MIN_SNR_DB) || out.result.speakers.some((m) => !m.ok)
      const next = out.result.micClipped
        ? Math.max(LEVEL_SAFE_DB, levelDb - 8)
        : weak && levelDb < LEVEL_VERY_HIGH_DB
          ? LEVEL_VERY_HIGH_DB
          : null
      if (next !== null && next !== levelDb) {
        setLevel(next)
        return start(mode, next, true)
      }
    }
    const all = [...prev, out.result]
    setTaken(all)
    setResult(all[0])
    if (mode !== 'verify' && matchEq && all.length < wantPositions) {
      setPhase('between')
      if (phoneMode) void api.phoneLinkPrompt(`Şimdi: ${konum(all.length, wantPositions)}. Sonra “Ölçümü başlat”.`).catch(() => {})
    } else {
      setPhase('result')
      if (phoneMode) void api.phoneLinkPrompt(null).catch(() => {})
    }
  }

  // Telefondaki "Ölçümü başlat": kurulumda ilk konum, aradaysa sonraki konum.
  const phoneStartRef = useRef<() => void>(() => {})
  phoneStartRef.current = () => {
    if (cal.isRunning() || !canStart) return
    if (phase === 'setup') void start('first')
    else if (phase === 'between') void start('next')
  }
  useEffect(() => api.onPhoneStart(() => phoneStartRef.current()), [])

  // Ölçülemeyen ya da gürültüden yeterince ayrılmayan hoparlörlere düzeltme uygulanmaz (seçenek yok).
  const excluded = useMemo(
    () => new Set(result ? result.speakers.filter((m) => !m.ok || m.snrDb < MIN_SNR_DB).map((m) => m.speakerId) : []),
    [result],
  )
  const eqExcluded = excluded
  const rows = useMemo(
    () => (result ? computeCalibration(result, speakers, { target, excluded, outputs }) : []),
    [result, speakers, target, excluded, outputs],
  )
  const suspect = useMemo(() => offCentreSuspect(rows, speakers), [rows, speakers])
  const hz = result?.responseHz
  const matches = useMemo(() => {
    if (!hz || !result) return []
    return matchSpeakers(hz, matchInputs(list, taken), { target: eqTarget, referenceId: result.referenceSpeakerId, avoid: excluded })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hz, result, taken, eqTarget, speakers, excluded])

  // Aurora: ölçüm radarı (hoparlörler gerçek yönlerinde) ve konum çizelgesi.
  const radarIds = list.map((s) => s.id)
  const rstates = radarStates(radarIds, progress ?? null)
  const radar = list.map((s) => ({
    id: s.id,
    name: s.name,
    angle: angleFromListener(s, room.listener),
    color: deviceColorVar(s.outputDeviceId, devices),
    state: rstates[s.id] ?? 'pending',
  }))
  const posSteps = POSITIONS.slice(0, wantPositions)

  if (speakers.length === 0) {
    return (
      <div className="screen-page h-full overflow-y-auto px-6 py-6">
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
    <div className="screen-page h-full overflow-y-auto px-6 py-6">
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
            <Card className="border-accent/40 p-4">
              <SectionTitle>Başlamadan önce</SectionTitle>
              <p className="text-[13px]">
                Mikrofonu başının olduğu yere, kulak hizasına koy; kulaklığın mikrofonunu kullanıyorsan kulaklığı takıp otur.
              </p>
              <p className="mt-1 text-xs text-muted">
                Mikrofon ortada değilse ölçüm hoparlörlerin değil mikrofonun konumunu yansıtır: bir taraf “erken” ya da “yüksek” çıkar.
              </p>
            </Card>

            <Card className="p-4">
              <SectionTitle>1 · Mikrofon</SectionTitle>
              <Field label="Kayıt cihazı">
                <Select ariaLabel="Mikrofon" value={micId} onChange={setMicId}>
                  <option value={PHONE_MIC}>Telefon mikrofonu (QR kod ile)</option>
                  {mics.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.isDefault ? ' · varsayılan' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              {phoneMode && (
                <div className="mt-3">
                  <PhonePanel status={phone.status} error={phone.error} />
                </div>
              )}
              <ul className={cx('mt-3 space-y-1.5 text-[13px] text-muted', phoneMode && 'hidden')}>
                <li>• Mikrofonu oturduğun yere, kulak hizasına koy; ölçüm boyunca kıpırdatma.</li>
                <li>• Kulaklık mikrofonu: kulaklığı tak ve dinleme konumunda otur; ölçüm sırasında kıpırdama.</li>
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
                    {ref === s.id && <span className="text-xs text-faint">referans</span>}
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-4">
              <SectionTitle>3 · Tını eşleme</SectionTitle>
              <p className="text-[13px]">Hoparlörlerin sesi birbirine benzetilir; ayar gerekmez.</p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                <li>· Her hoparlör {POSITION_COUNT} noktada ölçülür; noktalar arasında mikrofonu/telefonu taşıyacaksın.</li>
                <li>· Her ölçüm {REPEATS} kez tekrarlanır, ortadaki değer alınır.</li>
                <li>· Ses seviyesi kendiliğinden ayarlanır: oda gürültülüyse daha yüksek sesle tekrarlanır.</li>
                <li>· Kendi EQ ayarların korunur; gecikme ve seviye de aynı turda ölçülür.</li>
              </ul>
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
              {phoneMode && !phone.status?.connected && (
                <p className="mt-2 text-xs text-warn">Önce telefonu bağla: QR kodu okut ve sayfada “Mikrofonu aç”a dokun.</p>
              )}
              {matchEq && wantPositions > 1 && (
                <p className="mt-2 text-xs text-muted">
                  {wantPositions} konumda ölçülecek (her biri ~{Math.round(list.length * Number(repeats) * 2.4 + 3)} sn).
                </p>
              )}
              {runState === 'running' && (
                <p className="mt-2 text-xs text-muted">Ses motoru ölçüm sırasında durdurulur, sonra yeniden başlatılır.</p>
              )}
              {lastCalibration && (
                <div className="mt-3 border-t border-line pt-3">
                  <Button className="w-full" disabled={!canStart} onClick={() => void start('verify')}>
                    <IconCheck /> Doğrula (düzeltmeler açıkken ölç)
                  </Button>
                  <p className="mt-1.5 text-xs text-faint">
                    Uygulanan gecikme, kazanç ve tını EQ’su açıkken bir kez daha ölçer: kalan farkı gösterir, gerekirse yeni
                    düzeltme önerir. Hepsi aynı duyulana kadar tekrarlayabilirsin.
                  </p>
                </div>
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
            <div className="flex items-center gap-5">
              <ProgressRing
                fraction={calibrationPercent(progress) / 100}
                label={`%${Math.round(calibrationPercent(progress))}`}
                sub={progress?.phase === 'analyzing' ? 'Çözümleniyor' : 'Ölçüm'}
              />
              <p className="text-[15px] font-semibold">{progress?.message ?? 'Hazırlanıyor…'}</p>
            </div>
            <p className="num mt-2 text-xs text-muted">
              {progress?.phase === 'measuring'
                ? `${progress.index} / ${progress.total}`
                : progress?.phase === 'analyzing'
                  ? `Çözümleniyor ${progress.index} / ${progress.total}`
                  : ''}
            </p>
            {matchEq && wantPositions > 1 && (
              <div className="mt-4">
                <StepTimeline steps={posSteps} states={stepStates(wantPositions, taken.length)} />
              </div>
            )}
            {matchEq && wantPositions > 1 && (
              <p className="mt-3 text-[13px]">
                Konum {Math.min(taken.length + 1, wantPositions)} / {wantPositions}: {POSITIONS[Math.min(taken.length, POSITIONS.length - 1)]}
              </p>
            )}
            <p className="mt-4 text-[13px] text-muted">Lütfen sessiz kal ve mikrofonu oynatma.</p>
            <Button className="mt-4" variant="danger" onClick={() => void cal.cancel()}>
              İptal
            </Button>
          </Card>
          <Card className="flex h-[360px] items-center justify-center overflow-hidden p-3">
            <MeasureRadar speakers={radar} sweeping={progress?.phase !== 'analyzing'} />
          </Card>
        </div>
      )}

      {phase === 'between' && (
        <Card className="mx-auto max-w-[620px] p-5">
          <SectionTitle>
            Konum {taken.length} / {wantPositions} tamam
          </SectionTitle>
          <div className="mb-4 mt-1">
            <StepTimeline steps={posSteps} states={stepStates(wantPositions, taken.length)} />
          </div>
          <p className="text-[15px] font-semibold">Mikrofonu taşı: {POSITIONS[Math.min(taken.length, POSITIONS.length - 1)]}</p>
          <p className="mt-1 text-[13px] text-muted">
            Aynı yükseklikte ve aynı yöne bakacak şekilde tut. Hazır olunca devam et{phoneMode ? ' (telefondaki düğme de olur)' : ''}.
          </p>
          <p className="mt-1 text-xs text-faint">
            İstersen burada bitirebilirsin: gecikme ve seviye ilk konumdan zaten ölçüldü; tını eşleme {taken.length} konumun
            ortalamasıyla yapılır (daha az konum, odaya daha az dayanıklı).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!canStart} onClick={() => void start('next')}>
              <IconMic /> Devam: konum {taken.length + 1}
            </Button>
            <Button
              onClick={() => {
                setPhase('result')
                if (phoneMode) void api.phoneLinkPrompt(null).catch(() => {})
              }}
            >
              <IconCheck /> Buraya kadarıyla bitir
            </Button>
            <Button variant="ghost" onClick={() => setPhase('setup')}>
              Vazgeç
            </Button>
          </div>
        </Card>
      )}

      {phase === 'result' && result && (
        <div className="space-y-4">
          <Card className="relative p-4">
            <span className="absolute left-10 top-6"><Burst key={taken.length} count={18} radius={90} /></span>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <SectionTitle>{result.verified ? 'Doğrulama (düzeltmeler açıkken)' : 'Sonuç'}</SectionTitle>
              <span className="num text-xs text-muted">Ortam gürültüsü {fmt(result.noiseFloorDb, 0)} dBFS</span>
              {result.note && <span className="text-xs text-faint">{result.note}</span>}
              {result.micClipped && (
                <Badge tone="warn">Mikrofon kırpıldı: seviyeyi düşürüp tekrar ölç</Badge>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="text-[11px] uppercase tracking-[0.06em] text-faint">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-2 font-semibold">Hoparlör</th>
                    <th className="py-2 pr-2 text-right font-semibold">Varış</th>
                    <th className="py-2 pr-2 text-right font-semibold">Seviye</th>
                    <th className="py-2 pr-2 text-right font-semibold">SNR</th>
                    {result.verified && <th className="py-2 pr-2 text-right font-semibold">Şu an duyulan fark</th>}
                    <th className="py-2 pr-2 text-right font-semibold">Gecikme</th>
                    <th className="py-2 pr-2 text-right font-semibold">Kazanç</th>
                    <th className="py-2 font-semibold">Not</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.speakerId} className={cx('border-b border-line align-top', !r.include && 'text-faint')}>
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
                      {result.verified && <Residual m={result.speakers.find((x) => x.speakerId === r.speakerId)} />}
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
          {suspect && (
            <Card className="border-warn/60 p-4">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-warn">
                <IconWarn /> Mikrofon büyük olasılıkla ortada değil
              </p>
              <p className="mt-1 text-[13px] text-muted">
                Tüm hoparlörler aynı cihazda; {suspect.pair} arasında {fmt(suspect.deltaMs, 1)} ms / {fmt(suspect.deltaDb, 1)} dB düzeltme
                öneriliyor. Aynı cihazdaki simetrik bir çiftte bu fark normalde çıkmaz; ölçümü mikrofonun konumu bozmuş olabilir.
                Mikrofonu dinleme konumuna alıp tekrar ölçmen önerilir.
              </p>
            </Card>
          )}
          {matches.length > 0 && hz && (
            <TimbreCard
              hz={hz}
              matches={matches}
              speakers={speakers}
              positions={taken.length}
              verified={!!result.verified}
              excluded={eqExcluded}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!rows.some((r) => r.include) && !matches.some((m) => !eqExcluded.has(m.speakerId))}
              onClick={() => {
                if (suspect && !askConfirm) {
                  setAskConfirm(true)
                  return
                }
                const at = new Date().toISOString()
                const patches = withRoomEq(calibrationPatches(rows, at), matches, eqExcluded, at)
                applyCalibration(patches, result.micDeviceId, at)
                setPhase('setup')
                if (phoneMode) void api.phoneLinkPrompt('Uygulandı. Doğrulamak için bilgisayardan “Doğrula”yı seç.').catch(() => {})
              }}
            >
              <IconCheck /> {askConfirm ? 'Mikrofon ortada, yine de uygula' : 'Uygula'} (
              {new Set([...rows.filter((r) => r.include).map((r) => r.speakerId), ...matches.filter((m) => !eqExcluded.has(m.speakerId)).map((m) => m.speakerId)]).size}{' '}
              hoparlör)
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

function konum(i: number, total: number): string {
  return `konum ${i + 1}/${total} — ${POSITIONS[Math.min(i, POSITIONS.length - 1)]}`
}

/** Doğrulamada referansa göre şu an duyulan fark; ±0,5 ms ve ±1 dB içi "iyi". */
function Residual({ m }: { m?: CalibrationResult['speakers'][number] }) {
  if (!m || m.residualArrivalMs === undefined || m.residualLevelDb === undefined)
    return <td className="py-2 pr-2 text-right text-faint">—</td>
  const good = Math.abs(m.residualArrivalMs) <= 0.5 && Math.abs(m.residualLevelDb) <= 1
  return (
    <td className={cx('num py-2 pr-2 text-right', good ? 'text-ok' : 'text-warn')}>
      {fmtSigned(m.residualArrivalMs, 2)} ms · {fmtSigned(m.residualLevelDb, 1)} dB
    </td>
  )
}

const rmsDev = (m: MatchResult, hz: readonly number[], extra: number[]) => {
  const idx = hz.map((f, i) => (f >= m.loHz && f <= m.hiHz ? i : -1)).filter((i) => i >= 0)
  const v = idx.map((i) => m.measured[i] + extra[i] - m.target[i])
  return Math.sqrt(v.reduce((a, x) => a + x * x, 0) / Math.max(1, v.length))
}

/** Tını eşleme sonucu: hoparlör başına eğri, bant sayısı ve sapma (önce → sonra). */
function TimbreCard(props: {
  hz: number[]
  matches: MatchResult[]
  speakers: Speaker[]
  positions: number
  verified: boolean
  excluded: Set<string>
}) {
  const { hz, matches, speakers, verified, excluded } = props
  const name = (id: string) => speakers.find((s) => s.id === id)?.name ?? id
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SectionTitle>Tını eşleme</SectionTitle>
        <span className="text-xs text-muted">
          {props.positions} konumun ortalaması · 1/6 oktav yumuşatılmış · seviye ayrı eşitlenir
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2 min-[1400px]:grid-cols-3">
        {matches.map((m) => {
          const current = speakers.find((s) => s.id === m.speakerId)?.roomEq ?? []
          const now = verified ? Math.round(rmsDev(m, hz, bandsDb(hz, current)) * 10) / 10 : null
          return (
            <div key={m.speakerId} className={cx('rounded-md border border-line p-3', excluded.has(m.speakerId) && 'opacity-50')}>
              <div className="mb-1 flex items-center gap-2">
                <span className="flex-1 truncate text-[13px] font-medium">{name(m.speakerId)}</span>
                {m.isTarget ? (
                  <Badge>hedef</Badge>
                ) : (
                  <span className="num text-xs text-muted">
                    {m.bands.length} bant · ±{fmt(m.rmsBefore, 1)} → <b className="text-fg">±{fmt(m.rmsAfter, 1)} dB</b>
                  </span>
                )}
              </div>
              <MatchCurve hz={hz} m={m} />
              {now !== null && !m.isTarget && (
                <p className={cx('mt-1 text-xs', now <= 1.5 ? 'text-ok' : 'text-warn')}>
                  Şu anki EQ ile sapma ±{fmt(now, 1)} dB{now <= 1.5 ? ' — eşleşmiş' : ' — yeni öneriyi uygulayabilirsin'}
                </p>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-faint">
        Kesikli: hedef · ince turuncu: ölçülen · kalın: önerilen EQ ile. Gri bölgeler eşlenmez (bas yönetimiyle kesilen ya da
        hoparlörün doğal olarak düştüğü uçlar, 12 kHz üstü). Çukurlar en fazla +3 dB doldurulur; derin çukur hoparlörün değil odanın/konumun olabilir. Subwoofer’lar eşlenmez.
      </p>
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
