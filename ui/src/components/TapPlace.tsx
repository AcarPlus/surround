import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Device } from '../api/types'
import { useStore } from '../store/useStore'
import { tapKey } from '../lib/quickStart'
import type { PlannedSpeaker } from '../lib/setup'
import { describeAngle } from '../lib/tapPlace'
import { TapDial } from './TapDial'
import { Button } from './ui'
import { IconVolume } from './icons'

/**
 * "Bu ses nereden geliyor?" adımı (Ölçmeden başla ve Kolay kurulum ortak): `index`teki planlı hoparlörün test sesi
 * adıma girince bir kez çalar; önceki dokunuş (`angles`, anahtar `tapKey`) varsa kadranda gösterilir.
 * İleri / Atla / Geri düğmeleri çağıran ekranın alt çubuğundadır.
 */
export function useTapPlace(plan: PlannedSpeaker[], index: number, angles: Record<string, number>) {
  const showError = useStore((s) => s.showError)
  const cur = index >= 0 && index < plan.length ? plan[index] : null
  const curKey = cur ? tapKey(cur.deviceId, cur.channel) : ''
  const [draft, setDraft] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const tokenRef = useRef(0)

  const play = async (p: PlannedSpeaker) => {
    const token = ++tokenRef.current
    setPlaying(true)
    try {
      await api.playTone(p.deviceId, p.channel)
    } catch (e) {
      showError(e, 5000)
    } finally {
      if (tokenRef.current === token) setPlaying(false)
    }
  }

  useEffect(() => {
    if (!cur) return
    setDraft(angles[curKey] ?? null)
    void play(cur)
    return () => {
      tokenRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, curKey])

  return { cur, curKey, index, draft, setDraft, playing, replay: () => cur && void play(cur) }
}

export type TapPlaceState = ReturnType<typeof useTapPlace>

/** Kadran + "Tekrar çal". Diğer hoparlörlerin önceki dokunuşları küçük numaralı noktalar olarak görünür. */
export function TapPlaceView({
  tap,
  plan,
  angles,
  devices,
  onConfirm,
}: {
  tap: TapPlaceState
  plan: PlannedSpeaker[]
  angles: Record<string, number>
  devices: Device[]
  /** Enter ile onay. */
  onConfirm: () => void
}) {
  const { cur, draft } = tap
  if (!cur) return null
  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold tracking-tight">Bu ses nereden geliyor?</h1>
      <p className="mb-1 mt-1 text-[13px] text-muted">Odada yerine dokun. Ortadaki nokta sensin, ekran yukarıda.</p>
      <p className="mb-3 text-xs text-faint">
        {cur.name} · {devices.find((d) => d.id === cur.deviceId)?.name}
      </p>
      <TapDial
        value={draft}
        onChange={tap.setDraft}
        onConfirm={onConfirm}
        marks={plan.flatMap((p, j) => {
          const a = angles[tapKey(p.deviceId, p.channel)]
          return j !== tap.index && a !== undefined ? [{ angle: a, label: String(j + 1) }] : []
        })}
        size={300}
        label={`${cur.name} hoparlörünün yönü`}
      />
      <p className="mt-3 h-5 text-[13px] font-medium" aria-live="polite">
        {draft === null ? 'Henüz seçmedin' : describeAngle(draft)}
      </p>
      <div className="mt-2">
        <Button onClick={tap.replay} disabled={tap.playing}>
          <IconVolume /> {tap.playing ? 'Çalıyor…' : 'Tekrar çal'}
        </Button>
      </div>
      <p className="mt-3 text-xs text-faint">Ses gelmediyse hoparlörün açık ve sesinin kısık olmadığından emin ol; duyamıyorsan “Atla”.</p>
      <p className="mt-1 text-xs text-faint">Klavyede: ← → ile döndür, Enter ile onayla.</p>
    </div>
  )
}
