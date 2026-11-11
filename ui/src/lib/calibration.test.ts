import { describe, expect, it } from 'vitest'
import type { CalibrationResult, Speaker } from '../api/types'
import { calibrationPatches, calibrationPercent, computeCalibration, offCentreSuspect } from './calibration'

const sp = (id: string, extra: Partial<Speaker> = {}): Speaker => ({
  id,
  name: id.toUpperCase(),
  outputDeviceId: 'd',
  deviceChannel: 1,
  source: { FL: 1 },
  delayMs: 9,
  gainDb: -9,
  mute: false,
  x: 0,
  y: 0,
  ...extra,
})

const m = (speakerId: string, arrivalMs: number, levelDb: number, extra: object = {}) => ({
  speakerId,
  ok: true,
  arrivalMs,
  levelDb,
  snrDb: 35,
  spreadMs: 0.02,
  lowBand: false,
  ...extra,
})

const result = (speakers: CalibrationResult['speakers']): CalibrationResult => ({
  referenceSpeakerId: 'a',
  micDeviceId: 'mic',
  noiseFloorDb: -60,
  micClipped: false,
  speakers,
})

describe('computeCalibration', () => {
  const speakers = [sp('a'), sp('b'), sp('c'), sp('s', { role: 'sub', source: { LFE: 1 } })]

  it('en geç ulaşanı 0 ms yapar, diğerlerini aradaki fark kadar geciktirir', () => {
    const rows = computeCalibration(result([m('a', 0, 0), m('b', 4.5, -3), m('c', -1.25, 2)]), speakers)
    expect(rows.map((r) => r.delayMs)).toEqual([4.5, 0, 5.75])
  })

  it('varsayılan hedef en sessiz hoparlör: yalnızca kısma', () => {
    const rows = computeCalibration(result([m('a', 0, 0), m('b', 0, -3), m('c', 0, 2)]), speakers)
    expect(rows.map((r) => r.gainDb)).toEqual([-3, 0, -5])
  })

  it('medyan hedefi en fazla +6 dB güçlendirir', () => {
    const rows = computeCalibration(result([m('a', 0, 0), m('b', 0, -12), m('c', 0, 1)]), speakers, { target: 'median' })
    expect(rows.map((r) => r.gainDb)).toEqual([0, 6, -1])
  })

  it('subwoofer seviyesi karşılaştırılmaz ve hedefi etkilemez', () => {
    const rows = computeCalibration(result([m('a', 0, 0), m('s', 3, -20, { lowBand: true })]), speakers)
    expect(rows[1].gainDb).toBeNull()
    expect(rows[0].gainDb).toBe(0)
    expect(rows[1].warning).toMatch(/Subwoofer/)
  })

  it('başarısız ve hariç tutulan hoparlör eski değerini korur, hesaba katılmaz', () => {
    const rows = computeCalibration(
      result([m('a', 0, 0), m('b', 10, -6, { ok: false, message: 'Zayıf' }), m('c', 2, -1)]),
      speakers,
      { excluded: new Set(['c']) },
    )
    expect(rows[1]).toMatchObject({ include: false, delayMs: 9, gainDb: null, warning: 'Zayıf' })
    expect(rows[2]).toMatchObject({ include: false, delayMs: 9 })
    expect(rows[0]).toMatchObject({ delayMs: 0, gainDb: 0 })
  })

  it('tutarsız tekrarlar uyarı üretir', () => {
    const rows = computeCalibration(result([m('a', 0, 0, { spreadMs: 0.9 })]), speakers)
    expect(rows[0].warning).toMatch(/tutarsız/)
  })

  it('yamalar yalnızca dahil satırları içerir ve kalibrasyon zamanını yazar', () => {
    const rows = computeCalibration(result([m('a', 0, 0), m('b', 1, 0, { ok: false })]), speakers)
    const p = calibrationPatches(rows, 'T')
    expect(Object.keys(p)).toEqual(['a'])
    expect(p.a).toEqual({ delayMs: 0, gainDb: 0, calibratedAt: 'T' })
  })
})

