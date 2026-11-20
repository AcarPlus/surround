import { describe, expect, it } from 'vitest'
import { simpleStatus } from './simpleStatus'

const base = { speakerCount: 6, calibrated: false, runState: 'stopped' as const, waitingFor: [], problem: null }

describe('Basit kip durum satırı', () => {
  it('hoparlör yoksa yönlendirir', () => {
    expect(simpleStatus({ ...base, speakerCount: 0 }).text).toMatch(/hoparlör eklenmedi/)
  })
  it('durdu / çalışıyor ve ölçüm bilgisi', () => {
    expect(simpleStatus(base)).toEqual({ text: 'Durdu · 6 hoparlör · ölçülmedi', tone: 'muted' })
    expect(simpleStatus({ ...base, runState: 'running', calibrated: true })).toEqual({
      text: 'Çalışıyor · 6 hoparlör · ölçüldü',
      tone: 'ok',
    })
  })
  it('cihaz beklerken eksik cihazları yazar; sorun varsa hata tonu', () => {
    expect(simpleStatus({ ...base, runState: 'waiting', waitingFor: ['A', 'B'] }).text).toBe('Cihaz bekleniyor: A, B')
    const p = simpleStatus({ ...base, problem: 'Kaynak cihaz yok' })
    expect(p.tone).toBe('error')
    expect(p.text).toContain('Kaynak cihaz yok')
  })
})
