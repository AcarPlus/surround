import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { PHONE_MIC, type CalibrationResult } from '../api/types'
import { useStore } from '../store/useStore'
import { calibrationRequest, computeCalibration, defaultRepeats, micDevices, offCentreSuspect } from '../lib/calibration'
import {
  EASY_DEFAULT_LEVEL,
  checkMeasurement,
  easyPatches,
  easySteps,
  easySummary,
  gentleRoomEq,
  loadMicChoice,
  retryLevel,
  saveMicChoice,
  speakersToMeasure,
  stepAfter,
  stepBefore,
  weakIds,
  type EasyStep,
  type MicChoice,
} from '../lib/easySetup'
import { findCable } from '../lib/health'
import { blockedBySource, buildQuickStart, quickStartDevices, quickStartKits, setTapAngle, tapKey } from '../lib/quickStart'
import { planSpeakers } from '../lib/setup'
import { useCalibrationRun } from '../lib/useCalibrationRun'
import { usePhoneLink } from '../components/PhonePanel'
import { TapPlaceView, useTapPlace } from '../components/TapPlace'
import { toggleInSet } from '../components/DeviceChecklist'
import { Button } from '../components/ui'
import { IconMic, IconX } from '../components/icons'
import { DoneStep, EqStep, MeasureStep, MicStep, SourceStep, SpeakersStep, StepProgress } from './EasySetupSteps'

/**
 * Kolay kurulum (Basit kip): ses kaynağı (VB-Cable) → hoparlörler → mikrofon → konum (dokunarak) → ölçüm → yumuşak oda
 * düzeltmesi → bitti. Mevcut parçaları kullanır: `lib/quickStart` (plan ve dokunuşlar), `TapPlace`, `PhonePanel`,
 * `useCalibrationRun` + `lib/calibration` (ölçüm), `lib/roomEq` (yalnızca kısan sınırlarla), `CableInstallCard`.
 * Vazgeç (X / Esc) açılıştan beri yapılan tüm yapılandırma değişikliklerini geri alır (`cancelEasySetup`).
 * Hoparlörler varsa "Yeniden ölç" girişi (`openEasySetup({ step: 'mic' })`) doğrudan mikrofon adımından başlar.
 */
