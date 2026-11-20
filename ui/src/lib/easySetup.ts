import type { CalibrationResult, Device, PeqBand, Source, Speaker } from '../api/types'
import { calibrationPatches, matchInputs, onSourceDevice, withRoomEq, type CalibrationRow, type OffCentreSuspect } from './calibration'
import { findCable } from './health'
import { GENTLE_ROOM_EQ_LIMITS, matchSpeakers, type MatchResult } from './roomEq'

/**
 * Kolay kurulum (Basit kip, `screens/EasySetup.tsx`) için saf adım mantığı. Hoparlör planı `lib/quickStart.ts`,
 * ölçüm `lib/calibration.ts`, oda düzeltmesi `lib/roomEq.ts` (yalnızca kısan yumuşak sınırlarla) üzerinden yapılır.
 */

export type EasyStep = 'source' | 'speakers' | 'mic' | 'place' | 'measure' | 'eq' | 'done'

export const EASY_STEP_LABELS: Record<EasyStep, string> = {
  source: 'Ses kaynağı',
  speakers: 'Hoparlörler',
  mic: 'Mikrofon',
  place: 'Konum',
  measure: 'Ölçüm',
  eq: 'Oda düzeltmesi',
  done: 'Bitti',
}

const FULL: EasyStep[] = ['source', 'speakers', 'mic', 'place', 'measure', 'eq', 'done']
const REMEASURE: EasyStep[] = ['mic', 'measure', 'eq', 'done']

/** Baştan kurulum tüm adımlar; "yeniden ölç" (hoparlörler zaten var) mikrofondan başlar. */
export const easySteps = (start: 'mic' | null): EasyStep[] => (start === 'mic' ? REMEASURE : FULL)

export function stepAfter(steps: EasyStep[], cur: EasyStep): EasyStep {
  const i = steps.indexOf(cur)
  return steps[Math.min(steps.length - 1, i + 1)]
}

export function stepBefore(steps: EasyStep[], cur: EasyStep): EasyStep | null {
  const i = steps.indexOf(cur)
  return i > 0 ? steps[i - 1] : null
}

/* ---------- 1 · Ses kaynağı ---------- */

export type SourceState =
  | { kind: 'missing' }
  | { kind: 'needs-setup'; cable: Device; reasons: string[] }
  | { kind: 'ready'; cable: Device }

/** VB-Cable var mı, 7.1 mi ve kaynak olarak seçili mi? */
export function sourceState(devices: Device[], source: Source): SourceState {
  const cable = findCable(devices)
  if (!cable) return { kind: 'missing' }
  const reasons: string[] = []
  if (cable.channels < 6) reasons.push('Windows’ta stereo ayarlı; 7.1 olmalı.')
  if (!(source.mode === 'loopback' && source.deviceId === cable.id)) reasons.push('Surround sesi henüz VB-Cable’dan almıyor.')
  return reasons.length ? { kind: 'needs-setup', cable, reasons } : { kind: 'ready', cable }
}

/* ---------- 4–5 · Ölçülecek hoparlörler ve sonuç denetimi ---------- */

/** Ölçülecekler: sessizde olmayan, kaynak cihazda olmayan; `deviceIds` verilirse yalnızca o cihazlardakiler. */
export function speakersToMeasure(speakers: Speaker[], source: Source, deviceIds?: ReadonlySet<string>): Speaker[] {
  return speakers.filter((s) => !s.mute && !onSourceDevice(s, source) && (!deviceIds || deviceIds.has(s.outputDeviceId)))
}

/** Bundan düşük sinyal/gürültü oranlı ölçüm güvenilmez sayılır (Gelişmiş ekranda da uyarı rengi). */
export const MIN_SNR_DB = 15

export interface MeasureCheck {
  /** 'ok': her şey iyi; 'warn': bazı hoparlörler zayıf / mikrofon kırpıldı / mikrofon ortada değil; 'fail': hiçbiri kullanılamaz. */
  status: 'ok' | 'warn' | 'fail'
  weak: { id: string; name: string }[]
  goodIds: string[]
  clipped: boolean
  suspectPair: string | null
}

