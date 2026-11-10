import type { CalibrationProgress, CalibrationResult, Output, Speaker } from '../api/types'
import { ROLE_SUB, effectiveRole } from './roles'
import { round } from './geometry'

/**
 * Ölçüm sonucundan hoparlör gecikme/kazanç önerisi (docs/kalibrasyon.md).
 *
 * Ölçülen değerler hoparlörün kendi delayMs/gainDb'si HARİÇTİR (backend çıkarır). Böylece:
 * - Gecikme: en geç ulaşan hoparlör 0 ms, diğerleri aradaki fark kadar geciktirilir.
 * - Seviye: varsayılan hedef en sessiz hoparlör (yalnızca kısma; güçlendirme yok → kırpılma riski yok).
 * Bas bandında ölçülen (subwoofer) hoparlörlerin seviyesi diğer bantla karşılaştırılamaz: kazancı değişmez.
 *
 * Çıkış gecikmesi: ölçülen varış cihazların gerçek gecikme farkını zaten içerir, ama motor çalışırken her hoparlöre
 * ayrıca (en büyük çıkış latencyMs − kendi çıkışının latencyMs) ekler. Bu pay önerilen gecikmeden düşülür; sonuç
 * negatife inerse tüm önerilen gecikmeler birlikte kaydırılır (en küçüğü 0), göreli hizalama bozulmaz.
 */

export type LevelTarget = 'quietest' | 'median'

export interface CalibrationRow {
  speakerId: string
  name: string
  ok: boolean
  /** Uygulanacak mı (kullanıcı kapatabilir). */
  include: boolean
  /** Ölçülen göreli varış ve seviye. */
  arrivalMs: number
  levelDb: number
  snrDb: number
  spreadMs: number
  lowBand: boolean
  /** Mevcut değerler. */
  prevDelayMs: number
  prevGainDb: number
  /** Önerilen değerler (kazanç değişmeyecekse null). */
  delayMs: number
  gainDb: number | null
  warning?: string
}

const MAX_GAIN_DB = 6
const MIN_GAIN_DB = -30

export function isSubwoofer(sp: Pick<Speaker, 'role' | 'source'>): boolean {
  return effectiveRole(sp) === ROLE_SUB
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function computeCalibration(
  result: CalibrationResult,
  speakers: Speaker[],
  opts: { target?: LevelTarget; excluded?: ReadonlySet<string>; outputs?: Output[] } = {},
): CalibrationRow[] {
  const target = opts.target ?? 'quietest'
  const excluded = opts.excluded ?? new Set<string>()
  // Motorun eklediği çıkış payı (yalnızca hoparlörlerin kullandığı çıkışlar kaydedilir; motor da onlara bakar).
  const outs = (opts.outputs ?? []).filter((o) => speakers.some((s) => s.outputDeviceId === o.deviceId))
  const maxLat = outs.length ? Math.max(...outs.map((o) => o.latencyMs)) : 0
  const comp = (sp: Speaker) => maxLat - (outs.find((o) => o.deviceId === sp.outputDeviceId)?.latencyMs ?? 0)
  const rows = result.speakers.flatMap((m) => {
    const sp = speakers.find((s) => s.id === m.speakerId)
    return sp ? [{ m, sp }] : []
  })
  const usable = rows.filter(({ m }) => m.ok && !excluded.has(m.speakerId))
  const latest = usable.length ? Math.max(...usable.map(({ m }) => m.arrivalMs)) : 0
  const want = (m: { arrivalMs: number }, sp: Speaker) => latest - m.arrivalMs - comp(sp)
  const shift = usable.length ? Math.min(0, ...usable.map(({ m, sp }) => want(m, sp))) : 0
  const levels = usable.filter(({ m }) => !m.lowBand).map(({ m }) => m.levelDb)
  const ref = levels.length === 0 ? 0 : target === 'median' ? median(levels) : Math.min(...levels)

  return rows.map(({ m, sp }) => {
    const include = m.ok && !excluded.has(m.speakerId)
    let warning = m.message
    if (!warning && m.spreadMs > 0.5) warning = `Ölçümler tutarsız (±${round(m.spreadMs, 1)} ms); mikrofonu sabitleyip tekrar ölç.`
    if (!warning && m.lowBand) warning = 'Subwoofer: zamanlama bas bandında ölçüldü, seviyeyi kulakla ayarla.'
    const gain = m.lowBand ? null : round(Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, ref - m.levelDb)), 1)
    return {
      speakerId: sp.id,
      name: sp.name,
      ok: m.ok,
      include,
      arrivalMs: m.arrivalMs,
      levelDb: m.levelDb,
      snrDb: m.snrDb,
      spreadMs: m.spreadMs,
      lowBand: m.lowBand,
      prevDelayMs: sp.delayMs,
      prevGainDb: sp.gainDb,
      delayMs: include ? round(Math.max(0, want(m, sp) - shift), 2) : sp.delayMs,
      gainDb: include ? gain : null,
      warning,
    }
  })
}

/** Ölçülen varış farkını yaklaşık mesafe farkına çevirir (bilgi amaçlı; cihaz gecikmesini de içerir). */
export const msToMeters = (ms: number) => (ms / 1000) * 343

/** Hoparlörlere uygulanacak yamalar: dahil edilen satırlar elle (otomatik kapalı) işaretlenir. */
export function calibrationPatches(rows: CalibrationRow[], at: string): Record<string, Partial<Speaker>> {
  const out: Record<string, Partial<Speaker>> = {}
  for (const r of rows) {
    if (!r.include) continue
    out[r.speakerId] = {
      delayMs: r.delayMs,
      ...(r.gainDb !== null ? { gainDb: r.gainDb } : {}),
      calibratedAt: at,
    }
  }
  return out
}

/**
 * İlerleme çubuğu yüzdesi. Motorun `index`'i 1 tabanlıdır ve "analyzing" aşamasında 1'den yeniden sayar:
 * ölçüm 0–85 %, çözümleme 85–100 %.
 */
export function calibrationPercent(p: CalibrationProgress | null): number {
  if (!p) return 4
  const frac = (i: number) => (p.total > 0 ? Math.min(1, Math.max(0, (i - 0.5) / p.total)) : 0)
  switch (p.phase) {
    case 'preparing':
      return 2
    case 'noise':
      return 4
    case 'measuring':
      return Math.max(4, 85 * frac(p.index))
    case 'analyzing':
      return 85 + 15 * frac(p.index)
    case 'done':
      return 100
  }
}
