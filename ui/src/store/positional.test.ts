import { beforeAll, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { useStore } from './useStore'

const st = () => useStore.getState()

beforeAll(async () => {
  await st().init()
})

describe('konuma göre dağıt (mağaza)', () => {
  it('açıkken motora konum satırı gider, rol satırı roleSource\'ta saklanır; açılışta geri gelir', async () => {
    const spy = vi.spyOn(api, 'saveConfig')
    const before = st().speakers.map((s) => ({ id: s.id, source: s.source }))
    st().setPositionalMix(true)
    await st().flushSave()
    const cfg = spy.mock.calls.at(-1)![0]
    expect(cfg.positionalMix).toBe(true)
    for (const sp of cfg.speakers) {
      const orig = before.find((b) => b.id === sp.id)!
      if (sp.roleSource) expect(sp.roleSource).toEqual(orig.source)
    }
    expect(cfg.speakers.some((sp) => sp.roleSource)).toBe(true)
    // Mağazadaki rol satırları değişmez.
    expect(st().speakers.map((s) => ({ id: s.id, source: s.source }))).toEqual(before)

    // Yeniden açılış: kaydedilen config'ten rol satırları geri alınır.
    vi.spyOn(api, 'getConfig').mockResolvedValueOnce(cfg)
    await st().loadAll()
    expect(st().positionalMix).toBe(true)
    expect(st().speakers.map((s) => ({ id: s.id, source: s.source }))).toEqual(before)

    st().setPositionalMix(false)
    await st().flushSave()
    const off = spy.mock.calls.at(-1)![0]
    expect(off.positionalMix).toBeUndefined()
    expect(off.speakers.every((sp) => !sp.roleSource)).toBe(true)
    spy.mockRestore()
  })
})