/** Zayıf (ölçülemeyen ya da SNR < 15 dB) hoparlörlerin kimlikleri: bunlara düzeltme uygulanmaz. */
export function weakIds(result: CalibrationResult): Set<string> {
  return new Set(result.speakers.filter((m) => !m.ok || m.snrDb < MIN_SNR_DB).map((m) => m.speakerId))
}

export function checkMeasurement(result: CalibrationResult, speakers: Speaker[], suspect: OffCentreSuspect | null = null): MeasureCheck {
  const weakSet = weakIds(result)
  const name = (id: string) => speakers.find((s) => s.id === id)?.name ?? id
  const weak = result.speakers.filter((m) => weakSet.has(m.speakerId)).map((m) => ({ id: m.speakerId, name: name(m.speakerId) }))
  const goodIds = result.speakers.filter((m) => !weakSet.has(m.speakerId)).map((m) => m.speakerId)
  const status = goodIds.length === 0 ? 'fail' : weak.length > 0 || result.micClipped || suspect ? 'warn' : 'ok'
  return { status, weak, goodIds, clipped: result.micClipped, suspectPair: suspect?.pair ?? null }
}

/** Ölçüm sesi seviyeleri (dBFS): Gelişmiş ekrandaki Kısık / Orta / Yüksek. */
export const EASY_LEVELS = [-30, -20, -12] as const
export const EASY_DEFAULT_LEVEL = -20

/** Tekrar ölçümde ses seviyesi: mikrofon kırpıldıysa bir kademe kıs, zayıf hoparlör varsa bir kademe aç. */
export function retryLevel(current: number, check: Pick<MeasureCheck, 'clipped' | 'weak'>): number {
  const i = EASY_LEVELS.findIndex((l) => l >= current)
  const at = i < 0 ? EASY_LEVELS.length - 1 : i
  if (check.clipped) return EASY_LEVELS[Math.max(0, at - 1)]
  if (check.weak.length > 0) return EASY_LEVELS[Math.min(EASY_LEVELS.length - 1, at + 1)]
  return EASY_LEVELS[at]
}

/** Sade dilde öneriler (sorun yoksa boş). */
export function measureAdvice(check: MeasureCheck, phone: boolean): string[] {
  const out: string[] = []
  if (check.weak.length > 0) {
    out.push(
      phone
        ? 'Telefonu oturduğun yere, ekranı yukarı bakacak şekilde koy ve ölçüm sayfasını açık tut.'
        : 'Mikrofonu oturduğun yere, hoparlörlere daha yakın koy.',
    )
    out.push('Hoparlörlerin ya da bilgisayarın sesini biraz aç; tekrar ölçümde test sesi de biraz daha yüksek çalınır.')
    out.push('Ölçüm sırasında ortamın sessiz olduğundan emin ol.')
  }
  if (check.clipped) out.push('Mikrofon çok yüksek ses duydu: hoparlörlerin sesini biraz kıs; tekrar ölçümde test sesi daha kısık çalınır.')
  if (check.suspectPair)
    out.push(`${check.suspectPair} arasında beklenmedik fark var: mikrofon tam ortada olmayabilir. Oturduğun yerin ortasına koyup tekrar ölç.`)
  return out
}

/* ---------- 6 · Yumuşak oda düzeltmesi ---------- */

/**
 * Yalnızca kısan, en çok 4 bant ve −6 dB'lik oda düzeltmesi (`GENTLE_ROOM_EQ_LIMITS`). Hedef: hoparlörlerin ortalaması
 * (her hoparlör yalnızca ortalamadan yüksek kaldığı yerde kısılır). Zayıf ölçülenler ve subwoofer'lar eşlenmez.
 */