export function EasySetup() {
  const devices = useStore((s) => s.devices)
  const source = useStore((s) => s.source)
  const speakers = useStore((s) => s.speakers)
  const outputs = useStore((s) => s.outputs)
  const start = useStore((s) => s.easySetupStart)
  const applySetup = useStore((s) => s.applySetup)
  const applyCalibration = useStore((s) => s.applyCalibration)
  const toggleRun = useStore((s) => s.toggleRun)
  const showToast = useStore((s) => s.showToast)
  const closeEasySetup = useStore((s) => s.closeEasySetup)
  const cancelEasySetup = useStore((s) => s.cancelEasySetup)

  // Adım listesi açılıştaki girişe göre sabit kalır.
  const [steps] = useState(() => easySteps(start))
  const remeasure = steps[0] === 'mic'
  const [step, setStep] = useState<EasyStep>(steps[0])

  // 2 · Hoparlörler
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const list = useMemo(() => quickStartDevices(devices, source.deviceId), [devices, source.deviceId])
  const plan = useMemo(() => planSpeakers(quickStartKits(list, excluded), devices), [list, excluded, devices])
  const blocked = blockedBySource(devices, source.deviceId)
  const includedIds = useMemo(() => new Set(list.filter((d) => !excluded.has(d.id)).map((d) => d.id)), [list, excluded])

  // 3 · Mikrofon (son seçim hatırlanır)
  const mics = useMemo(() => micDevices(devices), [devices])
  const [mic, setMic] = useState<MicChoice | null>(() => loadMicChoice(micDevices(useStore.getState().devices)))
  const phoneMode = mic?.kind === 'phone'
  const phone = usePhoneLink(phoneMode && (step === 'mic' || step === 'measure'))
  const micReady = !!mic && (mic.kind === 'device' ? mics.some((d) => d.id === mic.deviceId) : !!phone.status?.connected)
  const micLabel = !mic ? '' : mic.kind === 'phone' ? 'Telefon' : (mics.find((d) => d.id === mic.deviceId)?.name ?? 'Mikrofon')

  // 4 · Konum
  const [angles, setAngles] = useState<Record<string, number>>({})
  const [placeIndex, setPlaceIndex] = useState(0)
  const tap = useTapPlace(plan, step === 'place' ? placeIndex : -1, angles)

  // 5 · Ölçüm
  const cal = useCalibrationRun()
  const [level, setLevel] = useState(EASY_DEFAULT_LEVEL)
  const [result, setResult] = useState<CalibrationResult | null>(null)
  const [measuredIds, setMeasuredIds] = useState<string[]>([])
  const [measureError, setMeasureError] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)
  /** Uygulanmış planın anahtarı: plan/dokunuşlar değişmediyse ölçümü tekrarlarken yeniden kurulmaz. */
  const appliedKey = useRef<string | null>(null)

  // 6 · Oda düzeltmesi
  const [roomEqOn, setRoomEqOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<string[]>([])

  const measureCount = remeasure ? speakersToMeasure(speakers, source).length : plan.length
  const measured = useMemo(() => speakers.filter((s) => measuredIds.includes(s.id)), [speakers, measuredIds])
  const weak = useMemo(() => (result ? weakIds(result) : new Set<string>()), [result])
  const rows = useMemo(
    () => (result ? computeCalibration(result, speakers, { excluded: weak, outputs }) : []),
    [result, speakers, weak, outputs],
  )
  const check = useMemo(
    () => (result ? checkMeasurement(result, speakers, offCentreSuspect(rows, speakers)) : null),
    [result, rows, speakers],
  )
  const matches = useMemo(() => (result ? gentleRoomEq(result, measured, weak) : []), [result, measured, weak])

  const go = (s: EasyStep) => setStep(s)
  const next = () => go(stepAfter(steps, step))
  const back = () => {
    if (step === 'place' && placeIndex > 0) return setPlaceIndex((i) => i - 1)
    // Önceki adımda plan değişebilir: eski ölçüm sonucu geçersiz.
    if (step === 'measure') setResult(null)
    let prev = stepBefore(steps, step)
    if (prev === 'place' && plan.length === 0) prev = stepBefore(steps, prev)
    if (prev === 'place') setPlaceIndex(Math.max(0, plan.length - 1))
    if (prev) go(prev)
  }

  const cancel = () => {
    if (step === 'done') return closeEasySetup()
    if (cal.isRunning()) void cal.cancel()
    if (phoneMode) void api.phoneLinkPrompt(null).catch(() => {})
    cancelEasySetup()
  }
  const cancelRef = useRef(cancel)
  cancelRef.current = cancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Baştan kurulumda planı (dokunuşlarla) uygular; değişmediyse tekrar uygulamaz. */
  const ensureApplied = () => {
    if (remeasure) return
    const key = JSON.stringify([[...excluded].sort(), plan.map((p) => angles[tapKey(p.deviceId, p.channel)] ?? null)])
    if (appliedKey.current === key) return
    const st = useStore.getState()
    const r = buildQuickStart({
      devices: st.devices,
      sourceDeviceId: st.source.deviceId,
      excluded,
      angles: plan.map((p) => angles[tapKey(p.deviceId, p.channel)] ?? null),
      speakers: st.speakers,
      outputs: st.outputs,
      room: st.room,
    })
    applySetup(r, { autoForNew: false, silent: true })
    appliedKey.current = key
  }

  const measure = async (lvl = level) => {
    if (!mic || cal.isRunning()) return
    setMeasureError(null)
    setStopped(false)
    setResult(null)
    setLevel(lvl)
    ensureApplied()
    const st = useStore.getState()
    const list = speakersToMeasure(st.speakers, st.source, remeasure ? undefined : includedIds)
    if (list.length === 0) {
      setMeasureError('Ölçülecek hoparlör yok.')
      return
    }
    setMeasuredIds(list.map((s) => s.id))
    const isPhone = mic.kind === 'phone'
    const out = await cal.run(
      calibrationRequest({
        micDeviceId: isPhone ? PHONE_MIC : mic.deviceId,
        speakers: list,
        repeats: defaultRepeats(isPhone),
        levelDb: lvl,
        responses: true,
      }),
      {
        beforeStart: () => {
          if (isPhone)
            void api.phoneLinkPrompt('Telefonu oturduğun yerde, kulak hizasında tut. Hoparlörler sırayla ses çıkaracak.').catch(() => {})
        },
      },
    )
    if (isPhone) void api.phoneLinkPrompt(null).catch(() => {})
    if (!out) return
    if (!out.ok) {
      if (out.cancelled) setStopped(true)
      else setMeasureError(out.message)
      return
    }
    setResult(out.result)
    const r = out.result
    const w = weakIds(r)
    const rws = computeCalibration(r, st.speakers, { excluded: w, outputs: st.outputs })
    // Sorunsuzsa doğrudan oda düzeltmesine geç; sorun varsa kullanıcı karar verir (zayıflar sessizce uygulanmaz).
    if (checkMeasurement(r, st.speakers, offCentreSuspect(rws, st.speakers)).status === 'ok') go('eq')
  }

  // Telefondaki "Ölçümü başlat": ölçüm adımında, ölçüm yokken.
  const phoneStartRef = useRef<() => void>(() => {})
  phoneStartRef.current = () => {
    if (step === 'measure' && !cal.isRunning() && micReady && (!result || check?.status !== 'ok')) void measure()
  }
  useEffect(() => api.onPhoneStart(() => phoneStartRef.current()), [])

  const finish = async () => {
    if (!result || busy) return
    setBusy(true)
    try {
      const at = new Date().toISOString()
      const patches = easyPatches(rows, matches, roomEqOn, at)
      if (Object.keys(patches).length > 0) applyCalibration(patches, result.micDeviceId, at, { silent: true })
      const st = useStore.getState()
      if (st.runState === 'stopped') await toggleRun()
      const anyBands = matches.some((m) => m.bands.length > 0)
      setSummary(
        easySummary({
          speakers: useStore.getState().speakers.filter((s) => !s.mute).length,
          measured: rows.filter((r) => r.include).length,
          skipped: weak.size,
          roomEq: !result.responseHz || matches.length === 0 ? 'unavailable' : !anyBands ? 'none-needed' : roomEqOn ? 'applied' : 'off',
          cable: !!findCable(st.devices),
        }),
      )
      go('done')
      showToast('Kurulum tamam. İyi dinlemeler!', 5000)
    } finally {
      setBusy(false)
    }
  }

  const seconds = Math.round(measureCount * defaultRepeats(phoneMode) * 2.4 + 3)
  const measuredOk = check?.status === 'ok'
  const curPlace = step === 'place' ? tap.cur : null
  const commitPlace = (angle: number | null) => {
    if (curPlace) setAngles((a) => setTapAngle(a, tap.curKey, angle))
    if (placeIndex + 1 < plan.length) setPlaceIndex(placeIndex + 1)
    else go('measure')
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Kolay kurulum">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
        <span className="shrink-0 text-[15px] font-semibold">{remeasure ? 'Yeniden ölç' : 'Kolay kurulum'}</span>
        <StepProgress steps={steps} current={step} />
        <button
          type="button"
          onClick={cancel}
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg"
          aria-label={step === 'done' ? 'Kapat' : 'Vazgeç'}
          title={step === 'done' ? 'Kapat' : 'Vazgeç (yapılan değişiklikler geri alınır)'}
        >
          <IconX />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[620px] p-6">
          {step === 'source' && <SourceStep onSkip={next} />}
          {step === 'speakers' && (
            <SpeakersStep
              list={list}
              excluded={excluded}
              onToggle={(id) => setExcluded((x) => toggleInSet(x, id))}
              blocked={blocked}
              hasSpeakers={speakers.length > 0}
            />
          )}
          {step === 'mic' && <MicStep choice={mic} onChoice={setMic} mics={mics} phone={phone} />}
          {step === 'place' && curPlace && (
            <>
              <p className="num mb-3 text-center text-xs text-muted">
                Hoparlör {placeIndex + 1} / {plan.length}
              </p>
              <TapPlaceView tap={tap} plan={plan} angles={angles} devices={devices} onConfirm={() => commitPlace(tap.draft)} />
            </>
          )}
          {step === 'measure' && (
            <MeasureStep
              running={cal.running}
              progress={cal.progress}
              count={measureCount}
              done={measuredOk}
              micLabel={micLabel}
              seconds={seconds}
              error={measureError}
              stopped={stopped}
              check={check}
              phone={phoneMode}
              onRetry={() => check && void measure(retryLevel(level, check))}
              onContinue={() => go('eq')}
              onChangeMic={() => go('mic')}
              onCancel={() => void cal.cancel()}
            />
          )}
          {step === 'eq' && (
            <EqStep
              available={!!result?.responseHz && matches.length > 0}
              matches={matches}
              speakers={speakers}
              enabled={roomEqOn}
              onEnabled={setRoomEqOn}
              skipped={weak.size}
            />
          )}
          {step === 'done' && <DoneStep lines={summary} />}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-5 py-3">
        {step !== 'done' && stepBefore(steps, step) !== null && (
          <Button variant="ghost" onClick={back} disabled={cal.running || busy}>
            Geri
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {step === 'source' && (
            <Button variant="primary" onClick={next}>
              İleri
            </Button>
          )}
          {step === 'speakers' && (
            <Button variant="primary" disabled={plan.length === 0} onClick={() => (setPlaceIndex(0), next())}>
              İleri
            </Button>
          )}
          {step === 'mic' && (
            <Button
              variant="primary"
              disabled={!micReady}
              title={!mic ? 'Önce bir mikrofon seç' : !micReady ? 'Telefonun bağlanmasını bekle' : undefined}
              onClick={() => {
                if (mic) saveMicChoice(mic)
                if (!remeasure && plan.length === 0) go('measure')
                else next()
              }}
            >
              İleri
            </Button>
          )}
          {step === 'place' && curPlace && (
            <>
              <Button variant="ghost" onClick={() => commitPlace(null)}>
                Atla
              </Button>
              <Button variant="primary" disabled={tap.draft === null} onClick={() => commitPlace(tap.draft)}>
                {placeIndex + 1 === plan.length ? 'Ölçüme geç' : 'Sonraki'}
              </Button>
            </>
          )}
          {step === 'measure' && !cal.running && (!check || measuredOk) && (
            <Button variant={measuredOk ? 'default' : 'primary'} disabled={!micReady} onClick={() => void measure()}>
              <IconMic /> {measuredOk ? 'Tekrar ölç' : measureError || stopped ? 'Tekrar dene' : 'Ölçümü başlat'}
            </Button>
          )}
          {step === 'measure' && !cal.running && measuredOk && (
            <Button variant="primary" onClick={() => go('eq')}>
              İleri
            </Button>
          )}
          {step === 'eq' && (
            <Button variant="primary" disabled={busy} onClick={() => void finish()}>
              {busy ? 'Uygulanıyor…' : 'Uygula ve bitir'}
            </Button>
          )}
          {step === 'done' && (
            <Button variant="primary" onClick={closeEasySetup}>
              Bitti
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}
