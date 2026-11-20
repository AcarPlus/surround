import type { RunState } from '../store/useStore'

export interface SimpleStatusInput {
  speakerCount: number
  calibrated: boolean
  runState: RunState
  waitingFor: string[]
  /** Sistem kontrolünün ilk hata başlığı (varsa). */
  problem: string | null
}

export interface SimpleStatus {
  text: string
  tone: 'ok' | 'warn' | 'error' | 'muted'
}

/** Basit kip ana ekranındaki tek satırlık durum (jargonsuz). */
export function simpleStatus(i: SimpleStatusInput): SimpleStatus {
  if (i.speakerCount === 0) return { text: 'Henüz hoparlör eklenmedi.', tone: 'muted' }
  const speakers = `${i.speakerCount} hoparlör`
  const measured = i.calibrated ? 'ölçüldü' : 'ölçülmedi'
  if (i.runState === 'waiting') {
    const who = i.waitingFor.length > 0 ? `: ${i.waitingFor.join(', ')}` : ''
    return { text: `Cihaz bekleniyor${who}`, tone: 'warn' }
  }
  if (i.runState === 'starting') return { text: 'Başlatılıyor…', tone: 'warn' }
  if (i.problem) return { text: `${speakers} · ${i.problem}`, tone: 'error' }
  if (i.runState === 'running') return { text: `Çalışıyor · ${speakers} · ${measured}`, tone: 'ok' }
  return { text: `Durdu · ${speakers} · ${measured}`, tone: 'muted' }
}
