import {
  EQ_FREQS,
  EQ_RANGE_DB,
  PEQ_FREQ_MAX,
  PEQ_FREQ_MIN,
  PEQ_GAIN_MAX,
  PEQ_MAX_BANDS,
  PEQ_Q_MAX,
  PEQ_Q_MIN,
  type PeqBand,
  type Processing,
} from '../api/types'

/**
 * Motorun (C# Surround.Engine/Dsp/BiquadCoefs.cs, GlobalProcessor.cs) süzgeç formüllerinin birebir aynası:
 * RBJ cookbook biquad'ları, aynı frekanslar/Q'lar/raf türleri. Eğri çizimi ve "otomatik ön kazanç" gösterimi bununla
 * hesaplanır; motor otoriterdir (docs/ses-isleme.md). Referans değerlerle sınanır (eqCurve.test.ts).
 */
export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

const IDENTITY: Biquad = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }

export const REF_FS = 48000
/** C# `EqDesign.PeakQ`: 10 bant EQ'nun ortadaki bantlarının Q'su. */
export const PEAK_Q = 1.4
/** C# `ProcessingSettings`: bas raf frekansı, netlik tepe ve raf. */
export const BASS_BOOST_HZ = 100
export const CLARITY_PEAK_HZ = 3500
export const CLARITY_PEAK_Q = 1.0
export const CLARITY_SHELF_HZ = 10000
const SHELF_Q = 0.70710678

/** C# `FrequencyResponse`: tepe araması için log ızgara. */
export const GRID_POINTS = 1000
export const RESP_MIN_HZ = 20
export const RESP_MAX_HZ = 20000

const w0Of = (fs: number, f: number) => (2 * Math.PI * Math.min(f, 0.45 * fs)) / fs

function norm(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

export function peaking(fs: number, f: number, q: number, gainDb: number): Biquad {
  if (gainDb === 0) return IDENTITY
  const a = Math.pow(10, gainDb / 40)
  const w0 = w0Of(fs, f)
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  return norm(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a)
}

export function lowShelf(fs: number, f: number, gainDb: number, q = SHELF_Q): Biquad {
  if (gainDb === 0) return IDENTITY
  const a = Math.pow(10, gainDb / 40)
  const w0 = w0Of(fs, f)
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const sq = 2 * Math.sqrt(a) * alpha
  return norm(
    a * (a + 1 - (a - 1) * cos + sq),
    2 * a * (a - 1 - (a + 1) * cos),
    a * (a + 1 - (a - 1) * cos - sq),
    a + 1 + (a - 1) * cos + sq,
    -2 * (a - 1 + (a + 1) * cos),
    a + 1 + (a - 1) * cos - sq,
  )
}

export function highShelf(fs: number, f: number, gainDb: number, q = SHELF_Q): Biquad {
  if (gainDb === 0) return IDENTITY
  const a = Math.pow(10, gainDb / 40)
  const w0 = w0Of(fs, f)
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const sq = 2 * Math.sqrt(a) * alpha
  return norm(
    a * (a + 1 + (a - 1) * cos + sq),
    -2 * a * (a - 1 + (a + 1) * cos),
    a * (a + 1 + (a - 1) * cos - sq),
    a + 1 - (a - 1) * cos + sq,
    2 * (a - 1 - (a + 1) * cos),
    a + 1 - (a - 1) * cos - sq,
  )
}

const isIdentity = (c: Biquad) => c.b0 === 1 && c.b1 === 0 && c.b2 === 0 && c.a1 === 0 && c.a2 === 0

/** |H(e^jw)| (doğrusal). */
export function magnitude(c: Biquad, fs: number, f: number): number {
  const w = (2 * Math.PI * f) / fs
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2
  const ni = -(c.b1 * s1 + c.b2 * s2)
  const dr = 1 + c.a1 * c1 + c.a2 * c2
  const di = -(c.a1 * s1 + c.a2 * s2)
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di))
}

const cl = (v: number, lo: number, hi: number, fallback = 0) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)

