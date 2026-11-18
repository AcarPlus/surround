import type { PeqBand } from '../api/types'
import { REF_FS, magnitude, peaking } from './eqCurve'

/**
 * Tını eşleme (docs/kalibrasyon.md, "Tını eşleme"): her hoparlörün ölçülen frekans yanıtını hedefe (referans hoparlör
 * ya da hepsinin ortalaması) yaklaştıran parametrik bantlar (`speaker.roomEq`, en fazla 8).
 *
 * İlke: hepsi AYNI mikrofonla ölçüldüğü için mikrofonun kendi rengi farkta birbirini götürür; mutlak doğru eğri değil,
 * hoparlörler arası fark düzeltilir. Seviye farkı kazançla ayrıca eşitlendiği için eğriler 500 Hz–4 kHz ortalamasına
 * göre hizalanır. Güvenlik: yükseltme en çok +6 dB (çukurları doldurmak hoparlörü zorlar), kısma en çok −12 dB;
 * bas yönetimiyle kesilen bölge ve 12 kHz üstü (telefon mikrofonu, ışınlama) dışarıda bırakılır.
 */

export const ROOM_EQ_MAX_BANDS = 8
export const MAX_BOOST_DB = 6
export const MAX_CUT_DB = 12
export const MATCH_LO_HZ = 150
export const MATCH_HI_HZ = 12000
/** Bu kadar yakınsa bant eklemeye gerek yok. */
export const MATCH_TOLERANCE_DB = 1

export type MatchTarget = 'reference' | 'average'

export interface MatchInput {
  speakerId: string
  /** Konum başına ölçülen yanıt (dB, `hz` ızgarasında). */
  responses: number[][]
  /** Bas yönetimi: bu frekansın altı hoparlöre zaten gitmiyor (0 = tam bant). */
  highPassHz?: number
}

export interface MatchResult {
  speakerId: string
  /** Hedefin kendisi (referans modunda düzeltilmez). */
  isTarget: boolean
  bands: PeqBand[]
  /** Hizalanmış eğriler (dB): ölçülen, hedef, düzeltilmiş tahmin. */
  measured: number[]
  target: number[]
  corrected: number[]
  /** Eşleme bandı [lo, hi] (Hz). */
  loHz: number
  hiHz: number
  /** Eşleme bandında hedeften sapma (dB, RMS ve en büyük): önce / sonra. */
  rmsBefore: number
  rmsAfter: number
  maxAfter: number
}

const dbToPow = (d: number) => Math.pow(10, d / 10)
const powToDb = (p: number) => 10 * Math.log10(Math.max(p, 1e-30))

/** Konumların güç ortalaması (dB). */
export function spatialAverage(responses: number[][]): number[] {
  const n = responses[0]?.length ?? 0
  return Array.from({ length: n }, (_, i) => powToDb(responses.reduce((a, r) => a + dbToPow(r[i]), 0) / responses.length))
}

/** 500 Hz–4 kHz ortalaması 0 dB olacak şekilde kaydırır. */
export function alignLevel(hz: readonly number[], db: readonly number[]): number[] {
  const idx = hz.map((f, i) => (f >= 500 && f <= 4000 ? i : -1)).filter((i) => i >= 0)
  const mean = idx.length ? idx.reduce((a, i) => a + db[i], 0) / idx.length : 0
  return db.map((v) => v - mean)
}

export function bandsDb(hz: readonly number[], bands: readonly PeqBand[]): number[] {
  return hz.map((f) => {
    let m = 1
    for (const b of bands) m *= magnitude(peaking(REF_FS, b.freqHz, b.q, b.gainDb), REF_FS, f)
    return 20 * Math.log10(m)
  })
}

const peakDb = (f: number, fc: number, q: number, g: number) => 20 * Math.log10(magnitude(peaking(REF_FS, fc, q, g), REF_FS, f))

const rms = (v: number[]) => (v.length ? Math.sqrt(v.reduce((a, x) => a + x * x, 0) / v.length) : 0)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r1 = (v: number) => Math.round(v * 10) / 10

/**
 * İstenen düzeltme eğrisine (dB, `use` maskeli noktalarda) en çok `maxBands` tepe bandı oturtur: her turda kalan
 * hatanın en büyük olduğu yere bir bant konur (genişlik, hatanın yarı yüksekliğinden), sonra frekans/kazanç/Q küçük bir
 * ızgarada iyileştirilir; sonunda kazançlar birlikte bir kez daha ayarlanır.
 */
