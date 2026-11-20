import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { Device, Speaker } from '../api/types'
import { checkConfig, isContinuousLabel, useStore } from './useStore'

const st = () => useStore.getState()

const dev = (id: string, channels = 2): Device => ({
  id,
  name: `Çıkış ${id}`,
  kind: 'local',
  flow: 'render',
  channels,
  sampleRate: 48000,
  isDefault: false,
})
const spk = (id: string, deviceId: string, ch: number): Speaker => ({
  id,
  name: id,
  outputDeviceId: deviceId,
  deviceChannel: ch,
  source: { FL: 1 },
  delayMs: 0,
  gainDb: 0,
  mute: false,
  x: 1,
  y: 1,
})

let initial: ReturnType<typeof st>

beforeAll(async () => {
  await st().init()
  initial = st()
})

beforeEach(() => {
  useStore.setState({
    devices: initial.devices,
    speakers: initial.speakers,
    outputs: initial.outputs,
    auto: initial.auto,
    source: initial.source,
    past: [],
    future: [],
    selection: null,
    screen: 'home',
    toast: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('geri al birleştirme', () => {
  it('yalnızca sürekli eylemler birleşir', () => {
    expect(isContinuousLabel('Taşı:spk-1')).toBe(true)
    expect(isContinuousLabel('Hoparlör ayarı:spk-1:gainDb')).toBe(true)
    expect(isContinuousLabel('Oda boyutu')).toBe(true)
    expect(isContinuousLabel('Hoparlör ekle')).toBe(false)
    expect(isContinuousLabel('Kopyala')).toBe(false)
    expect(isContinuousLabel('Otomatik:spk-1')).toBe(false)
    expect(isContinuousLabel('Profil sil')).toBe(false)
  })

  it('art arda iki "Hoparlör ekle" iki ayrı adımdır', () => {
    st().addSpeaker('center')
    st().addSpeaker('sub')
    expect(st().past).toHaveLength(2)
  })

  it('otomatik bayrağı değişiklikleri ayrı adımdır', () => {
    const [a, b] = st().speakers
    st().setAuto(a.id, { delay: false })
    st().setAuto(b.id, { delay: false })
    st().setAuto(a.id, { gain: false })
    expect(st().past).toHaveLength(3)
    expect(st().past[0].label).toBe('Otomatik')
  })
})

describe('kopyala ve düzen şablonu boş kanal seçer', () => {
  it('kopya aynı cihaz + kanala düşmez', () => {
    useStore.setState({ devices: [dev('x', 4)], speakers: [spk('a', 'x', 1), spk('b', 'x', 2)], source: { deviceId: '', mode: 'loopback' } })
    st().duplicateSpeaker('a')
    const copy = st().speakers[2]
    expect(copy).toMatchObject({ outputDeviceId: 'x', deviceChannel: 3 })
    expect(st().toast).toBeNull()
  })

  it('boş kanal yoksa yine kopyalar ama uyarır', () => {
    useStore.setState({ devices: [dev('x', 2)], speakers: [spk('a', 'x', 1), spk('b', 'x', 2)], source: { deviceId: '', mode: 'loopback' } })
    st().duplicateSpeaker('a')
    expect(st().speakers).toHaveLength(3)
    expect(st().toast?.message).toMatch(/Boş kanal/)
  })

  it('düzen şablonu kanallar yetmezse uyarır, yetiyorsa çakıştırmaz', () => {
    useStore.setState({ devices: [dev('x', 2), dev('y', 2)], speakers: [], source: { deviceId: '', mode: 'loopback' } })
    st().applyLayout({ floor: 4, sub: 0, height: 0 })
    const keys = st().speakers.map((s) => `${s.outputDeviceId}#${s.deviceChannel}`)
    expect(new Set(keys).size).toBe(4)
    expect(st().toast?.message ?? '').not.toMatch(/Boş kanal/)
    st().applyLayout({ floor: 5, sub: 1, height: 0 })
    expect(st().toast?.message).toMatch(/Boş kanal/)
  })
})

describe('seçim', () => {
  it('Oda (ana ekran) dışına geçince ve sihirbaz kapanınca seçim temizlenir', () => {
    st().setScreen('home')
    st().select(st().speakers[0].id)
    st().setScreen('home')
    expect(st().selection).not.toBeNull()
    st().setScreen('sound')
    expect(st().selection).toBeNull()
    st().setScreen('home')
    st().select(st().speakers[0].id)
    st().openWizard()
    st().closeWizard()
    expect(st().selection).toBeNull()
  })
})

describe('yedek doğrulama', () => {
  const good = () => JSON.parse(JSON.stringify(st().exportConfig()))

  it('geçerli yedek kabul edilir', () => {
    expect(typeof checkConfig(good())).toBe('object')
  })

  it('bozuk dinleyici, hoparlör ve çıkış kayıtlarını reddeder', () => {
    const a = good()
    a.room.listener = { x: 'a', y: 1 }
    expect(checkConfig(a)).toMatch(/dinleyici/)
    const b = good()
    delete b.speakers[1].x
    expect(checkConfig(b)).toMatch(/2\. hoparlör/)
    const c = good()
    c.speakers[0] = null
    expect(checkConfig(c)).toMatch(/1\. hoparlör/)
    const d = good()
    d.outputs[0].latencyMs = '5'
    expect(checkConfig(d)).toMatch(/çıkış/)
    const e = good()
    e.speakers[1].id = e.speakers[0].id
    expect(checkConfig(e)).toMatch(/tekrarlanıyor/)
  })

  it('importConfig beklenmedik hatada Türkçe metin döner, durumu değiştirmez', () => {
    const n = st().speakers.length
    const evil = {
      get speakers(): unknown {
        throw new Error('bozuk')
      },
    }
    expect(st().importConfig(evil)).toMatch(/^Yedek yüklenemedi/)
    expect(st().speakers).toHaveLength(n)
    expect(st().past).toHaveLength(0)
  })
})

describe('sırayla çal', () => {
  it('ikinci çağrı yeni tur başlatmaz, çalan turu durdurur', async () => {
    vi.useFakeTimers()
    const tone = vi.spyOn(api, 'playTone').mockResolvedValue()
    const first = st().playTour()
    await vi.advanceTimersByTimeAsync(0)
    expect(st().playing).toBe(st().speakers.find((s) => !s.mute)!.id)
    await st().playTour()
    expect(st().playing).toBeNull()
    await vi.runAllTimersAsync()
    await first
    expect(tone).toHaveBeenCalledTimes(1)
    expect(st().playing).toBeNull()
    // Durduktan sonra yeni tur yeniden başlar.
    const again = st().playTour()
    await vi.advanceTimersByTimeAsync(0)
    expect(st().playing).not.toBeNull()
    st().stopTour()
    await vi.runAllTimersAsync()
    await again
    expect(st().playing).toBeNull()
  })
})

describe('kalibrasyon yardımcıları', () => {
  it('flushSave bekleyen kaydı hemen yazar', async () => {
    const save = vi.spyOn(api, 'saveConfig').mockResolvedValue()
    st().setUpmix(!st().upmix)
    await st().flushSave()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].upmix).toBe(st().upmix)
    st().undo()
  })

  it('syncRunState motor durumunu yeniden okur', async () => {
    vi.spyOn(api, 'getStatus').mockResolvedValueOnce([])
    useStore.setState({ runState: 'running' })
    await st().syncRunState()
    expect(st().runState).toBe('stopped')
    vi.spyOn(api, 'getStatus').mockResolvedValueOnce([
      { deviceId: 'd', state: 'running', bufferedMs: 40, underruns: 0, overruns: 0 } as never,
    ])
    await st().syncRunState()
    expect(st().runState).toBe('running')
    useStore.setState({ runState: 'stopped', status: [] })
  })
})
