import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { defaultProcessing, defaultUpmixOptions } from '../api/types'
import { selectProfileModified, useStore } from './useStore'

const st = () => useStore.getState()

beforeAll(async () => {
  await st().init()
})

beforeEach(() => {
  // Her test: kullanıcı profili yok, ayarlar varsayılan.
  useStore.setState({
    profiles: st().profiles.filter((p) => p.builtin),
    activeProfileId: null,
    processing: defaultProcessing(),
    upmix: false,
    upmixOptions: defaultUpmixOptions(),
  })
})

describe('profil mağazası', () => {
  it('yerleşik profiller yüklenir', () => {
    expect(st().profiles.map((p) => p.name)).toEqual(['Film', 'Oyun', 'Müzik', 'Flat'])
    expect(st().activeProfileId).toBeNull()
  })

  it('profil seçmek işleme + upmix + ayrıntıları tek seferde uygular', () => {
    st().selectProfile('builtin-game')
    expect(st().activeProfileId).toBe('builtin-game')
    expect(st().upmix).toBe(true)
    expect(st().upmixOptions.mode).toBe('game')
    expect(st().processing.dynamicBoost).toBe(0.15)
    expect(selectProfileModified(st())).toBe(false)
  })

  it('sonradan ayar değişince değişmiş görünür; güncelleyince temizlenir', () => {
    st().selectProfile('builtin-film')
    st().setUpmixOptions({ surroundDb: -2 })
    expect(selectProfileModified(st())).toBe(true)
    st().updateActiveProfile()
    expect(selectProfileModified(st())).toBe(false)
    expect(st().profiles.find((p) => p.id === 'builtin-film')!.upmixOptions.surroundDb).toBe(-2)
    st().setProcessing({ bassBoostDb: 1 })
    expect(selectProfileModified(st())).toBe(true)
  })

  it('yerleşik varsayılana döner; etkinse uygulanır', () => {
    st().selectProfile('builtin-film')
    st().setUpmixOptions({ centerDb: -4 })
    st().updateActiveProfile()
    st().resetBuiltinProfile('builtin-film')
    expect(st().upmixOptions.centerDb).toBe(1)
    expect(selectProfileModified(st())).toBe(false)
  })

  it('mevcut ayarlar profil olarak kaydedilir, yeniden adlandırılır, silinir', () => {
    st().setUpmix(true)
    st().setProcessing({ preampDb: -7 })
    expect(st().saveCurrentAsProfile('   ')).toBe(false)
    expect(st().saveCurrentAsProfile('Gece')).toBe(true)
    const p = st().profiles.find((v) => v.name === 'Gece')!
    expect(p.builtin).toBe(false)
    expect(p.processing.preampDb).toBe(-7)
    expect(st().activeProfileId).toBe(p.id)
    expect(selectProfileModified(st())).toBe(false)

    st().renameProfile(p.id, 'Gece 2')
    expect(st().profiles.find((v) => v.id === p.id)!.name).toBe('Gece 2')
    st().renameProfile('builtin-film', 'X')
    expect(st().profiles[0].name).toBe('Film')

    st().deleteProfile('builtin-film')
    expect(st().profiles.some((v) => v.id === 'builtin-film')).toBe(true)
    st().deleteProfile(p.id)
    expect(st().profiles.some((v) => v.id === p.id)).toBe(false)
    expect(st().activeProfileId).toBeNull()
  })

  it('profiller ve etkin kimlik config kökünde kaydedilir', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(api, 'saveConfig')
    st().selectProfile('builtin-music')
    await vi.advanceTimersByTimeAsync(500)
    const cfg = spy.mock.calls.at(-1)![0]
    expect(cfg.activeProfileId).toBe('builtin-music')
    expect(cfg.profiles).toHaveLength(4)
    expect(cfg.upmixOptions).toMatchObject({ mode: 'direct' })
    spy.mockRestore()
    vi.useRealTimers()
  })
})
