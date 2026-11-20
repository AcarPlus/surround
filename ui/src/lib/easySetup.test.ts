import { describe, expect, it } from 'vitest'
import type { CalibrationResult, Device, Speaker } from '../api/types'
import { computeCalibration } from './calibration'
import {
  EASY_DEFAULT_LEVEL,
  MIN_SNR_DB,
  checkMeasurement,
  describeBands,
  easyPatches,
  easySteps,
  easySummary,
  gentleRoomEq,
  measureAdvice,
  parseMicChoice,
  retryLevel,
  serializeMicChoice,
  sourceState,
  speakersToMeasure,
  stepAfter,
  stepBefore,
  weakIds,
} from './easySetup'
import { REF_FS, magnitude, peaking } from './eqCurve'

const dev = (id: string, name: string, channels: number, over: Partial<Device> = {}): Device => ({
  id,
  name,
  kind: 'local',
  flow: 'render',
  channels,
  sampleRate: 48000,
  isDefault: false,
  ...over,
})
const sp = (id: string, extra: Partial<Speaker> = {}): Speaker => ({
  id,
  name: id.toUpperCase(),
  outputDeviceId: 'd',
  deviceChannel: 1,
  source: { FL: 1 },
  delayMs: 0,
  gainDb: 0,
  mute: false,
  x: 0,
  y: 0,
  ...extra,
})
const m = (speakerId: string, extra: object = {}) => ({
  speakerId,
  ok: true,
  arrivalMs: 0,
  levelDb: 0,
  snrDb: 35,
  spreadMs: 0.02,
  lowBand: false,
  ...extra,
})
const res = (speakers: CalibrationResult['speakers'], extra: Partial<CalibrationResult> = {}): CalibrationResult => ({
  referenceSpeakerId: 'a',
  micDeviceId: 'mic',
  noiseFloorDb: -60,
  micClipped: false,
  speakers,
  ...extra,
})

describe('adımlar', () => {
  it('baştan kurulum 7 adım, yeniden ölçüm mikrofondan başlar', () => {
    expect(easySteps(null)).toEqual(['source', 'speakers', 'mic', 'place', 'measure', 'eq', 'done'])
    const re = easySteps('mic')
    expect(re[0]).toBe('mic')
    expect(stepBefore(re, 'mic')).toBeNull()
    expect(stepAfter(re, 'mic')).toBe('measure')
    expect(stepAfter(re, 'done')).toBe('done')
    expect(stepBefore(easySteps(null), 'place')).toBe('mic')
  })
})

describe('ses kaynağı', () => {
  const cable = dev('cab', 'CABLE Input (VB-Audio Virtual Cable)', 8)
  it('VB-Cable yoksa missing', () => {
    expect(sourceState([dev('spk', 'Hoparlör', 2)], { mode: 'loopback', deviceId: 'spk' }).kind).toBe('missing')
  })
  it('kurulu ama stereo ya da seçili değilse needs-setup ve nedenleri', () => {
    const s = sourceState([{ ...cable, channels: 2 }], { mode: 'loopback', deviceId: 'spk' })
    expect(s.kind).toBe('needs-setup')
    expect(s.kind === 'needs-setup' && s.reasons.length).toBe(2)
  })
  it('8 kanallı ve loopback kaynak olarak seçiliyse ready', () => {
    expect(sourceState([cable], { mode: 'loopback', deviceId: 'cab' }).kind).toBe('ready')
  })
})

describe('ölçülecek hoparlörler', () => {
  it('sessizdekiler, kaynak cihazdakiler ve başka cihazdakiler hariç', () => {
    const list = [sp('a'), sp('b', { mute: true }), sp('c', { outputDeviceId: 'src' }), sp('d', { outputDeviceId: 'hp' })]
    expect(speakersToMeasure(list, { mode: 'loopback', deviceId: 'src' }).map((s) => s.id)).toEqual(['a', 'd'])
    expect(speakersToMeasure(list, { mode: 'loopback', deviceId: 'src' }, new Set(['d'])).map((s) => s.id)).toEqual(['a'])
  })
})

