import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { DRAG_SAVE_MS, useStore } from './useStore'

const st = () => useStore.getState()

beforeAll(async () => {
  await st().init()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sürüklerken kayıt', () => {
  it('sürükleme boyunca kayıt seyrek ama düzenli gider, son konum mutlaka kaydedilir', async () => {
    await st().flushSave()
    vi.useFakeTimers()
    const spy = vi.spyOn(api, 'saveConfig').mockResolvedValue()
    const sp = st().speakers[0]
    const room = st().room
    // 60 Hz'lik 1 sn'lik sürükleme (60 pointermove).
    const steps = 60
    for (let i = 1; i <= steps; i++) {
      st().moveSpeaker(sp.id, sp.x + ((room.widthM / 4) * i) / steps, sp.y)
      vi.advanceTimersByTime(1000 / 60)
    }
    const during = spy.mock.calls.length
    // Debounce olsaydı sürükleme bitene kadar hiç kayıt gitmezdi; her harekette gitseydi 60 olurdu.
    expect(during).toBeGreaterThanOrEqual(Math.floor(1000 / DRAG_SAVE_MS) - 2)
    expect(during).toBeLessThanOrEqual(Math.ceil(1000 / DRAG_SAVE_MS) + 1)

    vi.advanceTimersByTime(DRAG_SAVE_MS + 1)
    const last = spy.mock.calls.at(-1)![0]
    const saved = last.speakers.find((s) => s.id === sp.id)!
    expect(saved.x).toBe(st().speakers.find((s) => s.id === sp.id)!.x)
    // Bıraktıktan sonra başka kayıt yok.
    const n = spy.mock.calls.length
    vi.advanceTimersByTime(2000)
    expect(spy.mock.calls.length).toBe(n)
  })

  it('tek seferlik değişiklik eski gibi beklenir (debounce), sürükleme kaydı onu ertelemez', async () => {
    await st().flushSave()
    vi.useFakeTimers()
    const spy = vi.spyOn(api, 'saveConfig').mockResolvedValue()
    st().setRoomSize(st().room.widthM + 0.1, st().room.depthM)
    const sp = st().speakers[0]
    st().moveSpeaker(sp.id, sp.x + 0.05, sp.y)
    vi.advanceTimersByTime(DRAG_SAVE_MS + 1)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
