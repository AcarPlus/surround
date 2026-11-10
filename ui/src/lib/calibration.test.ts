import { describe, expect, it } from 'vitest'
import type { CalibrationResult, Speaker } from '../api/types'
import { calibrationPatches, computeCalibration } from './calibration'

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
