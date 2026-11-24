import { describe, expect, it } from 'vitest'
import { EQ_BANDS, defaultProcessing, defaultUpmixOptions, normalizeUpmixOptions } from '../api/types'
import {
  builtinProfile,
  builtinProfiles,
  cleanProfileName,
  isProfileModified,
  normalizeProfiles,
  profilePatch,
  snapshotState,
} from './profiles'

const stateOf = (id: string) => profilePatch(builtinProfile(id)!)

describe('yerleşik profiller', () => {
  it('Film, Oyun, Müzik, Flat; geçerli aralıklarda ve silinemez işaretli', () => {
    const ps = builtinProfiles()
    expect(ps.map((p) => p.name)).toEqual(['Film', 'Oyun', 'Müzik', 'Flat'])
    for (const p of ps) {
      expect(p.builtin).toBe(true)
      expect(p.processing.eq).toHaveLength(EQ_BANDS)
      expect(p.upmix).toBe(true)
      expect(normalizeUpmixOptions(p.upmixOptions)).toEqual(p.upmixOptions)
    }
  })

  it('Film: film modu, diyalog +1 dB, bas/tiz rafı, sabit −1 dB ön kazanç, hafif dinamik, genişletme yok', () => {
    const p = builtinProfile('builtin-film')!
    expect(p.upmixOptions).toMatchObject({ mode: 'film', centerDb: 1, diffusion: 0.6 })
    expect(p.processing).toMatchObject({ enabled: true, autoPreamp: false, preampDb: -1, dynamicBoost: 0.15, ambience: 0, limiter: true })
    expect(p.processing.peq.map(({ type, freqHz, gainDb }) => ({ type, freqHz, gainDb }))).toEqual([
      { type: 'lowShelf', freqHz: 120, gainDb: 3.5 },
      { type: 'highShelf', freqHz: 5000, gainDb: 2.5 },
    ])
    expect(p.processing.eq.every((v) => v === 0)).toBe(true)
  })

  it('Oyun: oyun modu (gecikmesiz), tiz ağırlıklı raf, hafif dinamik', () => {
    const p = builtinProfile('builtin-game')!
    expect(p.upmixOptions.mode).toBe('game')
    expect(p.processing).toMatchObject({ autoPreamp: false, preampDb: -1, dynamicBoost: 0.15, ambience: 0 })
    expect(p.processing.peq.map((b) => b.gainDb)).toEqual([2.5, 3])
  })

  it('Film ve Oyun Düz/Müzik ile aynı güvenlik: limiter açık, ön kazanç rafların altında', () => {
    for (const id of ['builtin-film', 'builtin-game']) {
      const p = builtinProfile(id)!.processing
      expect(p.limiter).toBe(true)
      expect(Math.max(...p.peq.map((b) => b.gainDb)) + p.preampDb).toBeLessThanOrEqual(3)
      // Kimlikler sabit: her çağrıda aynı config yazılır.
      expect(p.peq.map((b) => b.id)).toEqual(builtinProfile(id)!.processing.peq.map((b) => b.id))
    }
  })

  it('Müzik: doğrudan dağıtım (Flat yönlendirmesi) + biraz sıcaklık ve parlaklık', () => {
    const p = builtinProfile('builtin-music')!
    expect(p.upmixOptions.mode).toBe('direct')
    expect(p.processing).toMatchObject({ enabled: true, bassBoostDb: 1.5, clarityDb: 1, dynamicBoost: 0, ambience: 0 })
  })

  it('eski sürüm kayıtlı yerleşik kopya yeni tanımla değişir; güncel sürüm korunur', () => {
    const old = { ...builtinProfile('builtin-game')!, rev: 2, processing: { ...builtinProfile('builtin-game')!.processing, clarityDb: 4 } }
    expect(normalizeProfiles([old]).find((p) => p.id === 'builtin-game')!.processing.clarityDb).toBe(0)
    const mine = { ...builtinProfile('builtin-game')!, processing: { ...builtinProfile('builtin-game')!.processing, clarityDb: 3 } }
    expect(normalizeProfiles([mine]).find((p) => p.id === 'builtin-game')!.processing.clarityDb).toBe(3)
  })

  it('her çağrıda bağımsız kopya döner', () => {
    builtinProfiles()[0].processing.eq[0] = 99
    expect(builtinProfiles()[0].processing.eq[0]).not.toBe(99)
  })
})

