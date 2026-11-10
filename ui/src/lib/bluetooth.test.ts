import { describe, expect, it } from 'vitest'
import { defaultProcessing, defaultUpmixOptions, isHighLatencyKind, type Device, type Room, type Speaker } from '../api/types'
import { checkHealth, type HealthInput } from './health'
import { buildSpeakers, planSpeakers, type DeviceKit } from './setup'

const dev = (id: string, name: string, kind: Device['kind'] = 'local', extra: Partial<Device> = {}): Device => ({
  id,
  name,
  kind,
  flow: 'render',
  channels: 2,
  sampleRate: 48000,
  isDefault: false,
  ...extra,
})
const sp = (id: string, ch: keyof Speaker['source'], extra: Partial<Speaker> = {}): Speaker => ({
  id,
  name: id,
  outputDeviceId: 'spk',
  deviceChannel: 1,
  source: { [ch]: 1 },
  delayMs: 0,
  gainDb: 0,
  mute: false,
  x: 0,
  y: 0,
  ...extra,
})
const kit = (p: Partial<DeviceKit> & { deviceId: string }): DeviceKit => ({
  kind: 'none',
  place: 'front',
  pairType: 'flat',
  swap: false,
  role: 'center',
  roles: [],
  ...p,
})
const room: Room = { widthM: 4, depthM: 4, listener: { x: 2, y: 2 } }

describe('isHighLatencyKind', () => {
  it('ağ ve Bluetooth yüksek gecikmeli', () => {
    expect(isHighLatencyKind('network')).toBe(true)
    expect(isHighLatencyKind('bluetooth')).toBe(true)
    expect(isHighLatencyKind('local')).toBe(false)
    expect(isHighLatencyKind('multichannel')).toBe(false)
    expect(isHighLatencyKind(undefined)).toBe(false)
  })
})

describe('sistem kontrolü: Bluetooth', () => {
  const withBt = (calibrated: boolean, devOver: Partial<Device> = {}, over: Partial<HealthInput> = {}): HealthInput => ({
    devices: [
      dev('spk', 'Hoparlör'),
      dev('cable', 'CABLE Input', 'multichannel', { channels: 8 }),
      dev('bt', 'Pill (Bluetooth)', 'bluetooth', devOver),
    ],
    source: { deviceId: 'cable', mode: 'loopback' },
    speakers: [sp('FL', 'FL'), sp('FR', 'FR', { deviceChannel: 2 }), sp('BL', 'BL', { outputDeviceId: 'bt' })],
    upmix: true,
    upmixOptions: defaultUpmixOptions(),
    processing: defaultProcessing(),
    running: false,
    status: [],
    lowLatency: false,
    calibrated,
    ...over,
  })
  const ids = (h: HealthInput) => checkHealth(h).map((i) => i.id)

  it('kalibrasyon yoksa gecikme ölçülmeli bilgisi', () => {
    expect(ids(withBt(false))).toContain('bt-latency')
    expect(ids(withBt(true))).not.toContain('bt-latency')
  })
  it('Hands-Free uç noktası uyarı verir', () => {
    const items = checkHealth(withBt(true, { handsFree: true }))
    expect(items.find((i) => i.id === 'bt-hfp-bt')?.level).toBe('warn')
    expect(ids(withBt(true))).not.toContain('bt-hfp-bt')
  })
  it('düşük gecikme modunda Bluetooth devre dışı bildirilir', () => {
    expect(ids(withBt(true, {}, { lowLatency: true }))).toContain('lowlat-BL')
  })
})

describe('buildSpeakers: Bluetooth', () => {
  it('yeni Bluetooth çıkışı 150 ms tamponla açılır, diğerleri 40', () => {
    const devices = [dev('bt', 'Pill (Bluetooth)', 'bluetooth'), dev('spk', 'Hoparlör')]
    const plan = planSpeakers(
      [kit({ deviceId: 'bt', kind: 'single' }), kit({ deviceId: 'spk', kind: 'single', role: 'left' })],
      devices,
    )
    const r = buildSpeakers(plan, [], [], room, { devices })
    expect(r.outputs.find((o) => o.deviceId === 'bt')?.bufferMs).toBe(150)
    expect(r.outputs.find((o) => o.deviceId === 'spk')?.bufferMs).toBe(40)
  })
  it('mevcut Output kaydı korunur', () => {
    const devices = [dev('bt', 'Pill', 'bluetooth')]
    const plan = planSpeakers([kit({ deviceId: 'bt', kind: 'single' })], devices)
    const r = buildSpeakers(plan, [], [{ deviceId: 'bt', latencyMs: 0, bufferMs: 90 }], room, { devices })
    expect(r.outputs[0].bufferMs).toBe(90)
  })
})