export function gentleRoomEq(result: CalibrationResult, list: Speaker[], skip: ReadonlySet<string> = new Set()): MatchResult[] {
  if (!result.responseHz) return []
  const inputs = matchInputs(list, [result], skip).filter((x) => x.responses.length > 0)
  if (inputs.length === 0) return []
  return matchSpeakers(result.responseHz, inputs, { target: 'average', limits: GENTLE_ROOM_EQ_LIMITS })
}

/** Bantların okunur özeti: "2 noktada hafif kısma (en çok 3,5 dB)" ya da "Düzeltme gerekmedi". */
export function describeBands(bands: readonly PeqBand[]): string {
  if (bands.length === 0) return 'Düzeltme gerekmedi'
  const max = Math.max(...bands.map((b) => -b.gainDb))
  return `${bands.length} noktada hafif kısma (en çok ${max.toFixed(1).replace('.', ',')} dB)`
}

/**
 * Uygulanacak yamalar: gecikme/kazanç (zayıflar hariç, `rows` içinde zaten dışlanmış) + oda düzeltmesi.
 * Düzeltme kapalıysa ölçülen hoparlörlerin eski oda EQ'su kaldırılır (eski ölçümden kalan EQ yeni değerlere uymaz).
 */
export function easyPatches(rows: CalibrationRow[], matches: MatchResult[], roomEq: boolean, at: string): Record<string, Partial<Speaker>> {
  const patches = calibrationPatches(rows, at)
  if (roomEq) return withRoomEq(patches, matches, new Set(), at)
  for (const id of Object.keys(patches)) patches[id] = { ...patches[id], roomEq: undefined }
  return patches
}

/* ---------- 7 · Özet ---------- */

export interface EasySummaryInput {
  speakers: number
  measured: number
  skipped: number
  roomEq: 'applied' | 'none-needed' | 'off' | 'unavailable'
  cable: boolean
}

export function easySummary(s: EasySummaryInput): string[] {
  const out = [`${s.speakers} hoparlör hazır.`]
  if (s.measured > 0) out.push('Ses gecikmeleri ve seviyeler eşitlendi.')
  if (s.skipped > 0) out.push(`${s.skipped} hoparlör ölçülemedi; onların ayarı değişmedi.`)
  if (s.roomEq === 'applied') out.push('Oda düzeltmesi uygulandı (yalnızca hafif kısma).')
  else if (s.roomEq === 'none-needed') out.push('Oda düzeltmesine gerek çıkmadı.')
  else if (s.roomEq === 'off') out.push('Oda düzeltmesi kapalı.')
  if (!s.cable) out.push('VB-Cable yok: oyun ve filmlerin sesi stereo olarak alınıp hoparlörlere dağıtılıyor.')
  return out
}

/* ---------- 3 · Mikrofon seçimi (son seçim hatırlanır) ---------- */

export type MicChoice = { kind: 'phone' } | { kind: 'device'; deviceId: string }

export const MIC_CHOICE_KEY = 'surround.easyMic'

export const serializeMicChoice = (c: MicChoice): string => (c.kind === 'phone' ? 'phone' : `device:${c.deviceId}`)

/** Saklanan seçimi okur; cihaz artık yoksa null. */
export function parseMicChoice(raw: string | null | undefined, mics: Device[]): MicChoice | null {
  if (raw === 'phone') return { kind: 'phone' }
  if (raw?.startsWith('device:')) {
    const id = raw.slice('device:'.length)
    return mics.some((d) => d.id === id) ? { kind: 'device', deviceId: id } : null
  }
  return null
}

export function loadMicChoice(mics: Device[]): MicChoice | null {
  try {
    return parseMicChoice(localStorage.getItem(MIC_CHOICE_KEY), mics)
  } catch {
    return null
  }
}

export function saveMicChoice(c: MicChoice): void {
  try {
    localStorage.setItem(MIC_CHOICE_KEY, serializeMicChoice(c))
  } catch {
    /* yoksay */
  }
}
