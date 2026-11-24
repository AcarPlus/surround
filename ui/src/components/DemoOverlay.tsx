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
import { auroraMix, parseRgb, prefersReducedMotion, waveInterval } from '../lib/aurora'

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

  // Çizim döngüsü (Aurora): dönen aurora halesi, seviyeyle parlayıp dalga yayan hoparlörler, renk değiştiren kaynak
  // küresi ve kuyruklu izi. "Hareketi azalt" açıksa iz, dalga ve dönüş çizilmez; kaynağın konumu yine gösterilir.
  useEffect(() => {
    let raf = 0
    const reduced = prefersReducedMotion()
    const waves = new Map<string, { last: number; list: number[] }>()
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
      const accent = tok(wrap, '--accent', '61 224 200')
      const fg = tok(wrap, '--fg', '233 236 243')
      const faint = tok(wrap, '--faint', '112 121 141')
      const stops = (['--aurora-1', '--aurora-2', '--aurora-3'] as const).map(
        (n, i) => parseRgb(tok(wrap, n, ['61 224 200', '122 92 255', '255 92 168'][i])) ?? ([255, 255, 255] as const),
      )
      const A = (i: number) => stops[i].join(' ')
      const light = document.documentElement.dataset.theme === 'light'
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
      // Kaynağın rengi zamanla aurora renkleri arasında döner.
      const orbRgb = auroraMix(reduced ? 0 : now / 7000, stops)

      // Zemin ışığı: kaynağın yönüne doğru eğilmiş, nabızla parlayan.
      const tip = P(az, R * 0.5)
      const bg = g.createRadialGradient(tip.x, tip.y, 0, cx0, cy0, R * 1.6)
      bg.addColorStop(0, `rgb(${orbRgb} / ${live ? 0.12 + 0.14 * pulse : 0.05})`)
      bg.addColorStop(1, 'rgb(0 0 0 / 0)')
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)

      // Aurora halesi: halkanın üstünde yavaşça dönen renk bandı.
      const spin = reduced ? 0 : now / 9000
      if (typeof g.createConicGradient === 'function') {
        const cg = g.createConicGradient(spin * Math.PI * 2, cx0, cy0)
        const al = light ? 0.35 : 0.5
        cg.addColorStop(0, `rgb(${A(0)} / ${al})`)
        cg.addColorStop(0.33, `rgb(${A(1)} / ${al * 0.8})`)
        cg.addColorStop(0.66, `rgb(${A(2)} / ${al * 0.75})`)
        cg.addColorStop(1, `rgb(${A(0)} / ${al})`)
        g.save()
        g.strokeStyle = cg
        g.lineWidth = 14
        g.filter = 'blur(10px)'
        g.beginPath()
        g.arc(cx0, cy0, R, 0, Math.PI * 2)
        g.stroke()
        g.filter = 'none'
        g.lineWidth = 1.5
        g.beginPath()
        g.arc(cx0, cy0, R, 0, Math.PI * 2)
        g.stroke()
        g.restore()
      }
      g.lineWidth = 1
      g.strokeStyle = `rgb(${faint} / 0.2)`
      g.setLineDash([2, 6])
      g.beginPath()
      g.arc(cx0, cy0, R * 0.55, 0, Math.PI * 2)
      g.stroke()
      g.setLineDash([])
      for (let i = 0; i < 72; i++) {
        const d = i * 5
        const major = d % 90 === 0
        const a = P(d, R - (major ? 12 : 6))
        const b = P(d, R - 2)
        g.strokeStyle = `rgb(${faint} / ${major ? 0.7 : 0.25})`
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
        const p = P(d, R + 24)
        g.fillStyle = `rgb(${faint} / 0.85)`
        g.fillText(label, p.x, p.y)
      })

      // Hoparlörler: gerçek yönlerinde; motorun canlı seviyesiyle parlar ve seviyesi kadar ses dalgası yayar.
      const lv = levelsRef.current
      for (const s of speakers) {
        if (s.mute) continue
        const d = angleFromListener(s, room.listener)
        const p = P(d, R * 0.82)
        const v = speakerLevel(s, lv)
        // Tuval CSS değişkeni çözemez: cihaz renginin "r g b" üçlüsü değişkenden okunur.
        const varName = /var\((--dev-\d+)\)/.exec(deviceColorVar(s.outputDeviceId, devices))?.[1] ?? '--dev-0'
        const rgb = tok(wrap, varName, '142 162 255')
        const color = `rgb(${rgb})`
        if (!reduced) {
          const wv = waves.get(s.id) ?? { last: 0, list: [] }
          const iv = waveInterval(v)
          if (iv !== null && now - wv.last > iv) {
            wv.last = now
            wv.list.push(now)
          }
          wv.list = wv.list.filter((t0) => now - t0 < 1400)
          waves.set(s.id, wv)
          for (const t0 of wv.list) {
            const k = (now - t0) / 1400
            g.strokeStyle = `rgb(${rgb} / ${(0.55 * (1 - k) * (0.4 + v)).toFixed(3)})`
            g.lineWidth = 2.2 * (1 - k) + 0.4
            g.beginPath()
            g.arc(p.x, p.y, 12 + 46 * k, 0, Math.PI * 2)
            g.stroke()
          }
        }
        const haloR = 30 + 26 * v
        const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR)
        halo.addColorStop(0, `rgb(${rgb} / ${(0.3 + 0.5 * v).toFixed(3)})`)
        halo.addColorStop(1, `rgb(${rgb} / 0)`)
        g.fillStyle = halo
        g.beginPath()
        g.arc(p.x, p.y, haloR, 0, Math.PI * 2)
        g.fill()
        g.save()
        g.fillStyle = color
        g.shadowColor = color
        g.shadowBlur = 10 + 30 * v
        g.globalAlpha = 0.6 + 0.4 * v
        g.beginPath()
        g.arc(p.x, p.y, 8 + 6 * v, 0, Math.PI * 2)
        g.fill()
        g.restore()
        g.fillStyle = 'rgb(255 255 255 / 0.9)'
        g.beginPath()
        g.arc(p.x, p.y, 2.5 + 1.5 * v, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = `rgb(${fg} / 0.9)`
        g.font = '500 11px Geist, system-ui, sans-serif'
        g.fillText(s.name, p.x, p.y + 26)
      }

      // İz (aurora kuyruğu) ve dalgalar.
      const orb = P(az, R)
      if (live && !reduced) {
        trail.current.push({ x: orb.x, y: orb.y, t: now })
        const beat = Math.floor(t / (DEMO_SCENES.find((s) => s.id === r!.id)!.beat || 1))
        if (beat !== lastBeat.current) {
          lastBeat.current = beat
          ripples.current.push({ x: orb.x, y: orb.y, t: now })
        }
      }
      trail.current = trail.current.filter((p) => now - p.t < 1100)
      ripples.current = ripples.current.filter((p) => now - p.t < 1300)
      g.lineCap = 'round'
      for (let i = 1; i < trail.current.length; i++) {
        const p0 = trail.current[i - 1]
        const p1 = trail.current[i]
        const k = 1 - (now - p1.t) / 1100
        g.strokeStyle = `rgb(${auroraMix(now / 7000 - (1 - k) * 0.35, stops)} / ${(0.55 * k * k).toFixed(3)})`
        g.lineWidth = 2 + 14 * k * k
        g.beginPath()
        g.moveTo(p0.x, p0.y)
        g.lineTo(p1.x, p1.y)
        g.stroke()
      }
      g.lineCap = 'butt'
      for (const p of ripples.current) {
        const k = (now - p.t) / 1300
        const e = 1 - (1 - k) ** 3
        g.strokeStyle = `rgb(${auroraMix(k * 0.66, stops)} / ${(0.7 * (1 - k)).toFixed(3)})`
        g.lineWidth = 2.4 * (1 - k) + 0.5
        g.beginPath()
        g.arc(p.x, p.y, 10 + 80 * e, 0, Math.PI * 2)
        g.stroke()
      }

      // Dinleyiciden kaynağa ışın.
      if (live) {
        const beam = g.createLinearGradient(cx0, cy0, orb.x, orb.y)
        beam.addColorStop(0, `rgb(${A(0)} / 0)`)
        beam.addColorStop(1, `rgb(${orbRgb} / ${0.3 + 0.45 * pulse})`)
        g.strokeStyle = beam
        g.lineWidth = 2 + 2 * pulse
        g.beginPath()
        g.moveTo(cx0, cy0)
        g.lineTo(orb.x, orb.y)
        g.stroke()
      }

      // Kaynak küresi.
      if (r) {
        const size = 14 + 16 * pulse
        const halo = g.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, size * 3.2)
        halo.addColorStop(0, `rgb(255 255 255 / ${live ? 0.95 : 0.4})`)
        halo.addColorStop(0.18, `rgb(${orbRgb} / ${live ? 0.95 : 0.35})`)
        halo.addColorStop(0.5, `rgb(${orbRgb} / ${live ? 0.25 : 0.1})`)
        halo.addColorStop(1, `rgb(${orbRgb} / 0)`)
        g.fillStyle = halo
        g.beginPath()
        g.arc(orb.x, orb.y, size * 3.2, 0, Math.PI * 2)
        g.fill()
        if (r.id === 'speakers' && live) {
          const lab = SPEAKER_STEP_LABELS[Math.min(6, Math.floor(t / 1.2))]
          const lp = P(az, R + 48)
          g.fillStyle = `rgb(${fg})`
          g.font = '700 15px "Geist Mono", ui-monospace, monospace'
          g.fillText(lab, lp.x, lp.y)
        }
      }

      // Dinleyici: aurora halkalı.
      const lg = g.createRadialGradient(cx0, cy0, 0, cx0, cy0, 52)
      lg.addColorStop(0, `rgb(${accent} / ${0.3 + 0.28 * pulse})`)
      lg.addColorStop(1, `rgb(${accent} / 0)`)
      g.fillStyle = lg
      g.beginPath()
      g.arc(cx0, cy0, 52, 0, Math.PI * 2)
      g.fill()
      if (typeof g.createConicGradient === 'function') {
        const ring = g.createConicGradient(-spin * Math.PI * 4, cx0, cy0)
        ring.addColorStop(0, `rgb(${A(0)})`)
        ring.addColorStop(0.5, `rgb(${A(1)})`)
        ring.addColorStop(0.8, `rgb(${A(2)})`)
        ring.addColorStop(1, `rgb(${A(0)})`)
        g.strokeStyle = ring
      } else g.strokeStyle = `rgb(${accent} / 0.9)`
      g.lineWidth = 2
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
    <div className="aurora-in absolute inset-0 z-30 flex flex-col bg-bg/75 backdrop-blur-xl">
      <div className="flex shrink-0 items-start gap-3 px-6 pt-4">
        <div className="min-w-0 flex-1">
          <p className="aurora-text text-[22px] font-semibold tracking-tight">Ses turu</p>
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
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface/60 text-muted backdrop-blur-sm transition-[transform,color,border-color] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] hover:rotate-90 hover:border-accent/50 hover:text-fg"
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
        <div className="stagger grid grid-cols-2 gap-2.5 min-[900px]:grid-cols-4">
          {DEMO_SCENES.map((s) => {
            const on = run?.id === s.id
            return (
              <button
                key={s.id}
                type="button"
                disabled={busy || speakers.length === 0}
                onClick={() => (on ? stop() : void start(s.id))}
                className={cx(
                  'glass-card group flex items-center gap-3 overflow-hidden px-4 py-3 text-left transition-[transform,box-shadow,border-color] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50',
                  on && 'border-accent/60 shadow-[0_0_34px_-8px_rgb(var(--aurora-1)/0.6)]',
                )}
              >
                {on && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,rgb(var(--aurora-1)/0.08),rgb(var(--aurora-2)/0.22))] transition-[width] duration-200"
                    style={{ width: `${progress * 100}%` }}
                  />
                )}
                <SceneGlyph id={s.id} on={on} />
                <span className="relative min-w-0">
                  <span className={cx('block text-[14px] font-semibold', on && 'aurora-text')}>{s.title}</span>
                  <span className="block text-xs text-muted">{on ? 'Durdurmak için dokun' : s.sub}</span>
                </span>
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

/** Sahnenin küçük simgesi: yörüngesini anlatır; sahne çalarken ışığı yörüngede döner. */
export function SceneGlyph({ id, on }: { id: DemoSceneId; on?: boolean }) {
  const path =
    id === 'orbit'
      ? 'M20 6a14 14 0 1 1 0 28a14 14 0 1 1 0-28'
      : id === 'pingpong'
        ? 'M6 20c4-10 8-10 14 0s10 10 14 0'
        : id === 'flyby'
          ? 'M8 30C10 14 30 8 32 20S16 34 8 30'
          : 'M20 6l10 4l4 10l-4 10l-10 4l-10-4l-4-10l4-10z'
  return (
    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line/80 bg-bg/40" aria-hidden>
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path d={path} stroke="rgb(var(--line-strong))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d={path}
          pathLength={1}
          stroke="url(#scene-glyph)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="0.22 0.78"
          className={cx(on ? 'scene-run' : 'scene-idle')}
        />
        <circle cx="20" cy="20" r="2.4" fill="rgb(var(--fg))" opacity="0.8" />
        <defs>
          <linearGradient id="scene-glyph" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgb(var(--aurora-1))" />
            <stop offset="0.5" stopColor="rgb(var(--aurora-2))" />
            <stop offset="1" stopColor="rgb(var(--aurora-3))" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  )
}
