import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { defaultProcessing, type Config } from '../api/types'
import { soundPresetPatch, userPresetKey } from '../lib/presets'
import { useStore } from './useStore'

const st = () => useStore.getState()

beforeAll(async () => {
  await st().init()
})

beforeEach(() => {
  useStore.setState({
    processing: defaultProcessing(),
    userSoundPresets: [],
    userSpeakerPresets: [],
    abBypass: false,
    past: [],
    future: [],
  })
})

afterEach(() => vi.restoreAllMocks())

describe('kullanıcı ses ön ayarları', () => {
  it('kaydet, uygula, üzerine yaz, yeniden adlandır, sil', () => {
    const { preset: _label, ...film } = soundPresetPatch('film')!
    st().setProcessing({ ...film, bassBoostDb: 1.5 })
    expect(st().processing.preset).toBe('custom')
    expect(st().saveUserSoundPreset('   ')).toBe(false)
    expect(st().saveUserSoundPreset('Gece filmi')).toBe(true)
    const u = st().userSoundPresets[0]
    expect(u.name).toBe('Gece filmi')
    expect(st().processing.preset).toBe(userPresetKey(u.id))

    // Değer değişince Özel olur; ön ayarı tekrar uygulamak değerleri geri getirir.
    st().setProcessing({ bassBoostDb: 4 })
    expect(st().processing.preset).toBe('custom')
    st().applyUserSoundPreset(u.id)
    expect(st().processing.bassBoostDb).toBe(1.5)
    expect(st().processing.preset).toBe(userPresetKey(u.id))

    st().setProcessing({ bassBoostDb: 2.5 })
    st().overwriteUserSoundPreset(u.id)
    expect(st().userSoundPresets[0].bassBoostDb).toBe(2.5)
    expect(st().userSoundPresets[0].name).toBe('Gece filmi')
    expect(st().processing.preset).toBe(userPresetKey(u.id))

    st().renameUserSoundPreset(u.id, '  Yeni   ad ')
    expect(st().userSoundPresets[0].name).toBe('Yeni ad')

    st().deleteUserSoundPreset(u.id)
    expect(st().userSoundPresets).toHaveLength(0)
    expect(st().processing.preset).toBe('custom')
    // Silme geri alınabilir.
    st().undo()
    expect(st().userSoundPresets).toHaveLength(1)
  })

  it('en fazla 20 ön ayar', () => {
    for (let i = 0; i < 20; i++) expect(st().saveUserSoundPreset(`Ön ayar ${i}`)).toBe(true)
    expect(st().saveUserSoundPreset('Fazla')).toBe(false)
  })

  it('config kökünde saklanır, yedekte dışa/içe aktarılır, yeniden yüklenince korunur', async () => {
    st().setProcessing({ bassBoostDb: 3, peq: [{ id: 'a', type: 'peak', freqHz: 700, gainDb: 2, q: 1 }] })
    st().saveUserSoundPreset('Bir')
    const sp = st().speakers[0]
    st().updateSpeaker(sp.id, { eq: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] })
    expect(st().saveUserSpeakerPreset(sp.id, 'Uydu A')).toBe(true)
    expect(st().speakers[0].eqPreset).toBe(userPresetKey(st().userSpeakerPresets[0].id))

    const cfg = st().exportConfig()
    expect(cfg.userSoundPresets).toHaveLength(1)
    expect(cfg.userSoundPresets![0].peq).toHaveLength(1)
    expect(cfg.userSpeakerPresets).toHaveLength(1)

    // Yedekten geri yükleme (JSON gidiş-dönüşü).
    const raw = JSON.parse(JSON.stringify(cfg)) as Config
    useStore.setState({ userSoundPresets: [], userSpeakerPresets: [] })
    expect(st().importConfig(raw)).toBeNull()
    expect(st().userSoundPresets.map((u) => u.name)).toEqual(['Bir'])
    expect(st().userSpeakerPresets.map((u) => u.name)).toEqual(['Uydu A'])

    // Açılışta yeniden okunur.
    await api.saveConfig(raw)
    useStore.setState({ userSoundPresets: [], userSpeakerPresets: [] })
    await st().loadAll()
    expect(st().userSoundPresets).toHaveLength(1)
    expect(st().userSpeakerPresets).toHaveLength(1)
  })

  it('kullanıcı ön ayarı yoksa config kökünde alan yazılmaz', () => {
    const cfg = st().exportConfig()
    expect('userSoundPresets' in cfg).toBe(false)
    expect('userSpeakerPresets' in cfg).toBe(false)
    expect('abBypass' in cfg).toBe(false)
  })
})