describe('değişiklik algılama', () => {
  it('uygulanmış profil değişmemiş sayılır', () => {
    for (const p of builtinProfiles()) expect(isProfileModified(p, profilePatch(p))).toBe(false)
  })

  it('ses işleme, upmix anahtarı ve upmix alanları sapınca değişmiş sayılır', () => {
    const p = builtinProfile('builtin-film')!
    const base = stateOf('builtin-film')
    expect(isProfileModified(p, { ...base, processing: { ...base.processing, bassBoostDb: base.processing.bassBoostDb + 1 } })).toBe(true)
    const eq = [...base.processing.eq]
    eq[3] += 0.5
    expect(isProfileModified(p, { ...base, processing: { ...base.processing, eq } })).toBe(true)
    expect(isProfileModified(p, { ...base, processing: { ...base.processing, enabled: false } })).toBe(true)
    expect(isProfileModified(p, { ...base, upmix: false })).toBe(true)
    expect(isProfileModified(p, { ...base, upmixOptions: { ...base.upmixOptions, mode: 'game' } })).toBe(true)
    expect(isProfileModified(p, { ...base, upmixOptions: { ...base.upmixOptions, centerDb: 0 } })).toBe(true)
    expect(isProfileModified(p, { ...base, upmixOptions: { ...base.upmixOptions, lfeEnabled: false } })).toBe(true)
  })

  it('yalnızca ön ayar etiketi farklıysa değişmiş sayılmaz', () => {
    const p = builtinProfile('builtin-film')!
    const base = stateOf('builtin-film')
    expect(isProfileModified(p, { ...base, processing: { ...base.processing, preset: 'custom' } })).toBe(false)
  })

  it('profilePatch ve snapshotState bağımsız kopya üretir', () => {
    const p = builtinProfile('builtin-film')!
    const patch = profilePatch(p)
    patch.processing.eq[0] = 12
    patch.upmixOptions.centerDb = -5
    expect(p.processing.eq[0]).not.toBe(12)
    expect(p.upmixOptions.centerDb).toBe(1)
    const snap = snapshotState({ processing: defaultProcessing(), upmix: false, upmixOptions: defaultUpmixOptions() })
    expect(snap.upmix).toBe(false)
  })
})

describe('normalizeProfiles', () => {
  it('config yoksa yerleşikler gelir', () => {
    expect(normalizeProfiles(undefined).map((p) => p.id)).toEqual(['builtin-film', 'builtin-game', 'builtin-music', 'builtin-flat'])
  })

  it('kullanıcı profili korunur, bozuklar atılır, yerleşik başta kalır ve kilitlenir', () => {
    const user = { id: 'u1', name: '  Gece   modu ', builtin: true, upmix: false, processing: { bassBoostDb: 5 } }
    const ps = normalizeProfiles([user, user, { id: '', name: 'x' }, { id: 'u2', name: '   ' }, null, 3])
    expect(ps.map((p) => p.id)).toEqual(['builtin-film', 'builtin-game', 'builtin-music', 'builtin-flat', 'u1'])
    const u = ps[4]
    expect(u.builtin).toBe(false)
    expect(u.name).toBe('Gece modu')
    expect(u.upmix).toBe(false)
    expect(u.processing.bassBoostDb).toBe(5)
    expect(u.processing.eq).toHaveLength(EQ_BANDS)
    expect(u.upmixOptions).toEqual(defaultUpmixOptions())
  })

  it('kaydedilmiş yerleşik düzenleme korunur ama adı sabit kalır', () => {
    const edited = { ...builtinProfile('builtin-film')!, name: 'Başka', upmixOptions: { ...defaultUpmixOptions(), centerDb: 4 } }
    const film = normalizeProfiles([edited])[0]
    expect(film.name).toBe('Film')
    expect(film.upmixOptions.centerDb).toBe(4)
  })

  it('ad temizliği', () => {
    expect(cleanProfileName('   ')).toBeNull()
    expect(cleanProfileName('a'.repeat(50))).toHaveLength(24)
  })

  it('yeni alanlar (arka kanal, peq, otomatik ön kazanç) karşılaştırılır; eski profiller varsayılanla yüklenir', () => {
    const film = builtinProfile('builtin-film')!
    const cur = profilePatch(film)
    expect(isProfileModified(film, cur)).toBe(false)
    for (const u of [{ surroundDelayMs: 3 }, { surroundHighCutHz: 6000 }, { diffusion: 0.4 }]) {
      expect(isProfileModified(film, { ...cur, upmixOptions: { ...cur.upmixOptions, ...u } })).toBe(true)
    }
    const peq = [{ id: 'a', type: 'peak' as const, freqHz: 900, gainDb: 3, q: 1 }]
    expect(isProfileModified(film, { ...cur, processing: { ...cur.processing, peq } })).toBe(true)
    expect(isProfileModified(film, { ...cur, processing: { ...cur.processing, autoPreamp: !cur.processing.autoPreamp } })).toBe(true)
    // Kimlik farkı değişiklik sayılmaz.
    const withPeq = { ...film, processing: { ...film.processing, peq } }
    const other = { ...cur, processing: { ...cur.processing, peq: [{ ...peq[0], id: 'b' }] } }
    expect(isProfileModified(withPeq, other)).toBe(false)
    // Eski profil: yeni alanlar yok.
    const old = normalizeProfiles([{ id: 'old', name: 'Eski', upmix: true, processing: { eq: [1], preampDb: -2 }, upmixOptions: { mode: 'game' } }])[3]
    expect(old.processing.autoPreamp).toBe(false)
    expect(old.processing.peq).toEqual([])
    expect(old.upmixOptions.surroundDelayMs).toBe(10)
  })

  it('Flat: ses işleme kapalı, güvenlik limiter açık, upmix doğrudan (işlemsiz kopya)', () => {
    const p = builtinProfile('builtin-flat')!
    expect(p.processing.enabled).toBe(false)
    expect(p.processing.limiter).toBe(true)
    expect(p.processing.eq.every((v) => v === 0)).toBe(true)
    expect(p.upmixOptions.mode).toBe('direct')
  })

  it('kayıtlı eski Flat kopyası yerleşik tanımı gölgelemez', () => {
    const old = { ...builtinProfile('builtin-flat')!, upmix: false }
    const ps = normalizeProfiles([old])
    expect(ps.find((p) => p.id === 'builtin-flat')!.upmix).toBe(true)
  })
})