describe('çıkış gecikmesi payı', () => {
  it('motorun eklediği (en büyük − kendi) çıkış gecikmesi önerilen gecikmeden düşülür', () => {
    // b, 30 ms gecikmeli bir çıkışta; motor a'ya 30 ms ekler. b 4,5 ms geç ulaşmış (gecikmesi ölçüme dahil).
    const speakers = [sp('a'), sp('b', { outputDeviceId: 'slow' })]
    const outputs = [
      { deviceId: 'd', latencyMs: 0, bufferMs: 40 },
      { deviceId: 'slow', latencyMs: 30, bufferMs: 40 },
    ]
    const rows = computeCalibration(result([m('a', 0, 0), m('b', 4.5, 0)]), speakers, { outputs })
    // Toplam hedef: a +4,5 ms. Motor a'ya zaten 30 ms ekliyor → b'yi 25,5 ms geciktir, a 0.
    expect(rows.map((r) => r.delayMs)).toEqual([0, 25.5])
  })

  it('çıkış gecikmesi yoksa önceki sonuçla aynı', () => {
    const speakers = [sp('a'), sp('b')]
    const outputs = [{ deviceId: 'd', latencyMs: 30, bufferMs: 40 }]
    const rows = computeCalibration(result([m('a', 0, 0), m('b', 4.5, 0)]), speakers, { outputs })
    expect(rows.map((r) => r.delayMs)).toEqual([4.5, 0])
  })
})

describe('calibrationPercent', () => {
  const p = (phase: 'preparing' | 'noise' | 'measuring' | 'analyzing' | 'done', index: number) => ({ phase, index, total: 4, message: '' })
  it('ölçüm 1 tabanlı index ile 0–85 %, çözümleme 85–100 %', () => {
    expect(calibrationPercent(p('measuring', 1))).toBeCloseTo(85 * 0.125)
    expect(calibrationPercent(p('measuring', 4))).toBeCloseTo(85 * 0.875)
    expect(calibrationPercent(p('analyzing', 1))).toBeCloseTo(85 + 15 * 0.125)
    expect(calibrationPercent(p('analyzing', 4))).toBeLessThan(100)
    expect(calibrationPercent(p('done', 4))).toBe(100)
    expect(calibrationPercent(null)).toBeGreaterThan(0)
  })
})

describe('offCentreSuspect', () => {
  const pair = [sp('l', { name: 'Sol', role: 'left' }), sp('r', { name: 'Sağ', role: 'right', source: { FR: 1 } })]
  const rowsFor = (spk: Speaker[], r: CalibrationResult['speakers']) => computeCalibration(result(r), spk)

  it('tek cihazda, sağ 2 ms erken / +1,8 dB ise uyarır', () => {
    const rows = rowsFor(pair, [m('l', 2, -1.8), m('r', 0, 0)])
    const s = offCentreSuspect(rows, pair)
    expect(s?.pair).toBe('Sol / Sağ')
    expect(s?.deltaMs).toBeGreaterThan(1)
  })
  it('fark küçükse uyarmaz', () => {
    expect(offCentreSuspect(rowsFor(pair, [m('l', 0.4, -0.3), m('r', 0, 0)]), pair)).toBeNull()
  })
  it('sadece dB farkı 1\'i aşarsa da uyarır', () => {
    expect(offCentreSuspect(rowsFor(pair, [m('l', 0, -2), m('r', 0, 0)]), pair)).not.toBeNull()
  })
  it('hoparlörler farklı cihazlardaysa uyarmaz (gerçek gecikme farkı olabilir)', () => {
    const two = [pair[0], { ...pair[1], outputDeviceId: 'other' }]
    expect(offCentreSuspect(rowsFor(two, [m('l', 3, 0), m('r', 0, 0)]), two)).toBeNull()
  })
  it('simetrik çift yoksa uyarmaz', () => {
    const odd = [sp('a', { role: 'left' }), sp('c', { role: 'center', source: { FC: 1 } })]
    expect(offCentreSuspect(rowsFor(odd, [m('a', 3, 0), m('c', 0, 0)]), odd)).toBeNull()
  })
})
