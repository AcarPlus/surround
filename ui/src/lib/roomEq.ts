import type { PeqBand } from '../api/types'
import { REF_FS, magnitude, peaking } from './eqCurve'

/**
 * Tını eşleme (docs/kalibrasyon.md, "Tını eşleme"): her hoparlörün ölçülen frekans yanıtını hedefe (referans hoparlör
 * ya da hepsinin ortalaması) yaklaştıran parametrik bantlar (`speaker.roomEq`, en fazla 8).
 *
 * İlke: hepsi AYNI mikrofonla ölçüldüğü için mikrofonun kendi rengi farkta birbirini götürür; mutlak doğru eğri değil,
 * hoparlörler arası fark düzeltilir. Seviye farkı kazançla ayrıca eşitlendiği için eğriler 500 Hz–4 kHz ortalamasına
 * göre hizalanır. Güvenlik: yükseltme en çok +3 dB (çukurları doldurmak hoparlörü zorlar, duyulur fayda getirmez), kısma en çok −12 dB
 * (4 kHz üstünde −3 dB: tizi boğmamak için), Q en çok 4;
 * bas yönetimiyle kesilen bölge ve 12 kHz üstü (telefon mikrofonu, ışınlama) dışarıda bırakılır.
 */

export const ROOM_EQ_MAX_BANDS = 8
export const MAX_BOOST_DB = 3
export const MAX_CUT_DB = 12
export const MATCH_LO_HZ = 150
export const MATCH_HI_HZ = 12000
/**
 * Tizde (bu frekanstan yukarı) kısma en çok HF_MAX_CUT_DB: donuk bir referansa (ör. monitörün küçük hoparlörü) eşlerken
 * iyi bir hoparlörün tizini −7…−10 dB kesmek "eşlenmiş ama boğuk" ses verir; tizdeki ölçüm de telefon mikrofonunda ve
 * konuma en duyarlı bölge. Gerçek kullanıcı ölçümünde orta hoparlörün 6–11 kHz'i −7…−9,5 dB kesilmişti.
 */
export const HF_LIMIT_HZ = 4000
export const HF_MAX_CUT_DB = 3
/** Dar bantlar tek konumda ölçülen yansıma taraklarına oturur (konuma özgü, başka yerde zarar): Q en çok 4. */
export const MAX_Q = 4
const cutAt = (f: number, maxCutDb: number) => (f >= HF_LIMIT_HZ ? Math.min(maxCutDb, HF_MAX_CUT_DB) : maxCutDb)
/** Bu kadar yakınsa bant eklemeye gerek yok. */
export const MATCH_TOLERANCE_DB = 1

/**
 * Bant sınırları. Varsayılan (kalibrasyon): yükseltme +3, kısma −12 dB (bant başına), 8 bant.
 * `capTotalCut`: üst üste binen bantların TOPLAM kısması da `maxCutDb` ile sınırlanır.
 */
export interface RoomEqLimits {
  maxBoostDb: number
  maxCutDb: number
  maxBands: number
  /** Kalan hata bundan küçükse yeni bant eklenmez (dB). */
  toleranceDb: number
  capTotalCut?: boolean
}

export const DEFAULT_ROOM_EQ_LIMITS: RoomEqLimits = {
  maxBoostDb: MAX_BOOST_DB,
  maxCutDb: MAX_CUT_DB,
  maxBands: ROOM_EQ_MAX_BANDS,
  toleranceDb: MATCH_TOLERANCE_DB,
}

/**
 * "Yumuşak oda düzeltmesi" (şu an kullanılmıyor; kalibrasyon varsayılan sınırları kullanır): yalnızca kısma (yükseltme yok), toplamda en çok −6 dB,
 * en çok 4 bant, 1,5 dB altındaki farklar için bant yok.
 */
export const GENTLE_ROOM_EQ_LIMITS: RoomEqLimits = {
  maxBoostDb: 0,
  maxCutDb: 6,
  maxBands: 4,
  toleranceDb: 1.5,
  capTotalCut: true,
}

/**
 * `reference`: verilen referans hoparlör hedef; `average`: hepsinin ortalaması; `best`: ölçülen en düz/en geniş bantlı
 * hoparlör hedef (ona EQ uygulanmaz). `best`, donuk küçük ön hoparlörlerin (ör. monitör) iyi bir hoparlörü kendilerine
 * benzetip boğmasını önler.
 */
export type MatchTarget = 'reference' | 'average' | 'best'

/**
 * Düzlük puanı (küçük = iyi): hizalanmış eğrinin 200 Hz–12 kHz'teki RMS'i (bas yönetimiyle kesilen bölge hariç; −20 dB'de
 * kırpılır ki tek bir derin çentik puanı ele geçirmesin). Tizi erken düşen ya da sivri tepeli hoparlör yüksek puan alır.
 */
