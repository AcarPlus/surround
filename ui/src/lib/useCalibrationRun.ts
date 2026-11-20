import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { CalibrationProgress, CalibrationRequest, CalibrationResult } from '../api/types'
import { describeError, useStore } from '../store/useStore'
import { micPrivacyHint } from './errors'
import { CALIBRATION_CANCELLED } from './calibration'

export type CalibrationOutcome =
  | { ok: true; result: CalibrationResult }
  | { ok: false; message: string; cancelled: boolean }

/**
 * Bir ölçüm turunu yürütür (Kalibrasyon ekranı ve Kolay kurulum ortak):
 * ilerleme aboneliği (çalan hoparlör vurgusu dahil), bekleyen kaydı önce diske yazma, hata metni (mikrofon gizlilik
 * ipucu dahil), bitince motor durumunu eşitleme; ekrandan çıkılırsa süren ölçümü iptal eder (aksi halde sonuç kaybolur ve
 * sonraki başlatma "zaten sürüyor" der).
 */
export function useCalibrationRun() {
  const [progress, setProgress] = useState<CalibrationProgress | null>(null)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const mounted = useRef(true)

  useEffect(
    () =>
      api.onCalibration((p) => {
        setProgress(p)
        useStore.setState({ playing: p.phase === 'measuring' ? (p.speakerId ?? null) : null })
      }),
    [],
  )
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      useStore.setState({ playing: null })
      if (runningRef.current) void api.cancelCalibration().catch(() => {})
    }
  }, [])

  /**
   * Ölçer. Ekran kapandıysa null döner (sonuç işlenmemeli). `beforeStart` kayıt yazıldıktan hemen sonra, ölçümden
   * önce çağrılır (ör. telefona yönerge).
   */
  const run = useCallback(
    async (req: CalibrationRequest, opts: { beforeStart?: () => void } = {}): Promise<CalibrationOutcome | null> => {
      setProgress({ phase: 'preparing', index: 0, total: req.speakerIds.length, message: 'Hazırlanıyor…' })
      runningRef.current = true
      setRunning(true)
      try {
        // Backend yapılandırmayı diskten okur: bekleyen kaydı önce yaz.
        await useStore.getState().flushSave()
        opts.beforeStart?.()
        const result = await api.calibrate(req)
        if (!mounted.current) return null
        return { ok: true, result }
      } catch (e) {
        if (!mounted.current) return null
        const message = micPrivacyHint(e) ?? describeError(e)
        return { ok: false, message, cancelled: message === CALIBRATION_CANCELLED }
      } finally {
        runningRef.current = false
        if (mounted.current) setRunning(false)
        useStore.setState({ playing: null })
        // Backend ölçümden sonra motoru yeniden başlatır; başarısız olduysa üst çubuk eski durumu göstermesin.
        void useStore.getState().syncRunState()
      }
    },
    [],
  )

  const cancel = useCallback(() => api.cancelCalibration().catch(() => {}), [])
  const isRunning = useCallback(() => runningRef.current, [])

  return { progress, running, run, cancel, isRunning }
}
