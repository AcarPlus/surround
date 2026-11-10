import { describe, expect, it } from 'vitest'
import type { Device, Room, Speaker } from '../api/types'
import {
  buildSpeakers,
  candidateDevices,
  initialKits,
  kitFromSpeakers,
  planLabel,
  planSpeakers,
  placementRadius,
  standardPosition,
  type DeviceKit,
} from './setup'

const dev = (id: string, name: string, channels = 2, flow: Device['flow'] = 'render'): Device => ({
  id,
  name,
  kind: channels > 2 ? 'multichannel' : 'local',
  flow,
  channels,
  sampleRate: 48000,
  isDefault: false,
})

const DEVICES = [
  dev('spk', 'Hoparlör (Realtek)'),
  dev('2nd', 'Realtek HD Audio 2nd output'),
  dev('hp', 'Kulaklık (USB)'),
  dev('cable', 'CABLE Input (VB-Audio Virtual Cable)', 8),
  dev('mic', 'Mikrofon', 1, 'capture'),
]
const room: Room = { widthM: 4, depthM: 4, listener: { x: 2, y: 2 } }

const kit = (p: Partial<DeviceKit> & { deviceId: string }): DeviceKit => ({
  kind: 'none',
  place: 'front',
  pairType: 'flat',
  swap: false,
  role: 'center',
  roles: [],
  ...p,
})

describe('candidateDevices', () => {
  it('kaynak, kablo ve giriş cihazlarını dışarıda bırakır', () => {
    expect(candidateDevices(DEVICES, 'cable').map((d) => d.id)).toEqual(['spk', '2nd', 'hp'])
  })
})

describe('initialKits', () => {
  it('boş kurulumda ilk Hoparlör cihazını ön çift sayar, kulaklığı kullanmaz', () => {
    const kits = initialKits(candidateDevices(DEVICES, 'cable'), [])
    expect(kits.map((k) => k.kind)).toEqual(['pair', 'none', 'none'])
  })

  it('mevcut hoparlörlerden kiti geri çıkarır (2.1 ön + küçük arka)', () => {
    const sp = (id: string, d: string, ch: number, role: string, extra: Partial<Speaker> = {}): Speaker => ({
      id, name: id, outputDeviceId: d, deviceChannel: ch, source: {}, delayMs: 0, gainDb: 0, mute: false, x: 0, y: 0, role, ...extra,
    })
    const speakers = [
      sp('a', 'spk', 1, 'left', { bassReceiver: true }),
      sp('b', 'spk', 2, 'right', { bassReceiver: true }),
      sp('c', '2nd', 1, 'back-right', { highPassHz: 150, eqPreset: 'small-satellite' }),
      sp('d', '2nd', 2, 'back-left', { highPassHz: 150, eqPreset: 'small-satellite' }),
    ]
    const kits = initialKits(candidateDevices(DEVICES, 'cable'), speakers)
    expect(kits[0]).toMatchObject({ kind: 'pair21', place: 'front', swap: false })
    expect(kits[1]).toMatchObject({ kind: 'pair', place: 'back', swap: true, pairType: 'small-satellite' })
    expect(kits[2].kind).toBe('none')
  })

  it('tek hoparlör ve çok kanallı cihazı tanır', () => {
    const multi = dev('m', 'HDMI', 8)
    const s = (ch: number, role: string): Speaker => ({
      id: `m${ch}`, name: '', outputDeviceId: 'm', deviceChannel: ch, source: {}, delayMs: 0, gainDb: 0, mute: false, x: 0, y: 0, role,
    })
    const k = kitFromSpeakers(multi, [s(1, 'left'), s(2, 'right'), s(4, 'sub')])!
    expect(k.kind).toBe('multi')
    expect(k.roles).toEqual(['left', 'right', '', 'sub', '', '', '', ''])
    const single = kitFromSpeakers(DEVICES[0], [s(1, 'center')].map((v) => ({ ...v, outputDeviceId: 'spk' })))!
    expect(single).toMatchObject({ kind: 'single', role: 'center' })
  })
})

