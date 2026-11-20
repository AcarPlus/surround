import { describe, expect, it } from 'vitest'
import { explainError, friendlyMessage, micPrivacyHint } from './errors'

describe('explainError', () => {
  it('teknik doğrulama mesajını Türkçe cümleye çevirir, ayrıntıyı saklar', () => {
    const r = explainError({ errors: ['outputs[1].bufferMs 10-500 aralığında olmalı.', 'x'] })
    expect(r.message).toContain('tampon süresi')
    expect(r.message).toContain('+1 sorun daha')
    expect(r.detail).toContain('outputs[1].bufferMs')
  })
  it('NullReference İngilizce metnini göstermez', () => {
    const r = explainError(new Error('Object reference not set to an instance of an object.'))
    expect(r.message).not.toMatch(/Object reference/)
    expect(r.detail).toMatch(/Object reference/)
  })
  it('zaten anlaşılır Türkçe mesajı olduğu gibi bırakır, ayrıntı yok', () => {
    const r = explainError(new Error('Mikrofon seçilmedi.'))
    expect(r).toEqual({ message: 'Mikrofon seçilmedi.', detail: undefined })
  })
  it('geri besleme, eksik hoparlör ve cihaz biçimi mesajlarını tanır', () => {
    expect(friendlyMessage('outputs[0]: loopback kaynak cihazı aynı zamanda çıkış olamaz (geri besleme döngüsü).').translated).toBe(true)
    expect(friendlyMessage("'FL': outputDeviceId outputs listesinde yok.").message).toContain('çıkış cihazı')
    expect(friendlyMessage('Hata 0x88890008').translated).toBe(true)
    expect(friendlyMessage('Kaynak formatı desteklenmiyor: 8 kanal').translated).toBe(true)
  })
  it('Windows\'un yerelleştirilmiş "desteklenmiyor" metnini biçim hatası sanmaz', () => {
    const raw = 'Beklenmeyen hata: Unable to cast COM object ... Böyle bir arabirim desteklenmiyor (0x80004002 (E_NOINTERFACE)).'
    expect(friendlyMessage(raw).message).not.toContain('biçimi desteklemiyor')
  })
  it('sayısal sınırlar için ayrı cümleler', () => {
    expect(friendlyMessage("'FL': gainDb -60..24 dB aralığında olmalı (bulunan: 40).").message).toContain('-60')
    expect(friendlyMessage("'FL': delayMs 0-1000 ms aralığında olmalı (bulunan: 2000).").message).toContain('1000')
  })
})

describe('micPrivacyHint', () => {
  it('erişim reddini Gizlilik > Mikrofon ipucuna çevirir', () => {
    expect(micPrivacyHint(new Error('Access is denied. (0x80070005)'))).toContain('Gizlilik')
    expect(micPrivacyHint(new Error('E_ACCESSDENIED'))).toContain('Mikrofon')
    expect(micPrivacyHint({ errors: ['UnauthorizedAccessException'] })).not.toBeNull()
  })
  it('başka hatalara dokunmaz', () => {
    expect(micPrivacyHint(new Error('Mikrofon seçilmedi.'))).toBeNull()
  })
})