export function fitPeaks(hz: readonly number[], want: readonly number[], use: readonly boolean[], maxBands = ROOM_EQ_MAX_BANDS): PeqBand[] {
  const pts = hz.map((_, i) => i).filter((i) => use[i])
  if (pts.length < 3) return []
  const bands: { f: number; q: number; g: number }[] = []
  const curve = (except = -1) =>
    hz.map((f) => bands.reduce((a, b, k) => (k === except ? a : a + peakDb(f, b.f, b.q, b.g)), 0))
  const err = (eq: number[]) => pts.reduce((a, i) => a + (want[i] - eq[i]) ** 2, 0)

  for (let n = 0; n < maxBands; n++) {
    const eq = curve()
    const res = hz.map((_, i) => want[i] - eq[i])
    // 3 noktalı yumuşatma: tek noktalık sivrilik bant çekmesin.
    const sm = (i: number) => {
      const near = [i - 1, i, i + 1].filter((k) => k >= 0 && k < hz.length && use[k])
      return near.reduce((a, k) => a + res[k], 0) / near.length
    }
    let at = pts[0]
    for (const i of pts) if (Math.abs(sm(i)) > Math.abs(sm(at))) at = i
    const g0 = sm(at)
    if (Math.abs(g0) < MATCH_TOLERANCE_DB) break
    // Genişlik: aynı işaretli ve yarı yükseklikten büyük komşuluk.
    let lo = at
    let hi = at
    while (lo - 1 >= 0 && use[lo - 1] && Math.sign(res[lo - 1]) === Math.sign(g0) && Math.abs(res[lo - 1]) > Math.abs(g0) / 2) lo--
    while (hi + 1 < hz.length && use[hi + 1] && Math.sign(res[hi + 1]) === Math.sign(g0) && Math.abs(res[hi + 1]) > Math.abs(g0) / 2) hi++
    const bw = Math.max(1 / 6, Math.log2(hz[hi] / hz[lo]))
    const q0 = clamp(Math.sqrt(Math.pow(2, bw)) / (Math.pow(2, bw) - 1), 0.5, 6)

    const before = err(eq)
    let best = { f: hz[at], q: q0, g: clamp(g0, -MAX_CUT_DB, MAX_BOOST_DB), e: Infinity }
    for (const fm of [-1 / 24, 0, 1 / 24])
      for (const gm of [0.7, 0.85, 1, 1.15])
        for (const qm of [0.6, 0.8, 1, 1.25, 1.6]) {
          const f = hz[at] * Math.pow(2, fm)
          const g = clamp(g0 * gm, -MAX_CUT_DB, MAX_BOOST_DB)
          const q = clamp(q0 * qm, 0.5, 6)
          const e = pts.reduce((a, i) => a + (res[i] - peakDb(hz[i], f, q, g)) ** 2, 0)
          if (e < best.e) best = { f, q, g, e }
        }
    if (!(best.e < before * 0.99)) break
    bands.push({ f: best.f, q: best.q, g: best.g })
  }

  // Ortak ince ayar: her bandın kazancı diğerleri sabitken.
  for (let pass = 0; pass < 2; pass++)
    bands.forEach((b, k) => {
      const others = curve(k)
      let bestG = b.g
      let bestE = Infinity
      for (let g = -MAX_CUT_DB; g <= MAX_BOOST_DB + 1e-9; g += 0.25) {
        const e = pts.reduce((a, i) => a + (want[i] - others[i] - peakDb(hz[i], b.f, b.q, g)) ** 2, 0)
        if (e < bestE) {
          bestE = e
          bestG = g
        }
      }
      b.g = bestG
    })

  // Bantlar üst üste binince toplam yükseltme sınırı aşabilir: yükselten bantları orantılı küçült.
  for (let k = 0; k < 20; k++) {
    const top = Math.max(...curve())
    if (top <= MAX_BOOST_DB + 0.05) break
    const f = MAX_BOOST_DB / top
    bands.forEach((b) => {
      if (b.g > 0) b.g *= f
    })
  }

  return bands
    .filter((b) => Math.abs(b.g) >= 0.25)
    .sort((a, b) => a.f - b.f)
    .map((b, i) => ({
      id: `room-${i + 1}`,
      type: 'peak' as const,
      freqHz: Math.round(b.f),
      gainDb: r1(b.g),
      q: Math.round(b.q * 100) / 100,
    }))
}

