import type { EngineInfo } from '../api/types'

/** Kaynak ekranındaki durum rozeti metni. */
export function upmixStateLabel(e: Pick<EngineInfo, 'upmix' | 'sourceChannels'>): string {
  if (e.upmix === 'stereo') return 'Upmix etkin (stereo içerik)'
  if (e.upmix === 'native') {
    const n = e.sourceChannels
    return `Yerel ${n >= 8 ? '7.1' : n === 6 ? '5.1' : `${n} kanal`}`
  }
  return 'Upmix kapalı'
}
