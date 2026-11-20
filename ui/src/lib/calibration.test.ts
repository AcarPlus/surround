import { describe, expect, it } from 'vitest'
import type { CalibrationResult, Speaker } from '../api/types'
import {
  calibrationPatches,
  calibrationPercent,
  calibrationRequest,
  computeCalibration,
  matchInputs,
  micDevices,
  offCentreSuspect,
  onSourceDevice,
  pickReference,
  withRoomEq,
} from './calibration'

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

describe('ortak ölçüm yardımcıları', () => {
  const sub = sp('s', { role: 'sub', source: { LFE: 1 } })

  it('referans: istenen listedeyse o, yoksa ilk subwoofer olmayan', () => {
    expect(pickReference([sub, sp('a'), sp('b')], 'b')).toBe('b')
    expect(pickReference([sub, sp('a')], 'yok')).toBe('a')
    expect(pickReference([sub])).toBe('s')
    expect(pickReference([])).toBeUndefined()
  })

  it('istek: subwoofer bas bandında, boş bayraklar gönderilmez', () => {
    const r = calibrationRequest({ micDeviceId: 'mic', speakers: [sub, sp('a')], repeats: 2, levelDb: -20, responses: true })
    expect(r).toEqual({
      micDeviceId: 'mic',
      micLoopback: undefined,
      speakerIds: ['s', 'a'],
      referenceSpeakerId: 'a',
      lowBandSpeakerIds: ['s'],
      repeats: 2,
      levelDb: -20,
      responses: true,
      applyCorrections: undefined,
    })
    expect(calibrationRequest({ micDeviceId: 'x', loopback: true, speakers: [sp('a')], repeats: 1, levelDb: -12, verify: true })).toMatchObject({
      micLoopback: true,
      applyCorrections: true,
      responses: undefined,
    })
  })

  it('mikrofonlar sanal kablonun kayıt ucunu içermez; kaynak cihazdaki hoparlör ölçülemez', () => {
    const devs = [
      { id: 'm', name: 'Mikrofon', kind: 'local', flow: 'capture', channels: 1, sampleRate: 48000, isDefault: true },
      { id: 'c', name: 'CABLE Output', kind: 'local', flow: 'capture', channels: 8, sampleRate: 48000, isDefault: false },
      { id: 'h', name: 'Hoparlör', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
    ] as const
    expect(micDevices([...devs]).map((d) => d.id)).toEqual(['m'])
    expect(onSourceDevice({ outputDeviceId: 'h' }, { mode: 'loopback', deviceId: 'h' })).toBe(true)
    expect(onSourceDevice({ outputDeviceId: 'h' }, { mode: 'capture', deviceId: 'h' })).toBe(false)
  })

  it('tını girdileri: subwoofer ve atlananlar hariç, yalnızca başarılı yanıtlar', () => {
    const r1 = result([m('a', 0, 0, { responseDb: [1, 2] }), m('b', 0, 0, { ok: false, responseDb: [3, 4] }), m('c', 0, 0, { responseDb: [5, 6] })])
    const r2 = result([m('a', 0, 0, { responseDb: [7, 8] })])
    const inp = matchInputs([sp('a'), sp('b'), sp('c'), sub], [r1, r2], new Set(['c']))
    expect(inp.map((x) => x.speakerId)).toEqual(['a', 'b'])
    expect(inp[0].responses).toEqual([[1, 2], [7, 8]])
    expect(inp[1].responses).toEqual([])
  })

  it('roomEq yamaya eklenir; bant yoksa kalkar; dışlanan dokunulmaz', () => {
    const band = { id: 'room-1', type: 'peak' as const, freqHz: 1000, gainDb: -3, q: 1 }
    const mr = (speakerId: string, bands: (typeof band)[]) =>
      ({ speakerId, isTarget: false, bands, measured: [], target: [], corrected: [], loHz: 0, hiHz: 0, rmsBefore: 0, rmsAfter: 0, maxAfter: 0 })
    const out = withRoomEq({ a: { delayMs: 1 } }, [mr('a', [band]), mr('b', []), mr('c', [band])], new Set(['c']), 'T')
    expect(out.a).toEqual({ delayMs: 1, roomEq: [band], calibratedAt: 'T' })
    expect(out.b).toEqual({ roomEq: undefined, calibratedAt: 'T' })
    expect(out.c).toBeUndefined()
  })
})
