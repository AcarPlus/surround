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
  mergeKits,
  outsideSpeakers,
  previousPlan,
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
    eqPreset: 'custom',
    highPassHz: 150,
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

describe('buildSpeakers: sihirbaz yeniden açılınca kit değişikliği', () => {
  const sp = (id: string, ch: number, role: string, extra: Partial<Speaker> = {}): Speaker => ({
    id,
    name: id,
    outputDeviceId: 'spk',
    deviceChannel: ch,
    source: {},
    delayMs: 2,
    gainDb: -1,
    mute: false,
    x: 0.7,
    y: 0.9,
    role,
    calibratedAt: 'T',
    ...extra,
  })
  const flatPair = [sp('a', 1, 'left', { eqPreset: 'flat' }), sp('b', 2, 'right', { eqPreset: 'flat' })]
  const build = (k: Partial<DeviceKit>, existing: Speaker[]) =>
    buildSpeakers(planSpeakers([kit({ deviceId: 'spk', kind: 'pair', ...k })], DEVICES), existing, [], room, {
      prevPlan: previousPlan(DEVICES, existing),
    })

  it('Normal → Küçük: kimlik, konum, gecikme, kalibrasyon kalır; ön ayar yeniden uygulanır', () => {
    const r = build({ pairType: 'small-satellite' }, flatPair)
    expect(r.speakers[0]).toMatchObject({ id: 'a', x: 0.7, delayMs: 2, calibratedAt: 'T', highPassHz: 150, eqPreset: 'small-satellite' })
    expect(r.speakers[1]).toMatchObject({ id: 'b', highPassHz: 150 })
    expect(r.createdIds).toEqual([])
  })

  it('çift → 2.1 set: bas alıcısı açılır; geri dönünce bas kesme ve bas alıcısı kalkar', () => {
    const r = build({ kind: 'pair21' }, flatPair)
    expect(r.speakers.map((s) => [s.id, s.eqPreset, s.bassReceiver])).toEqual([
      ['a', 'desktop-front', true],
      ['b', 'desktop-front', true],
    ])
    const small = build({ pairType: 'small-satellite' }, flatPair).speakers
    const back = build({ pairType: 'flat' }, small).speakers
    expect(back[0]).toMatchObject({ id: 'a', eqPreset: 'flat', highPassHz: undefined, bassReceiver: undefined })
  })

  it('ön ayar değişmediyse elle yapılmış EQ korunur', () => {
    const custom = flatPair.map((s) => ({ ...s, eq: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0], eqPreset: 'custom' }))
    const r = build({}, custom)
    expect(r.speakers[0].eq).toEqual(custom[0].eq)
    expect(r.speakers[0].eqPreset).toBe('custom')
  })

  it('sol/sağ ters: aynı kutu korunur, rol ve ad değişir, karşı tarafa taşınır, ölçüm sıfırlanır', () => {
    const custom = flatPair.map((s) => ({ ...s, eq: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0], eqPreset: 'custom' }))
    const r = build({ swap: true }, custom)
    const [a, b] = r.speakers
    expect(a).toMatchObject({ id: 'a', deviceChannel: 1, role: 'right', name: 'Ön sağ', source: { FR: 1 }, delayMs: 0, gainDb: 0 })
    expect(a.calibratedAt).toBeUndefined()
    expect(a.eq).toEqual(custom[0].eq)
    expect(a.x).toBeGreaterThan(room.listener.x)
    expect(b).toMatchObject({ id: 'b', role: 'left', name: 'Ön sol' })
    expect(r.createdIds).toEqual(['a', 'b'])
  })

  it('sihirbazın listelemediği cihazdaki hoparlörler olduğu gibi korunur', () => {
    const ghost: Speaker = { ...sp('g', 1, 'center'), outputDeviceId: 'unplugged' }
    const candidates = candidateDevices(DEVICES, 'cable')
    const keep = outsideSpeakers([...flatPair, ghost], candidates)
    expect(keep.map((s) => s.id)).toEqual(['g'])
    const plan = planSpeakers([kit({ deviceId: 'spk', kind: 'pair' })], DEVICES)
    const r = buildSpeakers(plan, [...flatPair, ghost], [{ deviceId: 'unplugged', latencyMs: 7, bufferMs: 40 }], room, { keep })
    expect(r.speakers.map((s) => s.id)).toEqual(['a', 'b', 'g'])
    expect(r.speakers[2]).toBe(ghost)
    expect(r.outputs.find((o) => o.deviceId === 'unplugged')).toEqual({ deviceId: 'unplugged', latencyMs: 7, bufferMs: 40 })
  })
})

describe('mergeKits', () => {
  const candidates = candidateDevices(DEVICES, 'cable')
  it('ilk açılışta sonradan listelenen cihazlar tahminle gelir', () => {
    const kits = mergeKits([], candidates, false)
    expect(kits.map((k) => k.kind)).toEqual(['pair', 'none', 'none'])
  })
  it('kurulum varsa yeni cihaz kullanılmıyor başlar, listeden çıkan cihaz gizlenir', () => {
    const kits = mergeKits([kit({ deviceId: '2nd', kind: 'pair' }), kit({ deviceId: 'gone', kind: 'pair' })], candidates, true)
    expect(kits.map((k) => [k.deviceId, k.kind])).toEqual([
      ['2nd', 'pair'],
      ['spk', 'none'],
      ['hp', 'none'],
    ])
  })
})
