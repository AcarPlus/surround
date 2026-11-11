import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { waitedLongEnough, WAIT_ACTION_MS } from '../lib/waiting'
import { useStore } from './useStore'

const st = () => useStore.getState()

afterEach(() => {
  vi.restoreAllMocks()
  useStore.setState({ initError: null, toast: null, runState: 'stopped', waitingFor: [], waitMessage: null, waitingSince: null })
})

describe('init hata kurtarma', () => {
  it('getConfig reddedilirse takılmaz: initError dolar, ready olmaz', async () => {
    useStore.setState({ ready: false })
    vi.spyOn(api, 'getConfig').mockRejectedValue(new Error('Object reference not set to an instance of an object.'))
    await st().init()
    expect(st().ready).toBe(false)
    expect(st().initError?.message).not.toMatch(/Object reference/)
    expect(st().initError?.detail).toMatch(/Object reference/)
  })

  it('eksik alanlı config de hata ekranına düşer (çökmez)', async () => {
    useStore.setState({ ready: false })
    vi.spyOn(api, 'getConfig').mockResolvedValue({ source: null, speakers: null } as never)
    await st().init()
    expect(st().initError).not.toBeNull()
    expect(st().ready).toBe(false)
  })

  it('Varsayılana dön: resetConfig çağrılır, yeniden yüklenir, hata temizlenir', async () => {
    useStore.setState({ initError: { message: 'x' }, ready: false })
    const reset = vi.spyOn(api, 'resetConfig').mockResolvedValue()
    await st().recoverWithDefaults()
    expect(reset).toHaveBeenCalledTimes(1)
    expect(st().initError).toBeNull()
    expect(st().ready).toBe(true)
  })

  it('Yedekten yükle: geçersiz yedek reddedilir, geçerli yedek kaydedilip yüklenir', async () => {
    useStore.setState({ initError: { message: 'x' }, ready: false })
    const save = vi.spyOn(api, 'saveConfig').mockResolvedValue()
    expect(await st().recoverFromBackup({ nonsense: true })).toEqual(expect.any(String))
    expect(save).not.toHaveBeenCalled()

    const good = st().exportConfig()
    expect(await st().recoverFromBackup(good)).toBeNull()
    expect(save).toHaveBeenCalledTimes(1)
    expect(st().initError).toBeNull()
    expect(st().ready).toBe(true)
  })

  it('bozuk dosya bildirimi tek seferlik uyarı olarak gösterilir', async () => {
    vi.spyOn(api, 'takeConfigNotice').mockResolvedValue({ backupPath: 'X\\config.bad-20260101-120000.json' })
    await st().init()
    expect(st().toast?.message).toContain('Ayar dosyası okunamadı')
    expect(st().toast?.message).toContain('config.bad-20260101-120000.json')
    expect(st().toast?.message).toContain('Varsayılan ayarlar yüklendi')
  })
})

describe('cihaz bekleme', () => {
  it('waitingSince bekleme başında bir kez konur, çalışınca temizlenir', () => {
    st().setEngineState({ state: 'waiting', missing: ['USB'] })
    const t = st().waitingSince
    expect(t).not.toBeNull()
    st().setEngineState({ state: 'waiting', missing: ['USB', 'HDMI'] })
    expect(st().waitingSince).toBe(t)
    st().setEngineState({ state: 'running', missing: [] })
    expect(st().waitingSince).toBeNull()
  })

  it('30 sn sonra eylemler önerilir', () => {
    expect(waitedLongEnough(null, 1e9)).toBe(false)
    expect(waitedLongEnough(1000, 1000 + WAIT_ACTION_MS - 1)).toBe(false)
    expect(waitedLongEnough(1000, 1000 + WAIT_ACTION_MS)).toBe(true)
  })

  it('Eksik cihaz olmadan başlat: köprü çağrılır, durum yenilenir; hata anlaşılır gösterilir', async () => {
    const swm = vi.spyOn(api, 'startWithoutMissing').mockResolvedValue()
    vi.spyOn(api, 'getEngineState').mockResolvedValue({ state: 'running', missing: [] })
    useStore.setState({ runState: 'waiting', waitingFor: ['USB'], waitingSince: 1 })
    await st().startWithoutMissing()
    expect(swm).toHaveBeenCalledTimes(1)
    expect(st().runState).toBe('running')
    expect(st().waitingSince).toBeNull()

    swm.mockRejectedValue(new Error('Eksik cihaz olmadan başlatılamıyor: kaynak cihaz yok.'))
    await st().startWithoutMissing()
    expect(st().toast?.tone).toBe('error')
  })

  it('showError: anlaşılır cümle + ayrıntı', () => {
    st().showError({ errors: ['outputs[1].bufferMs 10-500 aralığında olmalı.'] })
    expect(st().toast?.message).toContain('tampon süresi')
    expect(st().toast?.detail).toContain('outputs[1].bufferMs')
  })
})
