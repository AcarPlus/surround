import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { useStore } from './useStore'

const st = () => useStore.getState()

beforeAll(async () => {
  await st().init()
})

afterEach(() => {
  vi.restoreAllMocks()
  useStore.setState({ runState: 'stopped', status: [], engine: null, waitingFor: [], waitMessage: null })
})

describe('engineState', () => {
  it('waiting: eksik cihazlar saklanır, durum ve motor bilgisi sıfırlanır', () => {
    useStore.setState({
      runState: 'running',
      status: [{ deviceId: 'd', fillMs: 40, corrPpm: 0, underruns: 0, overruns: 0 }],
      engine: { upmix: 'stereo', sourceChannels: 2, sourceRate: 48000, upmixLatencyMs: 0 },
    })
    st().setEngineState({ state: 'waiting', missing: ['Hoparlör (USB)'] })
    expect(st().runState).toBe('waiting')
    expect(st().waitingFor).toEqual(['Hoparlör (USB)'])
    expect(st().waitMessage).toBeNull()
    expect(st().status).toEqual([])
    expect(st().engine).toBeNull()

    st().setEngineState({ state: 'waiting', missing: [], message: 'Ses akışı kesildi.' })
    expect(st().waitingFor).toEqual([])
    expect(st().waitMessage).toBe('Ses akışı kesildi.')
  })

  it('cihaz dönünce running, beklemeyi temizler', () => {
    st().setEngineState({ state: 'waiting', missing: ['HDMI'] })
    st().setEngineState({ state: 'running', missing: [] })
    expect(st().runState).toBe('running')
    expect(st().waitingFor).toEqual([])
  })

  it('stopped durdurur; başlatılırken gelen stopped yok sayılır', () => {
    useStore.setState({ runState: 'starting' })
    st().setEngineState({ state: 'stopped', missing: [] })
    expect(st().runState).toBe('starting')
    useStore.setState({ runState: 'waiting', waitingFor: ['HDMI'] })
    st().setEngineState({ state: 'stopped', missing: [] })
    expect(st().runState).toBe('stopped')
    expect(st().waitingFor).toEqual([])
  })

  it('cihaz beklerken Durdur motoru durdurur ve beklemeyi bitirir', async () => {
    const stop = vi.spyOn(api, 'stop').mockResolvedValue()
    const start = vi.spyOn(api, 'start').mockResolvedValue()
    useStore.setState({ runState: 'waiting', waitingFor: ['HDMI'], waitMessage: 'x' })
    await st().toggleRun()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
    expect(st().runState).toBe('stopped')
    expect(st().waitingFor).toEqual([])
    expect(st().waitMessage).toBeNull()
  })

  it('init backend olayına abone olur (sahte API başlat/durdur)', async () => {
    await api.start()
    expect(st().runState).toBe('running')
    await api.stop()
    expect(st().runState).toBe('stopped')
  })

  it('syncRunState beklemeyi bozmaz (beklerken durum listesi boştur)', async () => {
    vi.spyOn(api, 'getStatus').mockResolvedValueOnce([])
    useStore.setState({ runState: 'waiting', waitingFor: ['HDMI'] })
    await st().syncRunState()
    expect(st().runState).toBe('waiting')
  })
})
