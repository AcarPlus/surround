import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { findCable } from '../lib/health'
import { blockedBySource, buildQuickStart, quickStartDevices, quickStartKits, setTapAngle, tapKey } from '../lib/quickStart'
import { planSpeakers, type PlannedSpeaker } from '../lib/setup'
import { describeAngle } from '../lib/tapPlace'
import { TapPlaceView, useTapPlace } from '../components/TapPlace'
import { CableInstallCard } from './SourcePanels'
import { DeviceChecklist, toggleInSet } from '../components/DeviceChecklist'
import { Button, Card, cx } from '../components/ui'
import { IconX } from '../components/icons'

/**
 * "Ölçmeden başla": hoparlörleri otomatik bulur, her birinin sesini çalıp "nereden geliyor?" diye sorar,
 * ölçüm yapmadan (gecikme 0, kazanç 0, oda EQ'su yok) kurar ve motoru başlatır.
 */
export function QuickStart() {
  const devices = useStore((s) => s.devices)
  const source = useStore((s) => s.source)
  const speakers = useStore((s) => s.speakers)
  const outputs = useStore((s) => s.outputs)
  const room = useStore((s) => s.room)
  const applySetup = useStore((s) => s.applySetup)
  const toggleRun = useStore((s) => s.toggleRun)
  const closeQuickStart = useStore((s) => s.closeQuickStart)
  const showToast = useStore((s) => s.showToast)

  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  /** 0 = cihaz listesi; 1..n = hoparlör yerleştirme; n+1 = özet. */
  const [step, setStep] = useState(0)
  /** "cihaz#kanal" → dokunulan yön (derece). */
  const [angles, setAngles] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  const list = useMemo(() => quickStartDevices(devices, source.deviceId), [devices, source.deviceId])
  const plan: PlannedSpeaker[] = useMemo(
    () => planSpeakers(quickStartKits(list, excluded), devices),
    [list, excluded, devices],
  )
  const cable = findCable(devices)
  const blocked = blockedBySource(devices, source.deviceId)
  const last = plan.length + 1
  // Her hoparlör adımına girince sesi bir kez çalar; önceki dokunuş varsa kadranda gösterilir.
  const tap = useTapPlace(plan, step - 1, angles)
  const { cur, curKey, draft } = tap

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeQuickStart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeQuickStart])

  const toggleDevice = (id: string) => setExcluded((x) => toggleInSet(x, id))

  const commitDraft = () => {
    if (cur && draft !== null) setAngles((a) => setTapAngle(a, curKey, draft))
    setStep((s) => s + 1)
  }
  const skip = () => {
    if (cur) setAngles((a) => setTapAngle(a, curKey, null))
    setStep((s) => s + 1)
  }

  const finish = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = buildQuickStart({
        devices,
        sourceDeviceId: source.deviceId,
        excluded,
        angles: plan.map((p) => angles[tapKey(p.deviceId, p.channel)] ?? null),
        speakers,
        outputs,
        room,
      })
      applySetup(r, { autoForNew: false, silent: true })
      closeQuickStart()
      if (useStore.getState().runState === 'stopped') await toggleRun()
      if (useStore.getState().runState !== 'stopped') {
        showToast('Hazır. Daha iyi ses için Kolay kurulum ile ölçüm yapabilirsin.', 8000, {
          action: { label: 'Geri al', run: () => useStore.getState().undo() },
        })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Ölçmeden başla">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
        <span className="text-[15px] font-semibold">Ölçmeden başla</span>
        {step > 0 && plan.length > 0 && (
          <span className="num text-xs text-muted">{Math.min(step, plan.length)} / {plan.length}</span>
        )}
        <button
          type="button"
          onClick={closeQuickStart}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg"
          aria-label="Kapat"
          title="Kapat"
        >
          <IconX />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[560px] p-6">
          {step === 0 && (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Hoparlörlerini buldum</h1>
              <p className="mb-4 mt-1 text-[13px] text-muted">
                Bağlı her ses çıkışı bir hoparlör çifti sayılır. Kullanmak istemediklerinin işaretini kaldır; sonra her
                hoparlörün sesini çalıp nerede durduğunu soracağım.
              </p>
              {list.length === 0 ? (
                blocked ? (
                  <CableInstallCard
                    reason={
                      <>
                        <b>{blocked.name}</b> şu an Windows sesinin geldiği yer; Surround aynı cihazı hem dinleyip hem çalamaz.
                        Ücretsiz VB-Cable kurulunca Windows sesi ona gider ve bu hoparlör de kullanılabilir.
                      </>
                    }
                  />
                ) : (
                  <Card className="p-4 text-[13px] text-muted">
                    Kullanılabilir hoparlör çıkışı bulunamadı. Hoparlörlerini bağlayıp birkaç saniye bekle ya da Kolay kurulumu dene.
                  </Card>
                )
              ) : (
                <DeviceChecklist list={list} excluded={excluded} onToggle={toggleDevice} />
              )}
              {!cable && list.length > 0 && (
                <p className="mt-3 text-xs text-muted">
                  VB-Cable kurulu değil; ses şimdilik stereo olarak çoğaltılır. Gerçek 7.1 çevresel ses için Kolay kurulum
                  VB-Cable'ı senin için kurabilir.
                </p>
              )}
              {speakers.length > 0 && (
                <p className="mt-3 text-xs text-warn">
                  Mevcut hoparlör ayarların güncellenecek (Ctrl+Z ile geri alabilirsin).
                </p>
              )}
            </div>
          )}

          {cur && <TapPlaceView tap={tap} plan={plan} angles={angles} devices={devices} onConfirm={commitDraft} />}

          {step === last && (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Hazır!</h1>
              <p className="mb-4 mt-1 text-[13px] text-muted">
                {plan.length} hoparlör kurulacak ve ses başlayacak. Ölçüm yapılmadı; daha dengeli bir ses için sonra Kolay
                kurulumu kullanabilirsin.
              </p>
              <Card className="divide-y divide-line">
                {plan.map((p, i) => {
                  const a = angles[tapKey(p.deviceId, p.channel)]
                  return (
                    <div key={tapKey(p.deviceId, p.channel)} className="flex items-center justify-between gap-3 p-3 text-[13px]">
                      <span className="num text-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className={cx(a === undefined ? 'text-faint' : 'text-muted')}>
                        {a === undefined ? 'Standart yer' : describeAngle(a)}
                      </span>
                    </div>
                  )
                })}
              </Card>
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-5 py-3">
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
            Geri
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {step === 0 && (
            <Button variant="primary" disabled={plan.length === 0} onClick={() => setStep(1)}>
              Devam
            </Button>
          )}
          {cur && (
            <>
              <Button variant="ghost" onClick={skip}>
                Atla
              </Button>
              <Button variant="primary" disabled={draft === null} onClick={commitDraft}>
                {step === plan.length ? 'Bitir' : 'Sonraki'}
              </Button>
            </>
          )}
          {step === last && (
            <Button variant="primary" disabled={busy} onClick={() => void finish()}>
              {busy ? 'Başlıyor…' : 'Kur ve başlat'}
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}
