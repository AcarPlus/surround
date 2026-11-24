import { describe, expect, it } from 'vitest'
import { defaultProcessing, defaultUpmixOptions, type Device, type Speaker } from '../api/types'
import { checkHealth, findCable, type HealthInput } from './health'

const dev = (id: string, name: string, channels = 2): Device => ({
  id,
  name,
  kind: 'local',
  flow: 'render',
  channels,
  sampleRate: 48000,
  isDefault: false,
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

const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  devices: [dev('spk', 'Hoparlör'), dev('2nd', '2nd output'), dev('cable', 'CABLE Input', 8)],
  source: { deviceId: 'cable', mode: 'loopback' },
  speakers: [
    sp('FL', 'FL', { deviceChannel: 1 }),
    sp('FR', 'FR', { deviceChannel: 2 }),
    sp('BL', 'BL', { outputDeviceId: '2nd', deviceChannel: 1 }),
    sp('BR', 'BR', { outputDeviceId: '2nd', deviceChannel: 2 }),
  ],
  upmix: true,
  upmixOptions: defaultUpmixOptions(),
  processing: defaultProcessing(),
  running: false,
  status: [],
  lowLatency: false,
  calibrated: true,
  ...over,
})

const ids = (h: HealthInput) => checkHealth(h).map((i) => i.id)

describe('checkHealth', () => {
  it('sağlıklı 4.0 kurulumunda yalnızca LFE bilgisi', () => {
    expect(ids(base())).toEqual(['lfe-nowhere'])
  })

  it('hoparlör yoksa sihirbazı önerir', () => {
    const items = checkHealth(base({ speakers: [] }))
    expect(items).toHaveLength(1)
    expect(items[0].fix?.id).toBe('open-setup')
  })

  it('cihaz beklenirken eksik cihazları listeleyen uyarı', () => {
    expect(ids(base({ waiting: null }))).not.toContain('waiting-devices')
    const item = checkHealth(base({ waiting: { missing: ['Hoparlör (USB)', 'HDMI'] } })).find((i) => i.id === 'waiting-devices')!
    expect(item.level).toBe('warn')
    expect(item.title).toBe('Cihaz bekleniyor: Hoparlör (USB), HDMI')
    expect(item.detail).toContain('kendiliğinden')
  })

  it('bağlı olmayan hoparlör (ör. kapalı Bluetooth) yalnız sakin bir uyarıdır, başlatmayı engellemez', () => {
    const h = base()
    h.speakers = h.speakers.map((s) => (s.id === 'BL' ? { ...s, outputDeviceId: 'beats' } : s))
    const items = checkHealth(h)
    const item = items.find((i) => i.id === 'dev-missing-BL')!
    expect(item.level).toBe('warn')
    expect(item.title).toBe('BL bağlı değil')
    expect(item.detail).toContain('kendiliğinden katılır')
    expect(items.some((i) => i.level === 'error')).toBe(false)
  })

  it('cihaz eksik değilse bekleme nedenini gösterir', () => {
    const item = checkHealth(base({ waiting: { missing: [], message: 'Ses akışı kesildi; motor yeniden başlatılacak.' } })).find(
      (i) => i.id === 'waiting-devices',
    )!
    expect(item.title).toBe('Motor yeniden başlatılmayı bekliyor')
    expect(item.detail).toContain('Ses akışı kesildi')
  })

  it('tek taraflı surround (yankı şikâyeti) uyarısı', () => {
    const h = base()
    h.speakers = h.speakers.filter((s) => s.id !== 'BL')
    const item = checkHealth(h).find((i) => i.id === 'surround-unbalanced')!
    expect(item.title).toContain('sol')
  })

  it('kanal çakışması, eksik cihaz ve geri besleme hataları', () => {
    const h = base()
    h.speakers = [
      ...h.speakers,
      sp('X', 'FC', { deviceChannel: 1 }),
      sp('Y', 'FC', { outputDeviceId: 'gone' }),
      sp('Z', 'FC', { outputDeviceId: 'cable', deviceChannel: 3 }),
    ]
    const r = ids(h)
    expect(r).toContain('clash-X')
    expect(r).toContain('dev-missing-Y')
    expect(r).toContain('feedback-Z')
    expect(checkHealth(h)[0].level).toBe('error')
  })

  it('bas kesilip alıcı yoksa ve kaynak sorunları', () => {
    const h = base({ source: { deviceId: 'spk', mode: 'loopback' } })
    h.speakers = h.speakers.map((s) => (s.id.startsWith('B') ? { ...s, highPassHz: 150 } : s))
    const r = ids(h)
    expect(r).toContain('bass-lost')
    expect(r).toContain('source-not-cable')
    h.devices = h.devices.map((d) => (d.id === 'cable' ? { ...d, channels: 2 } : d))
    h.source = { deviceId: 'cable', mode: 'loopback' }
    expect(ids(h)).toContain('cable-2ch')
  })

  it('çalışırken kesinti ve kalibrasyon önerisi', () => {
    const r = ids(
      base({
        running: true,
        calibrated: false,
        status: [{ deviceId: '2nd', fillMs: 1, corrPpm: 0, underruns: 9, overruns: 0 }],
      }),
    )
    expect(r).toContain('underrun-2nd')
    expect(r).toContain('not-calibrated')
  })
})

