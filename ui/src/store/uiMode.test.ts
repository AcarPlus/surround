import { beforeAll, describe, expect, it } from 'vitest'
import { api } from '../api/client'
import { useStore } from './useStore'
import { buildSpeakers, planSpeakers } from '../lib/setup'

const st = () => useStore.getState()

beforeAll(async () => {
  await st().init()
})

describe('Basit / Gelişmiş kip', () => {
  it('eski config (uiMode yok) Basit açılır ve sihirbaz kendiliğinden açılmaz', () => {
    expect(st().uiMode).toBe('simple')
    expect(st().wizardOpen).toBe(false)
  })

  it('kip config dosyasına yazılır ve geri alma geçmişine girmez', async () => {
    const before = st().past.length
    expect(st().setUiMode('advanced')).toBe('advanced')
    expect(st().exportConfig().uiMode).toBe('advanced')
    expect(st().past.length).toBe(before)
    await new Promise((r) => setTimeout(r, 400))
    expect((await api.getConfig()).uiMode).toBe('advanced')
    // Gelişmiş'ten Basit'e dönünce ana sayfaya gidilir.
    st().setScreen('room')
    expect(st().setUiMode('simple')).toBe('simple')
    expect(st().screen).toBe('home')
    expect(st().exportConfig().uiMode).toBe('simple')
  })

  it('Kolay kurulum ve Ölçmeden başla pencereleri store bayraklarıyla açılıp kapanır', () => {
    expect(st().easySetupOpen).toBe(false)
    st().openEasySetup()
    expect(st().easySetupOpen).toBe(true)
    st().closeEasySetup()
    expect(st().easySetupOpen).toBe(false)
    st().openQuickStart()
    expect(st().quickStartOpen).toBe(true)
    st().closeQuickStart()
    expect(st().quickStartOpen).toBe(false)
  })

  it('applySetup autoForNew:false yeni hoparlörleri otomatik gecikme/kazançsız kurar', () => {
    const { devices, room } = st()
    const dev = devices.find((d) => d.flow === 'render' && d.channels === 2)!
    const plan = planSpeakers(
      [{ deviceId: dev.id, kind: 'pair', place: 'front', pairType: 'flat', swap: false, role: 'center', roles: [] }],
      devices,
    )
    const r = buildSpeakers(plan, [], [], room)
    st().applySetup(r, { autoForNew: false, silent: true })
    for (const s of r.speakers) expect(st().auto[s.id]).toEqual({ delay: false, gain: false })
    expect(st().setupDone).toBe(true)
  })

  describe('Kolay kurulum kontrol noktası', () => {
    const plan1 = () => {
      const { devices } = st()
      const dev = devices.find((d) => d.flow === 'render' && d.channels === 2 && d.id !== st().source.deviceId)!
      return buildSpeakers(
        planSpeakers([{ deviceId: dev.id, kind: 'pair', place: 'front', pairType: 'flat', swap: false, role: 'center', roles: [] }], devices),
        st().speakers,
        st().outputs,
        st().room,
      )
    }

    it('Vazgeç açılıştan beri yapılan değişiklikleri (hoparlör, kaynak, ölçüm) ve geçmişi geri alır', () => {
      const before = { speakers: st().speakers, source: st().source, past: st().past.length, cal: st().lastCalibration }
      st().openEasySetup()
      st().applySetup(plan1(), { autoForNew: false, silent: true })
      const other = st().devices.find((d) => d.flow === 'render' && d.id !== before.source.deviceId)!
      st().setSource({ mode: 'loopback', deviceId: other.id })
      st().applyCalibration({ [st().speakers[0].id]: { delayMs: 3 } }, 'mic', 'T', { silent: true })
      expect(st().speakers).not.toBe(before.speakers)
      st().cancelEasySetup()
      expect(st().easySetupOpen).toBe(false)
      expect(st().speakers).toEqual(before.speakers)
      expect(st().source).toBe(before.source)
      expect(st().lastCalibration).toBe(before.cal)
      expect(st().past.length).toBe(before.past)
    })

    it('Bitti (closeEasySetup) değişiklikleri korur; değişiklik yoksa Vazgeç bir şey yapmaz', () => {
      st().openEasySetup()
      const r = plan1()
      st().applySetup(r, { autoForNew: false, silent: true })
      st().closeEasySetup()
      expect(st().speakers.map((s) => s.id)).toEqual(r.speakers.map((s) => s.id))
      const past = st().past.length
      st().openEasySetup()
      st().cancelEasySetup()
      expect(st().past.length).toBe(past)
    })

    it('"Yeniden ölç" mikrofon adımından açılır (hoparlör varsa); Basit kipte kalibrasyon düzeltmesi de oraya gider', () => {
      expect(st().speakers.length).toBeGreaterThan(0)
      st().openEasySetup({ step: 'mic' })
      expect(st().easySetupStart).toBe('mic')
      st().closeEasySetup()
      expect(st().easySetupStart).toBeNull()
      st().fixHealth('open-calibration')
      expect(st().easySetupOpen).toBe(true)
      expect(st().easySetupStart).toBe('mic')
      st().closeEasySetup()
    })
  })
})
