import { describe, expect, it } from 'vitest'
import { EQ_BANDS, defaultProcessing, defaultUpmixOptions, normalizeUpmixOptions } from '../api/types'
import { SOUND_PRESETS } from './presets'
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

  it('Film: film modu, diyalog +2 dB, Film ses ön ayarı', () => {
    const p = builtinProfile('builtin-film')!
    expect(p.upmixOptions.mode).toBe('film')
    expect(p.upmixOptions.centerDb).toBe(2)
    const film = SOUND_PRESETS.find((s) => s.id === 'film')!
    expect(p.processing.preset).toBe('film')
    expect(p.processing.eq).toEqual(film.values.eq)
    expect(p.processing.bassBoostDb).toBe(film.values.bassBoostDb)
  })

  it('Oyun: oyun modu, orta dinamik güçlendirme', () => {
    const p = builtinProfile('builtin-game')!
    expect(p.upmixOptions.mode).toBe('game')
    expect(p.processing.dynamicBoost).toBe(0.5)
    expect(p.processing.clarityDb).toBe(2)
  })

  it('Müzik: film modu, surround -4, üst -6, Müzik ön ayarı', () => {
    const p = builtinProfile('builtin-music')!
    expect(p.upmixOptions).toMatchObject({ mode: 'film', surroundDb: -4, heightDb: -6 })
    expect(p.processing.preset).toBe('music')
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
    expect(p.upmixOptions.centerDb).toBe(2)
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

  it('Flat: ses işleme ve sınırlayıcı kapalı, upmix doğrudan (işlemsiz kopya)', () => {
    const p = builtinProfile('builtin-flat')!
    expect(p.processing.enabled).toBe(false)
    expect(p.processing.limiter).toBe(false)
    expect(p.processing.eq.every((v) => v === 0)).toBe(true)
    expect(p.upmixOptions.mode).toBe('direct')
  })

  it('kayıtlı eski Flat kopyası yerleşik tanımı gölgelemez', () => {
    const old = { ...builtinProfile('builtin-flat')!, upmix: false }
    const ps = normalizeProfiles([old])
    expect(ps.find((p) => p.id === 'builtin-flat')!.upmix).toBe(true)
  })
})
