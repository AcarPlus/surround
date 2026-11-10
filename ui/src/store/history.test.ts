import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { buildSpeakers, planSpeakers } from '../lib/setup'

const st = () => useStore.getState()

beforeAll(async () => {
  await st().init()
})

beforeEach(() => {
  useStore.setState({ past: [], future: [] })
})

describe('geri al / yinele', () => {
  it('silinen hoparlör geri gelir, yinele tekrar siler', () => {
    const before = st().speakers.length
    const id = st().speakers[0].id
    st().removeSpeaker(id)
    expect(st().speakers).toHaveLength(before - 1)
    expect(st().past.at(-1)?.label).toMatch(/^Sil/)
    st().undo()
    expect(st().speakers).toHaveLength(before)
    expect(st().speakers.some((s) => s.id === id)).toBe(true)
    st().redo()
    expect(st().speakers).toHaveLength(before - 1)
    st().undo()
  })

  it('art arda sürükleme tek adım sayılır', () => {
    const s = st().speakers[0]
    st().moveSpeaker(s.id, s.x + 0.1, s.y)
    st().moveSpeaker(s.id, s.x + 0.2, s.y)
    st().moveSpeaker(s.id, s.x + 0.3, s.y)
    expect(st().past).toHaveLength(1)
    st().undo()
    expect(st().speakers[0].x).toBe(s.x)
  })

  it('yeni değişiklik yinele yığınını temizler', () => {
    st().setUpmix(!st().upmix)
    st().undo()
    expect(st().future).toHaveLength(1)
    st().setRoomSize(st().room.widthM + 1, st().room.depthM)
    expect(st().future).toHaveLength(0)
    st().undo()
  })
})

describe('sihirbaz, kalibrasyon ve yedek', () => {
  it('sihirbaz sonucu tek adımda uygulanır ve kullanılmayan çıkışlar kaydedilmez', () => {
    const devices = st().devices
    const dev = devices.find((d) => d.flow === 'render' && d.channels === 2)!
    const plan = planSpeakers(
      [{ deviceId: dev.id, kind: 'pair21', place: 'front', pairType: 'flat', swap: false, role: 'center', roles: [] }],
      devices,
    )
    st().applySetup(buildSpeakers(plan, st().speakers, st().outputs, st().room))
    expect(st().speakers.map((s) => s.role)).toEqual(['left', 'right'])
    expect(st().setupDone).toBe(true)
    expect(st().past).toHaveLength(1)
    expect(st().exportConfig().outputs.map((o) => o.deviceId)).toEqual([dev.id])
    st().undo()
    expect(st().speakers.length).toBeGreaterThan(2)
  })

  it('kalibrasyon değerleri yazar ve otomatiği kapatır', () => {
    const [a, b] = st().speakers
    st().applyCalibration({ [a.id]: { delayMs: 3.25, gainDb: -2, calibratedAt: 'T' }, [b.id]: { delayMs: 0, calibratedAt: 'T' } }, 'mic', 'T')
    const a2 = st().speakers.find((s) => s.id === a.id)!
    expect(a2).toMatchObject({ delayMs: 3.25, gainDb: -2, calibratedAt: 'T' })
    expect(st().auto[a.id]).toEqual({ delay: false, gain: false })
    expect(st().auto[b.id].delay).toBe(false)
    expect(st().lastCalibration).toEqual({ at: 'T', micDeviceId: 'mic', speakers: 2 })
    st().undo()
    expect(st().speakers.find((s) => s.id === a.id)!.calibratedAt).toBeUndefined()
    expect(st().lastCalibration).toBeNull()
  })

  it('yedek dışa aktarılır, geçersiz dosya reddedilir, geçerli yedek geri yüklenir', () => {
    const doc = JSON.parse(JSON.stringify(st().exportConfig()))
    expect(st().importConfig({ foo: 1 })).toMatch(/değil/)
    const n = st().speakers.length
    st().removeSpeaker(st().speakers[0].id)
    expect(st().importConfig(doc)).toBeNull()
    expect(st().speakers).toHaveLength(n)
  })
})
