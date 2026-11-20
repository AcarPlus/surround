import { describe, expect, it } from 'vitest'
import type { Device, Room } from '../api/types'
import { applyTaps, blockedBySource, setTapAngle, buildQuickStart, quickStartDevices, quickStartKits } from './quickStart'
import { planSpeakers } from './setup'
import { angleToPosition } from './tapPlace'

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

const room: Room = { widthM: 5, depthM: 4.5, listener: { x: 2.5, y: 2.3 } }
const SPK = dev('spk', 'Hoparlör (Realtek)', 2)
const DIG = dev('dig', 'Dijital Çıkış (Realtek)', 2)
const PHONES = dev('hp', 'Kulaklık (Realtek)', 2)
const CABLE = dev('cable', 'CABLE Input (VB-Audio Virtual Cable)', 8)
const MIC = dev('mic', 'Mikrofon', 2, { flow: 'capture' })
const HDMI = dev('hdmi', 'HDMI Çıkış', 8)

describe('ölçmeden başla: cihaz bulma', () => {
  it('kaynak, sanal kablo, kulaklık ve kayıt cihazları listelenmez; hoparlör adlısı öne gelir', () => {
    const list = quickStartDevices([DIG, PHONES, CABLE, MIC, SPK], 'cable')
    expect(list.map((d) => d.id)).toEqual(['spk', 'dig'])
    expect(quickStartDevices([SPK, dev('src', 'Başka', 2)], 'src').map((d) => d.id)).toEqual(['spk'])
  })

  it('stereo cihazlar çift olur: ilki önde, sonrakiler arkada / yanda', () => {
    const third = dev('t3', 'Çıkış 3', 2)
    const kits = quickStartKits([SPK, DIG, third])
    expect(kits.map((k) => [k.kind, k.place])).toEqual([
      ['pair', 'front'],
      ['pair', 'back'],
      ['pair', 'side'],
    ])
    const plan = planSpeakers(kits, [SPK, DIG, third])
    expect(plan.map((p) => p.role)).toEqual(['left', 'right', 'back-left', 'back-right', 'side-left', 'side-right'])
    expect(plan.every((p) => p.preset === 'flat')).toBe(true)
  })

  it('çok kanallı cihaz varsayılan rollerini alır, tek kanallı tek hoparlör olur, dışlanan kullanılmaz', () => {
    const mono = dev('mono', 'Tek', 1)
    const kits = quickStartKits([HDMI, mono, SPK], new Set(['spk']))
    expect(kits.map((k) => k.kind)).toEqual(['multi', 'single', 'none'])
    const plan = planSpeakers(kits, [HDMI, mono, SPK])
    expect(plan.filter((p) => p.deviceId === 'hdmi').map((p) => p.role)).toEqual([
      'left',
      'right',
      'center',
      'sub',
      'back-left',
      'back-right',
      'side-left',
      'side-right',
    ])
    expect(plan.some((p) => p.deviceId === 'spk')).toBe(false)
  })
})

describe('ölçmeden başla: dokunarak yerleştirme', () => {
  const plan = planSpeakers(quickStartKits([SPK]), [SPK])

  it('dokunulan açı rolü ve konumu belirler; atlanan standart yerinde kalır', () => {
    const { plan: p, positions } = applyTaps(plan, [-100, null], room)
    expect(p[0].role).toBe('side-left')
    expect(p[0].name).toBe('Yan sol')
    expect(p[1].role).toBe('right')
    expect(Object.keys(positions)).toEqual(['spk#1'])
    expect(positions['spk#1']).toEqual(angleToPosition(-100, room))
  })

  it('aynı role düşen hoparlörlere sıra numarası verilir; subwoofer rolünü korur', () => {
    const sub = planSpeakers(quickStartKits([HDMI]), [HDMI])
    const angles = sub.map(() => 0)
    const { plan: p } = applyTaps(sub, angles, room)
    const sub1 = p.find((x) => x.channel === 4)!
    expect(sub1.role).toBe('sub')
    const centers = p.filter((x) => x.role === 'center')
    expect(centers.length).toBe(7)
    expect(centers[0].name).toBe('Orta 1')
  })

  it('buildQuickStart: gecikme 0, kazanç 0, konum dokunulan yerde, EQ yok', () => {
    const r = buildQuickStart({
      devices: [SPK, DIG, CABLE],
      sourceDeviceId: 'cable',
      excluded: new Set(['dig']),
      angles: [-20, 20],
      speakers: [],
      outputs: [],
      room,
    })
    expect(r.speakers).toHaveLength(2)
    expect(r.speakers.every((s) => s.delayMs === 0 && s.gainDb === 0 && !s.mute)).toBe(true)
    expect(r.speakers.every((s) => !s.eq || s.eq.every((g) => g === 0))).toBe(true)
    expect(r.speakers[0].x).toBe(angleToPosition(-20, room).x)
    expect(r.speakers[1].x).toBeGreaterThan(room.listener.x)
    expect(r.outputs.map((o) => o.deviceId)).toEqual(['spk'])
    expect(r.createdIds).toHaveLength(2)
  })

  it('dışlanan cihazın eski hoparlörleri kalkar, kulaklıktaki korunur', () => {
    const first = buildQuickStart({ devices: [SPK, DIG, PHONES], sourceDeviceId: 'x', speakers: [], outputs: [], room })
    const withPhone = [
      ...first.speakers,
      { ...first.speakers[0], id: 'hp-1', outputDeviceId: 'hp', deviceChannel: 1 },
    ]
    const r = buildQuickStart({
      devices: [SPK, DIG, PHONES],
      sourceDeviceId: 'x',
      excluded: new Set(['dig']),
      speakers: withPhone,
      outputs: first.outputs,
      room,
    })
    expect(r.speakers.some((s) => s.outputDeviceId === 'dig')).toBe(false)
    expect(r.speakers.some((s) => s.id === 'hp-1')).toBe(true)
  })
})

describe('blockedBySource', () => {
  it('VB-Cable yokken kaynak olan hoparlörü bildirir (liste boş kalırsa açıklama için)', () => {
    const devices = [SPK, dev('mic', 'Mikrofon', 1, { flow: 'capture' })]
    expect(quickStartDevices(devices, 'spk')).toEqual([])
    expect(blockedBySource(devices, 'spk')?.id).toBe('spk')
  })
  it('kaynak sanal kablo, kayıt cihazı ya da yoksa null', () => {
    const cable = dev('cab', 'CABLE Input (VB-Audio Virtual Cable)', 8)
    expect(blockedBySource([SPK, cable], 'cab')).toBeNull()
    expect(blockedBySource([SPK, dev('mic', 'Mikrofon', 1, { flow: 'capture' })], 'mic')).toBeNull()
    expect(blockedBySource([SPK], 'yok')).toBeNull()
  })
})

describe('setTapAngle', () => {
  it('açıyı yazar, Atla (null) siler', () => {
    const a = setTapAngle({}, 'd#1', 30)
    expect(a).toEqual({ 'd#1': 30 })
    expect(setTapAngle(a, 'd#1', null)).toEqual({})
    expect(setTapAngle(a, 'd#2', null)).toEqual(a)
  })
})
