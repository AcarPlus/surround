import { describe, expect, it } from 'vitest'
import { REF_FS, magnitude, peaking } from './eqCurve'
import { GENTLE_ROOM_EQ_LIMITS, MAX_BOOST_DB, alignLevel, bandsDb, matchSpeakers, spatialAverage } from './roomEq'

/** C# ResponseGrid ile aynı: 100 Hz'den 1/12 oktav, 89 nokta. */
const HZ = Array.from({ length: 89 }, (_, i) => 100 * Math.pow(2, i / 12))
const pk = (fc: number, q: number, g: number) => HZ.map((f) => 20 * Math.log10(magnitude(peaking(REF_FS, fc, q, g), REF_FS, f)))
const add = (...c: number[][]) => HZ.map((_, i) => c.reduce((a, v) => a + v[i], 0))
const flat = HZ.map(() => -40)
const inBand = (f: number) => f >= 150 && f <= 12000

describe('roomEq', () => {
  it('konum ortalaması güçte alınır ve seviye 500 Hz–4 kHz ortalamasına hizalanır', () => {
    const a = spatialAverage([HZ.map(() => 0), HZ.map(() => 10)])
    expect(a[0]).toBeCloseTo(10 * Math.log10(5.5), 6)
    const al = alignLevel(HZ, add(flat, pk(2000, 1, 6)))
    const mid = HZ.map((f, i) => (f >= 500 && f <= 4000 ? al[i] : null)).filter((v): v is number => v !== null)
    expect(mid.reduce((s, v) => s + v, 0) / mid.length).toBeCloseTo(0, 6)
  })

  it('renk farkını düzeltir: tepeyi keser, sapma belirgin düşer', () => {
    const ref = flat
    const colored = add(flat, pk(2500, 2, 7), pk(400, 1.2, -4))
    const [r0, r1] = matchSpeakers(HZ, [
      { speakerId: 'ref', responses: [ref] },
      { speakerId: 'b', responses: [colored] },
    ], { target: 'reference', referenceId: 'ref' })
    expect(r0.isTarget).toBe(true)
    expect(r0.bands).toEqual([])
    expect(r1.rmsBefore).toBeGreaterThan(2)
    expect(r1.rmsAfter).toBeLessThan(0.6)
    const cut = r1.bands.find((b) => b.freqHz > 2000 && b.freqHz < 3200)
    expect(cut?.gainDb).toBeLessThan(-5)
    expect(r1.bands.length).toBeLessThanOrEqual(8)
  })

  it('derin çukuru doldurmaz: yükseltme +6 dB ile sınırlı', () => {
    const dip = add(flat, pk(3000, 4, -12))
    const [, r] = matchSpeakers(HZ, [
      { speakerId: 'ref', responses: [flat] },
      { speakerId: 'b', responses: [dip] },
    ], { target: 'reference', referenceId: 'ref' })
    const eq = bandsDb(HZ, r.bands)
    expect(Math.max(...eq)).toBeLessThanOrEqual(MAX_BOOST_DB + 0.3)
    r.bands.forEach((b) => expect(b.gainDb).toBeLessThanOrEqual(MAX_BOOST_DB))
  })

  it('bas yönetimiyle kesilen bölgeye dokunmaz', () => {
    // Küçük uydu: 150 Hz kesimli; 300 Hz altında hedeften çok aşağıda — orası yok sayılmalı.
    const small = HZ.map((f) => (f < 300 ? -40 - 20 * Math.log2(300 / f) : -40))
    const [, r] = matchSpeakers(HZ, [
      { speakerId: 'ref', responses: [flat] },
      { speakerId: 'sat', responses: [small], highPassHz: 250 },
    ], { target: 'reference', referenceId: 'ref' })
    expect(r.loHz).toBeCloseTo(325, 0)
    expect(r.bands.every((b) => b.freqHz > 250)).toBe(true)
  })

  it('bas kesimi ayarlanmamış küçük hoparlörün doğal düşüşünü yükseltmez', () => {
    // 250 Hz altında oktavda 12 dB düşen uydu, highPassHz verilmemiş.
    const small = HZ.map((f) => (f < 250 ? -40 - 12 * Math.log2(250 / f) : -40))
    const [, r] = matchSpeakers(HZ, [
      { speakerId: 'ref', responses: [flat] },
      { speakerId: 'sat', responses: [small] },
    ], { target: 'reference', referenceId: 'ref' })
    expect(r.loHz).toBeGreaterThan(180)
    const eq = bandsDb(HZ, r.bands)
    HZ.forEach((f, i) => {
      if (f < 160) expect(eq[i]).toBeLessThan(1.5)
    })
  })

  it('ortalama hedefinde herkes ortaya çekilir', () => {
    const a = add(flat, pk(1500, 1.5, 4))
    const b = add(flat, pk(1500, 1.5, -4))
    const res = matchSpeakers(HZ, [
      { speakerId: 'a', responses: [a] },
      { speakerId: 'b', responses: [b] },
    ], { target: 'average' })
    expect(res.every((r) => !r.isTarget)).toBe(true)
    expect(res.every((r) => r.rmsAfter < r.rmsBefore / 2)).toBe(true)
    const i = HZ.findIndex((f) => f >= 1500)
    expect(Math.abs(res[0].target[i])).toBeLessThan(1.5)
    expect(HZ.filter(inBand).length).toBeGreaterThan(60)
  })

  describe('yumuşak (yalnızca kısma) sınırlar', () => {
    const run = (curve: number[]) =>
      matchSpeakers(HZ, [
        { speakerId: 'ref', responses: [flat] },
        { speakerId: 'b', responses: [curve] },
      ], { target: 'reference', referenceId: 'ref', limits: GENTLE_ROOM_EQ_LIMITS })[1]

    it('hiçbir yeri yükseltmez: çukur doldurulmaz', () => {
      const r = run(add(flat, pk(3000, 2, -8)))
      r.bands.forEach((b) => expect(b.gainDb).toBeLessThan(0))
      const eq = bandsDb(HZ, r.bands)
      expect(Math.max(...eq)).toBeLessThanOrEqual(0.01)
      expect(eq[HZ.findIndex((f) => f >= 3000)]).toBeLessThanOrEqual(0.01)
    })

    it('tepeyi en çok 6 dB kısar, en çok 4 bant kullanır; çukura dokunmaz', () => {
      const r = run(add(flat, pk(2500, 2, 10), pk(800, 2, 5), pk(5000, 3, 6), pk(1500, 3, 4), pk(400, 2, -7)))
      expect(r.bands.length).toBeGreaterThan(0)
      expect(r.bands.length).toBeLessThanOrEqual(4)
      r.bands.forEach((b) => expect(b.gainDb).toBeLessThan(0))
      const eq = bandsDb(HZ, r.bands)
      expect(Math.min(...eq)).toBeGreaterThanOrEqual(-6.1)
      expect(Math.max(...eq)).toBeLessThanOrEqual(0.01)
      // 400 Hz çukuru yükseltilmez.
      const i400 = HZ.findIndex((f) => f >= 400)
      expect(eq[i400]).toBeLessThanOrEqual(0.01)
      // En büyük tepe (2,5 kHz) kısılır.
      expect(r.bands.some((b) => b.freqHz > 2000 && b.freqHz < 3200)).toBe(true)
      expect(r.rmsAfter).toBeLessThan(r.rmsBefore)
    })

    it('küçük farklar (1,5 dB altı) için bant eklemez', () => {
      expect(run(add(flat, pk(2000, 1.5, 1.2))).bands).toEqual([])
    })

    it('varsayılan (Gelişmiş) sınırlar değişmedi: çukur +6 dB ile doldurulur', () => {
      const [, r] = matchSpeakers(HZ, [
        { speakerId: 'ref', responses: [flat] },
        { speakerId: 'b', responses: [add(flat, pk(3000, 2, -8))] },
      ], { target: 'reference', referenceId: 'ref' })
      expect(r.bands.some((b) => b.gainDb > 0)).toBe(true)
    })
  })
})