export function flatnessScore(hz: readonly number[], aligned: readonly number[], loHz = 0): number {
  const lo = Math.max(200, loHz)
  const v = hz.map((f, i) => (f >= lo && f <= MATCH_HI_HZ ? Math.max(aligned[i], -20) : null)).filter((x): x is number => x !== null)
  return v.length ? Math.sqrt(v.reduce((a, x) => a + x * x, 0) / v.length) : Infinity
}

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
export function fitPeaks(
  hz: readonly number[],
  want: readonly number[],
  use: readonly boolean[],
  maxBands = ROOM_EQ_MAX_BANDS,
  limits: RoomEqLimits = DEFAULT_ROOM_EQ_LIMITS,
): PeqBand[] {
  const { maxBoostDb, maxCutDb, toleranceDb } = limits
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
    // Yükseltme yasaksa yalnızca kısılacak (eksi) hatalar aranır.
    const score = (v: number) => (maxBoostDb > 0 ? Math.abs(v) : Math.max(0, -v))
    let at = pts[0]
    for (const i of pts) if (score(sm(i)) > score(sm(at))) at = i
    const g0 = sm(at)
    if (score(g0) < toleranceDb) break
    // Genişlik: aynı işaretli ve yarı yükseklikten büyük komşuluk.
    let lo = at
    let hi = at
    while (lo - 1 >= 0 && use[lo - 1] && Math.sign(res[lo - 1]) === Math.sign(g0) && Math.abs(res[lo - 1]) > Math.abs(g0) / 2) lo--
    while (hi + 1 < hz.length && use[hi + 1] && Math.sign(res[hi + 1]) === Math.sign(g0) && Math.abs(res[hi + 1]) > Math.abs(g0) / 2) hi++
    const bw = Math.max(1 / 6, Math.log2(hz[hi] / hz[lo]))
    const q0 = clamp(Math.sqrt(Math.pow(2, bw)) / (Math.pow(2, bw) - 1), 0.5, MAX_Q)

    const before = err(eq)
    let best = { f: hz[at], q: q0, g: clamp(g0, -cutAt(hz[at], maxCutDb), maxBoostDb), e: Infinity }
    for (const fm of [-1 / 24, 0, 1 / 24])
      for (const gm of [0.7, 0.85, 1, 1.15])
        for (const qm of [0.6, 0.8, 1, 1.25, 1.6]) {
          const f = hz[at] * Math.pow(2, fm)
          const g = clamp(g0 * gm, -cutAt(f, maxCutDb), maxBoostDb)
          const q = clamp(q0 * qm, 0.5, MAX_Q)
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
      for (let g = -cutAt(b.f, maxCutDb); g <= maxBoostDb + 1e-9; g += 0.25) {
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
    if (top <= maxBoostDb + 0.05) break
    const f = Math.max(0, maxBoostDb) / top
    bands.forEach((b) => {
      if (b.g > 0) b.g *= f
    })
  }
  // Tizde toplam kısma da sınırlı: üst üste binen bantların eteği 4 kHz üstünde HF_MAX_CUT_DB'yi aşmasın.
  const hfIdx = hz.map((f, i) => (f >= HF_LIMIT_HZ ? i : -1)).filter((i) => i >= 0)
  for (let k = 0; k < 20 && hfIdx.length > 0; k++) {
    const c = curve()
    const bottom = Math.min(...hfIdx.map((i) => c[i]))
    if (bottom >= -HF_MAX_CUT_DB - 0.05) break
    const f = HF_MAX_CUT_DB / -bottom
    bands.forEach((b) => {
      if (b.g < 0 && b.f >= HF_LIMIT_HZ / 2) b.g *= f
    })
  }
  // İsteğe bağlı: toplam kısma da sınırlı (kısan bantlar orantılı küçültülür).
  if (limits.capTotalCut)
    for (let k = 0; k < 20; k++) {
      const bottom = Math.min(...curve())
      if (bottom >= -maxCutDb - 0.05) break
      const f = maxCutDb / -bottom
      bands.forEach((b) => {
        if (b.g < 0) b.g *= f
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
  opts: { target: MatchTarget; referenceId?: string; maxBands?: number; limits?: RoomEqLimits; avoid?: ReadonlySet<string> },
): MatchResult[] {
  const limits = opts.limits ?? DEFAULT_ROOM_EQ_LIMITS
  const maxBands = opts.maxBands ?? limits.maxBands
  const usable = inputs.filter((x) => x.responses.length > 0 && x.responses.every((r) => r.length === hz.length))
  if (usable.length === 0) return []
  const curves = new Map(usable.map((x) => [x.speakerId, alignLevel(hz, spatialAverage(x.responses))]))
  const loOf = (x: MatchInput) => Math.max(MATCH_LO_HZ, (x.highPassHz ?? 0) > 0 ? x.highPassHz! * 1.3 : 0)
  let refIn = usable.find((x) => x.speakerId === opts.referenceId) ?? usable[0]
  if (opts.target === 'best') {
    // Güvenilmeyen (ör. düşük SNR) ölçümler hedef seçilmez; hepsi güvenilmezse yine de en düzü.
    const pool = usable.filter((x) => !opts.avoid?.has(x.speakerId))
    const cands = pool.length ? pool : usable
    refIn = cands.reduce((a, x) =>
      flatnessScore(hz, curves.get(x.speakerId)!, loOf(x)) < flatnessScore(hz, curves.get(a.speakerId)!, loOf(a)) ? x : a,
    )
  }
  const fixedTarget = opts.target === 'reference' || opts.target === 'best'

  let target: number[]
  let targetLo = MATCH_LO_HZ
  if (fixedTarget) {
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
    const isTarget = fixedTarget && x.speakerId === refIn.speakerId
    const want = hz.map((f, i) => clamp(target[i] - measured[i], -cutAt(f, limits.maxCutDb), limits.maxBoostDb))
    const bands = isTarget ? [] : fitPeaks(hz, want, use, maxBands, limits)
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