describe('ölçüm denetimi', () => {
  const speakers = [sp('a'), sp('b'), sp('c')]
  it('hepsi iyiyse ok', () => {
    const c = checkMeasurement(res([m('a'), m('b'), m('c')]), speakers)
    expect(c.status).toBe('ok')
    expect(measureAdvice(c, false)).toEqual([])
  })
  it('düşük SNR ya da başarısız ölçüm zayıf sayılır ve uygulanmaz (sessizce değil: warn)', () => {
    const r = res([m('a'), m('b', { snrDb: MIN_SNR_DB - 1 }), m('c', { ok: false, snrDb: 3 })])
    const c = checkMeasurement(r, speakers)
    expect(c.status).toBe('warn')
    expect(c.weak.map((w) => w.name)).toEqual(['B', 'C'])
    expect(measureAdvice(c, true).length).toBeGreaterThan(0)
    // Zayıflar computeCalibration'a dışlanmış olarak verilir: yama üretilmez.
    const rows = computeCalibration(r, speakers, { excluded: weakIds(r) })
    const patches = easyPatches(rows, [], false, 'T')
    expect(Object.keys(patches)).toEqual(['a'])
  })
  it('hiçbiri duyulmadıysa fail', () => {
    expect(checkMeasurement(res([m('a', { ok: false }), m('b', { snrDb: 5 })]), speakers).status).toBe('fail')
  })
  it('mikrofon kırpıldıysa ya da ortada değilse warn', () => {
    expect(checkMeasurement(res([m('a')], { micClipped: true }), speakers).status).toBe('warn')
    const c = checkMeasurement(res([m('a'), m('b')]), speakers, { pair: 'A / B', deltaMs: 2, deltaDb: 0 })
    expect(c.status).toBe('warn')
    expect(measureAdvice(c, false).join(' ')).toContain('A / B')
  })
  it('tekrar seviyesi: zayıfta bir kademe yüksek, kırpılmada bir kademe kısık', () => {
    expect(retryLevel(EASY_DEFAULT_LEVEL, { clipped: false, weak: [{ id: 'a', name: 'A' }] })).toBe(-12)
    expect(retryLevel(-12, { clipped: false, weak: [{ id: 'a', name: 'A' }] })).toBe(-12)
    expect(retryLevel(EASY_DEFAULT_LEVEL, { clipped: true, weak: [] })).toBe(-30)
    expect(retryLevel(-20, { clipped: false, weak: [] })).toBe(-20)
  })
})

describe('yumuşak oda düzeltmesi', () => {
  const HZ = Array.from({ length: 89 }, (_, i) => 100 * Math.pow(2, i / 12))
  const pk = (fc: number, q: number, g: number) => HZ.map((f) => 20 * Math.log10(magnitude(peaking(REF_FS, fc, q, g), REF_FS, f)))
  const flat = HZ.map(() => -40)
  const bump = flat.map((v, i) => v + pk(2500, 2, 9)[i])

  it('yalnızca kısar, zayıfları ve subwoofer’ı eşlemez', () => {
    const r = res(
      [m('a', { responseDb: flat }), m('b', { responseDb: bump }), m('c', { responseDb: bump, snrDb: 5 }), m('s', { lowBand: true })],
      { responseHz: HZ },
    )
    const list = [sp('a'), sp('b'), sp('c'), sp('s', { role: 'sub', source: { LFE: 1 } })]
    const matches = gentleRoomEq(r, list, weakIds(r))
    expect(matches.map((x) => x.speakerId)).toEqual(['a', 'b'])
    for (const x of matches) x.bands.forEach((b) => expect(b.gainDb).toBeLessThan(0))
    const b = matches.find((x) => x.speakerId === 'b')!
    expect(b.bands.length).toBeGreaterThan(0)
    expect(b.bands.length).toBeLessThanOrEqual(4)
    expect(describeBands(b.bands)).toMatch(/noktada hafif kısma/)
    expect(describeBands([])).toBe('Düzeltme gerekmedi')

    const rows = computeCalibration(r, list, { excluded: weakIds(r) })
    const on = easyPatches(rows, matches, true, 'T')
    expect(on.b.roomEq).toEqual(b.bands)
    expect(on.c).toBeUndefined()
    const off = easyPatches(rows, matches, false, 'T')
    expect('roomEq' in off.b && off.b.roomEq).toBeUndefined()
  })

  it('yanıt ölçülmediyse boş', () => {
    expect(gentleRoomEq(res([m('a')]), [sp('a')])).toEqual([])
  })
})

describe('özet ve mikrofon seçimi', () => {
  it('özet sade cümlelerle', () => {
    const s = easySummary({ speakers: 4, measured: 3, skipped: 1, roomEq: 'applied', cable: false })
    expect(s[0]).toBe('4 hoparlör hazır.')
    expect(s).toContain('Ses gecikmeleri ve seviyeler eşitlendi.')
    expect(s.some((l) => l.includes('1 hoparlör ölçülemedi'))).toBe(true)
    expect(s.some((l) => l.includes('Oda düzeltmesi uygulandı'))).toBe(true)
    expect(s.some((l) => l.includes('VB-Cable yok'))).toBe(true)
  })
  it('son mikrofon seçimi: cihaz yoksa geçersiz', () => {
    const mics = [dev('m1', 'Mikrofon', 1, { flow: 'capture' })]
    expect(parseMicChoice(serializeMicChoice({ kind: 'phone' }), mics)).toEqual({ kind: 'phone' })
    expect(parseMicChoice(serializeMicChoice({ kind: 'device', deviceId: 'm1' }), mics)).toEqual({ kind: 'device', deviceId: 'm1' })
    expect(parseMicChoice('device:yok', mics)).toBeNull()
    expect(parseMicChoice(null, mics)).toBeNull()
  })
})
