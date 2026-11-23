import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useStore } from '../store/useStore'
import { angleFromListener } from '../lib/roles'
import { deviceColorVar } from '../lib/colors'
import { speakerLevel, useLevels } from '../lib/useLevels'
import {
  DEMO_SCENES,
  SPEAKER_STEP_LABELS,
  demoAzimuth,
  demoLatencyMs,
  demoPulse,
  hasRearCoverage,
  type DemoSceneId,
} from '../lib/demo'
import { IconX } from './icons'
import { cx } from './ui'

interface Run {
  id: DemoSceneId
  /** performance.now() zamanında sahnenin (duyulan) 0. saniyesi. */
  t0: number
  duration: number
}

/** CSS değişkeninden "r g b" üçlüsü. */
const tok = (el: Element, name: string, fallback: string) =>
  getComputedStyle(el).getPropertyValue(name).trim() || fallback

/**
 * Ses turu: telifsiz sentez bir ses kaynağı odada hareket eder (motor üretir, gerçek ses zincirinden geçer); ekranda
 * kaynağın o an DUYULMASI gereken yeri çizilir. Animasyon, sesin kulağa ulaşma gecikmesi kadar geride oynar.
 */
export function DemoOverlay({ onClose }: { onClose: () => void }) {
  const speakers = useStore((s) => s.speakers)
  const room = useStore((s) => s.room)
  const outputs = useStore((s) => s.outputs)
  const devices = useStore((s) => s.devices)
  const runState = useStore((s) => s.runState)
  const toggleRun = useStore((s) => s.toggleRun)
  const showError = useStore((s) => s.showError)
  const levels = useLevels(runState === 'running')
  const [run, setRun] = useState<Run | null>(null)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const runRef = useRef<Run | null>(null)
  const levelsRef = useRef(levels)
  levelsRef.current = levels
  const trail = useRef<{ x: number; y: number; t: number }[]>([])
  const ripples = useRef<{ x: number; y: number; t: number }[]>([])
  const lastBeat = useRef(-1)

  const latency = demoLatencyMs(
    speakers,
    outputs.filter((o) => speakers.some((s) => s.outputDeviceId === o.deviceId)).map((o) => o.bufferMs),
  )
  const rear = hasRearCoverage(speakers, room.listener)

  const start = async (id: DemoSceneId) => {
    if (busy) return
    setBusy(true)
    try {
      if (useStore.getState().runState !== 'running') await toggleRun()
      if (useStore.getState().runState !== 'running') return
      const duration = await api.demoStart(id)
      const r = { id, t0: performance.now() + latency, duration }
      runRef.current = r
      trail.current = []
      ripples.current = []
      lastBeat.current = -1
      setRun(r)
    } catch (e) {
      showError(e, 6000)
    } finally {
      setBusy(false)
    }
  }

  const stop = () => {
    runRef.current = null
    setRun(null)
    void api.demoStop().catch(() => {})
  }

  // Kapanınca demo da dursun.
  useEffect(() => () => void api.demoStop().catch(() => {}), [])

  // Çizim döngüsü.
  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cv = canvasRef.current
      const wrap = wrapRef.current
      if (!cv || !wrap) return
      const dpr = window.devicePixelRatio || 1
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
      }
      const g = cv.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const accent = tok(wrap, '--accent', '142 162 255')
      const fg = tok(wrap, '--fg', '233 236 243')
      const faint = tok(wrap, '--faint', '112 121 141')
      const cx0 = w / 2
      const cy0 = h / 2
      const R = Math.max(60, Math.min(w, h) * 0.36)
      const P = (deg: number, r: number) => {
        const a = (deg * Math.PI) / 180
        return { x: cx0 + r * Math.sin(a), y: cy0 - r * Math.cos(a) }
      }
      const now = performance.now()
      const r = runRef.current
      const t = r ? (now - r.t0) / 1000 : -1
      const live = !!r && t >= 0 && t <= r.duration
      if (r && t > r.duration + 0.6) {
        runRef.current = null
        setRun(null)
      }
      const az = r ? demoAzimuth(r.id, Math.max(0, Math.min(t, r.duration))) : 0
      const pulse = live ? demoPulse(r!.id, t) : 0

      // Zemin ışığı: kaynağın yönüne doğru eğilmiş, nabızla parlayan.
      const tip = P(az, R * 0.5)
      const bg = g.createRadialGradient(tip.x, tip.y, 0, cx0, cy0, R * 1.6)
      bg.addColorStop(0, `rgb(${accent} / ${live ? 0.1 + 0.12 * pulse : 0.05})`)
      bg.addColorStop(1, 'rgb(0 0 0 / 0)')
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)

      // Halka ve çentikler.
      g.lineWidth = 1
      g.strokeStyle = `rgb(${faint} / 0.35)`
      g.beginPath()
      g.arc(cx0, cy0, R, 0, Math.PI * 2)
      g.stroke()
      g.strokeStyle = `rgb(${faint} / 0.18)`
      g.beginPath()
      g.arc(cx0, cy0, R * 0.55, 0, Math.PI * 2)
      g.stroke()
      for (let i = 0; i < 72; i++) {
        const d = i * 5
        const major = d % 90 === 0
        const a = P(d, R - (major ? 10 : 5))
        const b = P(d, R)
        g.strokeStyle = `rgb(${faint} / ${major ? 0.6 : 0.25})`
        g.beginPath()
        g.moveTo(a.x, a.y)
        g.lineTo(b.x, b.y)
        g.stroke()
      }
      g.font = '600 11px Geist, system-ui, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      ;([
        [0, 'ÖN'],
        [90, 'SAĞ'],
        [180, 'ARKA'],
        [-90, 'SOL'],
      ] as const).forEach(([d, label]) => {
        const p = P(d, R + 22)
        g.fillStyle = `rgb(${faint} / 0.8)`
        g.fillText(label, p.x, p.y)
      })

      // Hoparlörler: gerçek yönlerinde; motorun canlı seviyesiyle parlar.
      const lv = levelsRef.current
      for (const s of speakers) {
        if (s.mute) continue
        const d = angleFromListener(s, room.listener)
        const p = P(d, R * 0.82)
        const v = speakerLevel(s, lv)
        // Tuval CSS değişkeni çözemez: cihaz renginin "r g b" üçlüsü değişkenden okunur.
        const varName = /var\((--dev-\d+)\)/.exec(deviceColorVar(s.outputDeviceId, devices))?.[1] ?? '--dev-0'
        const color = `rgb(${tok(wrap, varName, '142 162 255')})`
        g.save()
        g.fillStyle = color
        g.shadowColor = color
        g.shadowBlur = 8 + 30 * v
        g.globalAlpha = 0.55 + 0.45 * v
        g.beginPath()
        g.arc(p.x, p.y, 9 + 6 * v, 0, Math.PI * 2)
        g.fill()
        g.restore()
        g.fillStyle = `rgb(${fg} / 0.85)`
        g.font = '500 11px Geist, system-ui, sans-serif'
        g.fillText(s.name, p.x, p.y + 24)
      }

      // İz ve dalgalar.
      const orb = P(az, R)
      if (live) {
        trail.current.push({ x: orb.x, y: orb.y, t: now })
        const beat = Math.floor(t / (DEMO_SCENES.find((s) => s.id === r!.id)!.beat || 1))
        if (beat !== lastBeat.current) {
          lastBeat.current = beat
          ripples.current.push({ x: orb.x, y: orb.y, t: now })
        }
      }
      trail.current = trail.current.filter((p) => now - p.t < 900)
      ripples.current = ripples.current.filter((p) => now - p.t < 1200)
      for (const p of trail.current) {
        const k = 1 - (now - p.t) / 900
        g.fillStyle = `rgb(${accent} / ${0.35 * k * k})`
        g.beginPath()
        g.arc(p.x, p.y, 3 + 9 * k, 0, Math.PI * 2)
        g.fill()
      }
      for (const p of ripples.current) {
        const k = (now - p.t) / 1200
        g.strokeStyle = `rgb(${accent} / ${0.6 * (1 - k)})`
        g.lineWidth = 2 * (1 - k) + 0.5
        g.beginPath()
        g.arc(p.x, p.y, 10 + 70 * k, 0, Math.PI * 2)
        g.stroke()
      }

      // Dinleyiciden kaynağa ışın.
      if (live) {
        const beam = g.createLinearGradient(cx0, cy0, orb.x, orb.y)
        beam.addColorStop(0, `rgb(${accent} / 0)`)
        beam.addColorStop(1, `rgb(${accent} / ${0.25 + 0.4 * pulse})`)
        g.strokeStyle = beam
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(cx0, cy0)
        g.lineTo(orb.x, orb.y)
        g.stroke()
      }

      // Kaynak küresi.
      if (r) {
        const size = 14 + 16 * pulse
        const halo = g.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, size * 3)
        halo.addColorStop(0, `rgb(255 255 255 / ${live ? 0.95 : 0.4})`)
        halo.addColorStop(0.2, `rgb(${accent} / ${live ? 0.9 : 0.35})`)
        halo.addColorStop(1, `rgb(${accent} / 0)`)
        g.fillStyle = halo
        g.beginPath()
        g.arc(orb.x, orb.y, size * 3, 0, Math.PI * 2)
        g.fill()
        if (r.id === 'speakers' && live) {
          const lab = SPEAKER_STEP_LABELS[Math.min(6, Math.floor(t / 1.2))]
          const lp = P(az, R + 44)
          g.fillStyle = `rgb(${fg})`
          g.font = '700 15px "Geist Mono", ui-monospace, monospace'
          g.fillText(lab, lp.x, lp.y)
        }
      }

      // Dinleyici.
      const lg = g.createRadialGradient(cx0, cy0, 0, cx0, cy0, 46)
      lg.addColorStop(0, `rgb(${accent} / ${0.28 + 0.25 * pulse})`)
      lg.addColorStop(1, `rgb(${accent} / 0)`)
      g.fillStyle = lg
      g.beginPath()
      g.arc(cx0, cy0, 46, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = `rgb(${accent} / 0.9)`
      g.lineWidth = 1.5
      g.beginPath()
      g.arc(cx0, cy0, 22, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = `rgb(${fg} / 0.9)`
      g.beginPath()
      g.arc(cx0, cy0 - 5, 5, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.ellipse(cx0, cy0 + 9, 9, 5.5, 0, Math.PI, 0)
      g.fill()
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [speakers, room.listener, devices])

  // İlerleme çubuğu için saniyede birkaç kez yeniden çiz.
  useEffect(() => {
    if (!run) return
    const id = setInterval(() => setTick((v) => v + 1), 200)
    return () => clearInterval(id)
  }, [run])

  const progress = run ? Math.min(1, Math.max(0, (performance.now() - run.t0) / 1000 / run.duration)) : 0
  const waiting = run ? performance.now() < run.t0 : false

  return (
    <div className="screen-in absolute inset-0 z-30 flex flex-col bg-bg/85 backdrop-blur-md">
      <div className="flex shrink-0 items-start gap-3 px-6 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-semibold tracking-tight">Ses turu</p>
          <p className="text-xs text-muted">
            Gözlerini kapat, sesin nereden geldiğini tahmin et; sonra ekrana bak. Ses motorun içinde üretilir ve kendi
            ayarlarından geçer (profil, dağıtım, ölçüm). Çalarken diğer sesler susar.
          </p>
        </div>
        <button
          type="button"
          aria-label="Ses turunu kapat"
          onClick={() => {
            stop()
            onClose()
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-muted hover:text-fg"
        >
          <IconX width={14} height={14} />
        </button>
      </div>

      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        {waiting && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-muted">
            Ses yolda… (hoparlörlere ulaşması ~{Math.round(latency)} ms)
          </p>
        )}
      </div>

      <div className="shrink-0 px-6 pb-5">
        {!rear && (
          <p className="mb-2 text-xs text-warn">
            Arkanda hoparlör yok: arka yöndeki ses öndeki hoparlörlere katlanır, arkadan gelmez. Yana/arkaya bir hoparlör
            eklersen ve “Konuma göre dağıt”ı açarsan dönüş tamamlanır.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 min-[900px]:grid-cols-4">
          {DEMO_SCENES.map((s) => {
            const on = run?.id === s.id
            return (
              <button
                key={s.id}
                type="button"
                disabled={busy || speakers.length === 0}
                onClick={() => (on ? stop() : void start(s.id))}
                className={cx(
                  'relative overflow-hidden rounded-2xl border px-4 py-3 text-left transition-colors disabled:opacity-50',
                  on ? 'border-accent bg-accent/15' : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                {on && (
                  <span
                    className="absolute inset-y-0 left-0 bg-accent/15 transition-[width] duration-200"
                    style={{ width: `${progress * 100}%` }}
                  />
                )}
                <span className="relative block text-[14px] font-semibold">{s.title}</span>
                <span className="relative block text-xs text-muted">{on ? 'Durdurmak için dokun' : s.sub}</span>
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Sesler tamamen sentezlenir (telifsiz). Bu bir yönlendirme testidir; herhangi bir ticari çevresel ses biçimi değildir.
        </p>
      </div>
    </div>
  )
}