/** C# `EqDesign.TenBand`: uçlar raf (31 Hz alçak, 16 kHz yüksek), ortadakiler tepe (Q 1,4). */
export function tenBandStages(fs: number, gains: readonly number[] | undefined): Biquad[] {
  return EQ_FREQS.map((f, b) => {
    const g = cl(gains?.[b] ?? 0, -EQ_RANGE_DB, EQ_RANGE_DB)
    return b === 0 ? lowShelf(fs, f, g) : b === EQ_FREQS.length - 1 ? highShelf(fs, f, g) : peaking(fs, f, PEAK_Q, g)
  })
}

/** C# `EqDesign.Peq`: devre dışı/0 dB/geçersiz bant atlanır, en fazla 6 bant. */
export function peqStages(fs: number, bands: readonly PeqBand[] | undefined): Biquad[] {
  const out: Biquad[] = []
  for (const b of (bands ?? []).slice(0, PEQ_MAX_BANDS)) {
    if (!b || b.enabled === false) continue
    const f = cl(b.freqHz, PEQ_FREQ_MIN, PEQ_FREQ_MAX, 1000)
    const g = cl(b.gainDb, -PEQ_GAIN_MAX, PEQ_GAIN_MAX)
    const q = cl(b.q, PEQ_Q_MIN, PEQ_Q_MAX, 1)
    out.push(b.type === 'lowShelf' ? lowShelf(fs, f, g, q) : b.type === 'highShelf' ? highShelf(fs, f, g, q) : peaking(fs, f, q, g))
  }
  return out
}

type CurveInput = Pick<Processing, 'eq' | 'bassBoostDb' | 'clarityDb' | 'peq'>

/** C# `ProcessingSettings.BuildStages`: 10 bant + bas + netlik (tepe + yarım raf) + parametrik. */
export function processingStages(p: CurveInput, fs = REF_FS): Biquad[] {
  const clarity = cl(p.clarityDb, 0, 12)
  return [
    ...tenBandStages(fs, p.eq),
    lowShelf(fs, BASS_BOOST_HZ, cl(p.bassBoostDb, 0, 12)),
    peaking(fs, CLARITY_PEAK_HZ, CLARITY_PEAK_Q, clarity),
    highShelf(fs, CLARITY_SHELF_HZ, clarity / 2),
    ...peqStages(fs, p.peq),
  ]
}

/** Hoparlör EQ'su: 10 bant + parametrik. */
export const speakerStages = (eq: readonly number[] | undefined, peq: readonly PeqBand[] | undefined, fs = REF_FS): Biquad[] => [
  ...tenBandStages(fs, eq),
  ...peqStages(fs, peq),
]

export function responseDb(stages: readonly Biquad[], f: number, fs = REF_FS): number {
  let m = 1
  for (const s of stages) if (!isIdentity(s)) m *= magnitude(s, fs, f)
  return 20 * Math.log10(m)
}

/** Log aralıklı frekanslar (varsayılan: C#'taki 1000 noktalık ızgara). */
export function logGrid(n = GRID_POINTS, lo = RESP_MIN_HZ, hi = RESP_MAX_HZ): number[] {
  const r = Math.pow(hi / lo, 1 / (n - 1))
  const out: number[] = []
  let f = lo
  for (let i = 0; i < n; i++, f *= r) out.push(Math.min(f, hi))
  return out
}

const GRID = logGrid()

/** Birleşik yanıtın 20 Hz–20 kHz üzerindeki tepesi (dB); C# `FrequencyResponse.PeakDb`. */
export function peakDb(stages: readonly Biquad[], fs = REF_FS): number {
  let peak = -Infinity
  for (const f of GRID) peak = Math.max(peak, responseDb(stages, f, fs))
  return peak
}

/** C# `FrequencyResponse.AutoPreampDb`: -max(0, tepe), en çok -24 dB. */
export function autoPreampDb(p: CurveInput, fs = REF_FS): number {
  return Math.max(-24, -Math.max(0, peakDb(processingStages(p, fs), fs)))
}

/** Etkin ön kazanç: otomatikse hesaplanan, değilse elle ayarlanan (-24..+12). */
export function effectivePreampDb(p: Processing): number {
  return p.autoPreamp ? autoPreampDb(p) : cl(p.preampDb, -24, 12)
}