describe('findCable', () => {
  const renamed = [
    dev('c2', 'Surround Çıkış (VB-Audio Virtual Cable)', 2),
    dev('c8', 'Surround Giriş (VB-Audio Virtual Cable)', 8),
    dev('spk', 'Hoparlör (Realtek)'),
  ]
  it('yeniden adlandırılmış uç noktalarda en çok kanallıyı seçer', () => {
    expect(findCable(renamed)?.id).toBe('c8')
    expect(findCable([...renamed].reverse())?.id).toBe('c8')
  })
  it('varsayılan adlarda da çalışır; 16ch varsa en çok kanallı olan', () => {
    const d = [dev('a', 'CABLE Input (VB-Audio Virtual Cable)', 8), dev('b', 'CABLE In 16ch (VB-Audio Virtual Cable)', 16)]
    expect(findCable(d)?.id).toBe('b')
    expect(findCable([d[0]])?.id).toBe('a')
  })
  it('Voicemeeter, kayıt cihazı ve ilgisiz cihazları atlar; yoksa undefined', () => {
    const vm = dev('vm', 'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)', 8)
    const cap: Device = { ...dev('cap', 'CABLE Output (VB-Audio Virtual Cable)', 8), flow: 'capture' }
    expect(findCable([vm, cap, dev('spk', 'Hoparlör')])).toBeUndefined()
  })
  it('sihirbazın cableOk kontrolü doğru uç noktaya bakar', () => {
    const c = findCable(renamed)!
    expect(c.channels >= 6).toBe(true)
  })
})

describe('sistem kontrolü, yeniden adlandırılmış kablo', () => {
  const devices = [
    dev('spk', 'Hoparlör'),
    dev('c2', 'Surround Çıkış (VB-Audio Virtual Cable)', 2),
    dev('c8', 'Surround Giriş (VB-Audio Virtual Cable)', 8),
  ]
  it('kaynak 8 kanallı uç noktaysa uyarı yok', () => {
    const r = checkHealth(base({ devices, source: { deviceId: 'c8', mode: 'loopback' } })).map((i) => i.id)
    expect(r).not.toContain('source-not-cable')
    expect(r).not.toContain('cable-2ch')
  })
  it('kaynak 2 kanallı uç noktaysa 8 kanallıya geçirmeyi önerir', () => {
    const r = checkHealth(base({ devices, source: { deviceId: 'c2', mode: 'loopback' } }))
    expect(r.map((i) => i.id)).toContain('source-not-cable')
  })
})
