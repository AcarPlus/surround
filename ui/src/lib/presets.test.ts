import { describe, expect, it } from 'vitest'
import { EQ_BANDS, PEQ_MAX_BANDS, defaultProcessing, normalizeProcessing, type Speaker } from '../api/types'
import {
  SOUND_PRESETS,
  SPEAKER_PRESETS,
  makeUserSoundPreset,
  makeUserSpeakerPreset,
  matchSoundPreset,
  normalizeUserSoundPresets,
  normalizeUserSpeakerPresets,
  soundPresetPatch,
  speakerPresetPatch,
  speakerPresetValue,
  userPresetKey,
  userSoundPatch,
  userSpeakerPatch,
} from './presets'
import { autoPreampDb } from './eqCurve'

describe('presets', () => {
  it('tüm ön ayarlar aralık içinde ve 10 bant', () => {
    for (const p of SOUND_PRESETS) {
      expect(p.values.eq).toHaveLength(EQ_BANDS)
      expect(p.values.eq.every((v) => v >= -12 && v <= 12)).toBe(true)
      expect(p.values.bassBoostDb).toBeGreaterThanOrEqual(0)
      expect(p.values.bassBoostDb).toBeLessThanOrEqual(12)
      expect(p.values.clarityDb).toBeLessThanOrEqual(12)
      expect(p.values.dynamicBoost).toBeLessThanOrEqual(1)
      expect(p.values.ambience).toBeLessThanOrEqual(1)
      expect(p.values.preampDb).toBeGreaterThanOrEqual(-24)
      expect(p.values.preampDb).toBeLessThanOrEqual(12)
    }
    for (const p of SPEAKER_PRESETS) {
      expect(p.eq).toHaveLength(EQ_BANDS)
      expect(p.eq.every((v) => v >= -12 && v <= 12)).toBe(true)
    }
  })

  it('ön ayar uygulanınca etiket eşleşir, değer değişince Özel olur', () => {
    for (const p of SOUND_PRESETS) {
      const cur = { ...defaultProcessing(), ...soundPresetPatch(p.id) }
      expect(matchSoundPreset(cur)).toBe(p.id)
      expect(matchSoundPreset({ ...cur, ambience: cur.ambience + 0.05 })).toBe('custom')
    }
  })

  it('eksik processing varsayılanla tamamlanır', () => {
    const n = normalizeProcessing({ preampDb: -3, eq: [1, 2] })
    expect(n.enabled).toBe(true)
    expect(n.limiter).toBe(true)
    expect(n.preset).toBe('flat')
    expect(n.eq).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(normalizeProcessing(undefined)).toEqual(defaultProcessing())
  })

  it('hoparlör ön ayarı: uydu bas keser, düz yalnızca EQ sıfırlar', () => {
    const sat = speakerPresetPatch('small-satellite')!
    expect(sat.highPassHz).toBe(150)
    expect(sat.eqPreset).toBe('small-satellite')
    const flat = speakerPresetPatch('flat')!
    expect(flat.eq).toBeUndefined()
    expect('highPassHz' in flat).toBe(false)
    expect(speakerPresetPatch('subwoofer')!.bassReceiver).toBe(true)
  })

  it('kimlikler korunur, yeni ön ayarlar var', () => {
    const ids = SOUND_PRESETS.map((p) => p.id)
    for (const id of ['flat', 'general', 'film', 'game', 'music', 'speech', 'bass', 'night', 'game-competitive', 'loudness']) {
      expect(ids).toContain(id)
    }
    expect(new Set(ids).size).toBe(ids.length)
    expect(SOUND_PRESETS.find((p) => p.id === 'game-competitive')!.label).toBe('Rekabetçi oyun')
    expect(SOUND_PRESETS.find((p) => p.id === 'loudness')!.label).toBe('Kısık ses (loudness)')
  })

  it('ayar ilkeleri: otomatik ön kazanç, bas yığılması yok, parametrik sınırlar', () => {
    for (const p of SOUND_PRESETS) {
      const v = p.values
      expect(v.autoPreamp, p.id).toBe(true)
      expect(v.peq.length).toBeLessThanOrEqual(PEQ_MAX_BANDS)
      // Alçak bant artışı + bas güçlendirme üst üste yığılmaz.
      const lowBoost = Math.max(0, ...v.eq.slice(0, 3))
      expect(lowBoost + v.bassBoostDb, p.id).toBeLessThanOrEqual(6)
      // Otomatik ön kazançla toplam tepe 0 dB'ye iner; hiçbir ön ayar ön kazancı uçlara itmez.
      expect(autoPreampDb({ ...defaultProcessing(), ...v }), p.id).toBeGreaterThan(-12)
    }
    expect(SOUND_PRESETS.find((p) => p.id === 'flat')!.values.eq.every((x) => x === 0)).toBe(true)
  })

  it('rekabetçi oyun: ayak sesi (2–5 kHz) yükselir, gümbürtü (60–200 Hz) kısılır', () => {
    const v = SOUND_PRESETS.find((p) => p.id === 'game-competitive')!.values
    expect(v.eq[1]).toBeLessThan(0) // 62 Hz
    expect(v.eq[2]).toBeLessThan(0) // 125 Hz
    expect(v.eq[3]).toBeLessThan(0) // 250 Hz
    expect(v.eq[6]).toBeGreaterThan(0) // 2 kHz
    expect(v.eq[7]).toBeGreaterThan(0) // 4 kHz
    expect(v.bassBoostDb).toBe(0)
  })

  it('loudness: iki raf (alçak + yüksek), düz EQ', () => {
    const v = SOUND_PRESETS.find((p) => p.id === 'loudness')!.values
    expect(v.eq.every((x) => x === 0)).toBe(true)
    expect(v.peq.map((b) => b.type)).toEqual(['lowShelf', 'highShelf'])
    expect(v.peq.every((b) => b.gainDb > 0 && b.gainDb <= 6)).toBe(true)
    const patch = soundPresetPatch('loudness')!
    expect(patch.peq!.every((b) => !!b.id)).toBe(true)
    expect(matchSoundPreset({ ...defaultProcessing(), ...patch })).toBe('loudness')
  })

  it('peq / otomatik ön kazanç farkı ön ayar eşleşmesini bozar', () => {
    const cur = { ...defaultProcessing(), ...soundPresetPatch('loudness') }
    expect(matchSoundPreset({ ...cur, autoPreamp: false })).toBe('custom')
    expect(matchSoundPreset({ ...cur, peq: cur.peq.slice(0, 1) })).toBe('custom')
    // Otomatik açıkken preampDb etkisiz: eşleşmeyi bozmaz.
    expect(matchSoundPreset({ ...cur, preampDb: -5 })).toBe('loudness')
  })

  it('kullanıcı ön ayarı: kaydet, uygula, eşleştir, doğrula', () => {
    const cur = normalizeProcessing({ ...soundPresetPatch('film'), bassBoostDb: 1.5, peq: [{ type: 'peak', freqHz: 900, gainDb: 2, q: 1.2 }] })
    const u = makeUserSoundPreset(cur, 'Benimki', 'u1')
    expect(u.peq).toHaveLength(1)
    expect(matchSoundPreset(cur, [u])).toBe(userPresetKey('u1'))
    const patch = userSoundPatch(u)
    expect(patch.preset).toBe('user:u1')
    expect(patch.eq).not.toBe(u.eq) // kopya
    expect(matchSoundPreset({ ...cur, bassBoostDb: 2 }, [u])).toBe('custom')

    const raw = [u, u, { id: 'x', name: '  ' }, null, { id: 'y', name: 'Bozuk', eq: ['a'], bassBoostDb: 99 }]
    const back = normalizeUserSoundPresets(JSON.parse(JSON.stringify(raw)))
    expect(back.map((p) => p.id)).toEqual(['u1', 'y'])
    expect(back[1].eq).toHaveLength(EQ_BANDS)
    expect(back[1].bassBoostDb).toBe(12)
    expect(normalizeUserSoundPresets(undefined)).toEqual([])
  })

  it('kullanıcı hoparlör ön ayarı: EQ + parametrik; düz EQ undefined olur', () => {
    const sp = { id: 's', eq: [0, 0, 0, -2, 0, 0, 0, 0, 0, 0], peq: [{ id: 'p', type: 'highShelf', freqHz: 8000, gainDb: -3, q: 0.7 }] } as unknown as Speaker
    const u = makeUserSpeakerPreset(sp, 'Uydu', 'su1')
    expect(u.peq).toHaveLength(1)
    const p = userSpeakerPatch(u)
    expect(p.eqPreset).toBe('user:su1')
    expect(p.peq).toHaveLength(1)
    expect(userSpeakerPatch({ id: 'z', name: 'z', eq: new Array<number>(10).fill(0) }).eq).toBeUndefined()
    expect(speakerPresetValue({ ...sp, eqPreset: 'user:su1' }, [u])).toBe('user:su1')
    expect(speakerPresetValue({ ...sp, eqPreset: 'user:gone' }, [u])).toBe('custom')
    expect(normalizeUserSpeakerPresets([u, { id: 'q', name: 'ok', eq: [1] }]).map((x) => x.id)).toEqual(['su1', 'q'])
  })

  it('peq normalizasyonu: sınırlar, en fazla 6, bozuk kayıt atılır', () => {
    const n = normalizeProcessing({
      peq: [
        { type: 'peak', freqHz: 5, gainDb: 99, q: 0 },
        { type: 'weird' as never, freqHz: NaN, gainDb: -99, q: 99 },
        null as never,
        ...Array.from({ length: 8 }, () => ({ type: 'lowShelf' as const, freqHz: 100, gainDb: 1, q: 1 })),
      ],
    })
    expect(n.peq).toHaveLength(6)
    expect(n.peq[0]).toMatchObject({ freqHz: 20, gainDb: 12, q: 0.3 })
    expect(n.peq[1]).toMatchObject({ type: 'peak', freqHz: 1000, gainDb: -12, q: 10 })
    expect(n.peq.every((b) => !!b.id)).toBe(true)
    expect(n.autoPreamp).toBe(false)
  })
})