describe('kullanıcı hoparlör ön ayarları', () => {
  it('kaydet, başka hoparlöre uygula (parametrik dahil), sil: etiket Özel olur', () => {
    const [a, b] = st().speakers
    st().updateSpeaker(a.id, { eq: [0, 0, 0, -2, 0, 0, 0, 0, 0, 0], peq: [{ id: 'p', type: 'highShelf', freqHz: 8000, gainDb: -3, q: 0.7 }] })
    expect(st().saveUserSpeakerPreset(a.id, 'Küçük uydu')).toBe(true)
    const u = st().userSpeakerPresets[0]
    st().applyUserSpeakerPreset(u.id, b.id)
    const nb = st().speakers.find((s) => s.id === b.id)!
    expect(nb.eq?.[3]).toBe(-2)
    expect(nb.peq).toHaveLength(1)
    expect(nb.eqPreset).toBe(userPresetKey(u.id))

    st().deleteUserSpeakerPreset(u.id)
    expect(st().speakers.find((s) => s.id === b.id)!.eqPreset).toBe('custom')
  })

  it('hoparlör parametrik bantları yüklemede doğrulanır', async () => {
    const cfg = JSON.parse(JSON.stringify(st().exportConfig())) as Config
    ;(cfg.speakers[0] as unknown as Record<string, unknown>).peq = [{ type: 'peak', freqHz: 9, gainDb: 50, q: 0 }]
    await api.saveConfig(cfg)
    await st().loadAll()
    expect(st().speakers[0].peq).toHaveLength(1)
    expect(st().speakers[0].peq![0]).toMatchObject({ freqHz: 20, gainDb: 12, q: 0.3 })
    expect(st().speakers[0].peq![0].id).toBeTruthy()
  })
})

describe('A/B (işlemesiz dinle)', () => {
  it('motora işleme kapalı gider, ayar ve geri alma geçmişi değişmez', () => {
    const save = vi.spyOn(api, 'saveConfig').mockResolvedValue()
    st().setProcessing({ bassBoostDb: 3 })
    const pastBefore = st().past.length
    save.mockClear()

    st().setAbBypass(true)
    expect(st().abBypass).toBe(true)
    expect(st().processing.enabled).toBe(true) // asıl ayar değişmedi
    expect(st().past).toHaveLength(pastBefore) // geçmişe yazılmadı
    expect(save).toHaveBeenCalledTimes(1)
    const sent = save.mock.calls[0][0]
    expect(sent.processing!.enabled).toBe(false)
    expect(sent.processing!.bassBoostDb).toBe(3)
    expect(sent.abBypass).toBe(true)

    st().setAbBypass(false)
    expect(st().past).toHaveLength(pastBefore)
    const back = save.mock.calls[1][0]
    expect(back.processing!.enabled).toBe(true)
    expect('abBypass' in back).toBe(false)
  })

  it('A/B açıkken başka bir kayıt işlemeyi kapalı bırakır', () => {
    const save = vi.spyOn(api, 'saveConfig').mockResolvedValue()
    st().setAbBypass(true)
    save.mockClear()
    expect(st().exportConfig().processing!.enabled).toBe(false)
    st().setAbBypass(false)
  })

  it('işleme zaten kapalıysa A/B açılmaz', () => {
    vi.spyOn(api, 'saveConfig').mockResolvedValue()
    st().setProcessing({ enabled: false })
    st().setAbBypass(true)
    expect(st().abBypass).toBe(false)
  })

  it('açılışta kalan A/B işareti işlemeyi geri açar', async () => {
    const cfg = JSON.parse(JSON.stringify(st().exportConfig())) as Config
    cfg.processing = { ...defaultProcessing(), enabled: false, bassBoostDb: 2 }
    cfg.abBypass = true
    await api.saveConfig(cfg)
    await st().loadAll()
    expect(st().processing.enabled).toBe(true)
    expect(st().processing.bassBoostDb).toBe(2)
    expect(st().abBypass).toBe(false)
  })
})

describe('otomatik ön kazanç ve parametrik bantlar config’te', () => {
  it('peq ve autoPreamp yazılır; eski config’te alan yoksa varsayılan', async () => {
    st().setProcessing({ autoPreamp: true, peq: [{ id: 'x', type: 'lowShelf', freqHz: 120, gainDb: 3, q: 0.7 }] })
    const cfg = st().exportConfig()
    expect(cfg.processing!.autoPreamp).toBe(true)
    expect(cfg.processing!.peq).toHaveLength(1)

    const old = JSON.parse(JSON.stringify(cfg)) as Config
    delete (old.processing as unknown as Record<string, unknown>).peq
    delete (old.processing as unknown as Record<string, unknown>).autoPreamp
    await api.saveConfig(old)
    await st().loadAll()
    expect(st().processing.autoPreamp).toBe(false)
    expect(st().processing.peq).toEqual([])
  })
})