describe('planSpeakers', () => {
  it('2.1 ön + ters takılı arka çift', () => {
    const plan = planSpeakers(
      [kit({ deviceId: 'spk', kind: 'pair21' }), kit({ deviceId: '2nd', kind: 'pair', place: 'back', swap: true, pairType: 'small-satellite' })],
      DEVICES,
    )
    expect(plan.map((p) => [p.deviceId, p.channel, p.role, p.preset])).toEqual([
      ['spk', 1, 'left', 'desktop-front'],
      ['spk', 2, 'right', 'desktop-front'],
      ['2nd', 1, 'back-right', 'small-satellite'],
      ['2nd', 2, 'back-left', 'small-satellite'],
    ])
    expect(plan[0].name).toBe('Ön sol')
    expect(planLabel(plan)).toBe('4.1')
  })

  it('aynı rol tekrarlanınca adları numaralar, boş kanalları atlar', () => {
    const plan = planSpeakers(
      [
        kit({ deviceId: 'spk', kind: 'pair' }),
        kit({ deviceId: 'cable', kind: 'multi', roles: ['left', '', 'sub'] }),
      ],
      DEVICES,
    )
    expect(plan.map((p) => p.name)).toEqual(['Ön sol 1', 'Ön sağ', 'Ön sol 2', 'Subwoofer'])
    expect(plan[3].channel).toBe(3)
    expect(planLabel(plan)).toBe('3.1')
  })
})

describe('yerleşim', () => {
  it('yarıçap dinleyicinin duvara uzaklığıyla sınırlı', () => {
    expect(placementRadius(room)).toBe(1.9)
    expect(placementRadius({ widthM: 2, depthM: 2, listener: { x: 1, y: 1 } })).toBe(0.95)
    expect(placementRadius({ widthM: 2, depthM: 2, listener: { x: 0.1, y: 1 } })).toBe(0.6)
  })

  it('ön sol solda ve önde, arka sağ sağda ve arkada', () => {
    const fl = standardPosition('left', room, false)
    const br = standardPosition('back-right', room, false)
    expect(fl.x).toBeLessThan(2)
    expect(fl.y).toBeLessThan(2)
    expect(br.x).toBeGreaterThan(2)
    expect(br.y).toBeGreaterThan(2)
  })
})

describe('buildSpeakers', () => {
  const existing: Speaker = {
    id: 'keep',
    name: '�n sol',
    outputDeviceId: 'spk',
    deviceChannel: 1,
    source: { FL: 1 },
    delayMs: 1.5,
    gainDb: -2,
    mute: false,
    x: 0.5,
    y: 0.5,
    role: 'left',
    eq: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  }

  it('aynı cihaz/kanal/roldeki hoparlörü korur, bozuk adı düzeltir, yenisini ön ayarla oluşturur', () => {
    const plan = planSpeakers([kit({ deviceId: 'spk', kind: 'pair', pairType: 'small-satellite' })], DEVICES)
    const r = buildSpeakers(plan, [existing], [{ deviceId: 'spk', latencyMs: 5, bufferMs: 60 }], room)
    expect(r.speakers[0]).toMatchObject({ id: 'keep', name: 'Ön sol', delayMs: 1.5, x: 0.5, eq: existing.eq })
    expect(r.speakers[1]).toMatchObject({ role: 'right', source: { FR: 1 }, highPassHz: 150, eqPreset: 'small-satellite' })
    expect(r.createdIds).toEqual([r.speakers[1].id])
    expect(r.outputs).toEqual([{ deviceId: 'spk', latencyMs: 5, bufferMs: 60 }])
  })

  it('kullanılmayan çıkışları atar', () => {
    const r = buildSpeakers([], [existing], [{ deviceId: 'spk', latencyMs: 0, bufferMs: 40 }], room)
    expect(r.speakers).toEqual([])
    expect(r.outputs).toEqual([])
  })
})