/** Hoparlörün doğal düşüşü başladığı yerde eşleme durur: orayı EQ ile yükseltmek küçük hoparlörü zorlar. */
export const ROLLOFF_LO_DB = -6
export const ROLLOFF_HI_DB = -10

/**
 * Hizalanmış eğride (orta bant 0 dB) alt ve üst düşüş noktaları: 500 Hz'den aşağı inerken eğrinin ilk kez
 * ROLLOFF_LO_DB altına düştüğü yerin 1/6 oktav üstü; 4 kHz'den yukarı çıkarken ROLLOFF_HI_DB altına düştüğü yer.
 */
export function rollOff(hz: readonly number[], db: readonly number[]): { lo: number; hi: number } {
  let lo = 0
  for (let i = hz.findIndex((f) => f >= 500); i >= 0; i--)
    if (db[i] < ROLLOFF_LO_DB) {
      lo = hz[i] * Math.pow(2, 1 / 6)
      break
    }
  let hi = Infinity
  for (let i = Math.max(0, hz.findIndex((f) => f >= 4000)); i < hz.length; i++)
    if (db[i] < ROLLOFF_HI_DB) {
      hi = hz[i]
      break
    }
  return { lo, hi }
}

/**
 * Her hoparlör için hedefe eşleyen bantlar. Hedef: `reference` = referans hoparlörün eğrisi (ona EQ uygulanmaz),
 * `average` = tüm hoparlörlerin ortalaması (herkes ona çekilir).
 */
export function matchSpeakers(
  hz: readonly number[],
  inputs: MatchInput[],
  opts: { target: MatchTarget; referenceId?: string; maxBands?: number },
): MatchResult[] {
  const usable = inputs.filter((x) => x.responses.length > 0 && x.responses.every((r) => r.length === hz.length))
  if (usable.length === 0) return []
  const curves = new Map(usable.map((x) => [x.speakerId, alignLevel(hz, spatialAverage(x.responses))]))
  const refIn = usable.find((x) => x.speakerId === opts.referenceId) ?? usable[0]
  const loOf = (x: MatchInput) => Math.max(MATCH_LO_HZ, (x.highPassHz ?? 0) > 0 ? x.highPassHz! * 1.3 : 0)

  let target: number[]
  let targetLo = MATCH_LO_HZ
  if (opts.target === 'reference') {
    target = curves.get(refIn.speakerId)!
    targetLo = loOf(refIn)
  } else {
    // Ortalama: her noktada o frekansı çalabilen hoparlörlerin ortalaması.
    target = hz.map((f, i) => {
      const vals = usable.filter((x) => f >= loOf(x)).map((x) => curves.get(x.speakerId)![i])
      return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0
    })
  }

  return usable.map((x) => {
    const measured = curves.get(x.speakerId)!
    const edge = rollOff(hz, measured)
    const loHz = Math.max(loOf(x), targetLo, edge.lo)
    const hiHz = Math.min(MATCH_HI_HZ, edge.hi)
    const use = hz.map((f) => f >= loHz && f <= hiHz)
    const isTarget = opts.target === 'reference' && x.speakerId === refIn.speakerId
    const want = hz.map((_, i) => clamp(target[i] - measured[i], -MAX_CUT_DB, MAX_BOOST_DB))
    const bands = isTarget ? [] : fitPeaks(hz, want, use, opts.maxBands)
    const eq = bandsDb(hz, bands)
    const corrected = measured.map((v, i) => v + eq[i])
    const dev = (c: number[]) => hz.map((_, i) => i).filter((i) => use[i]).map((i) => c[i] - target[i])
    const after = dev(corrected)
    return {
      speakerId: x.speakerId,
      isTarget,
      bands,
      measured,
      target,
      corrected,
      loHz,
      hiHz,
      rmsBefore: r1(rms(dev(measured))),
      rmsAfter: r1(rms(after)),
      maxAfter: r1(after.reduce((a, v) => Math.max(a, Math.abs(v)), 0)),
    }
  })
}
