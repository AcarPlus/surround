// Motor yapılandırmasını (C# Surround.Engine) yansıtan tipler.
// Backend bağlandığında bu dosya tek doğruluk kaynağı olarak kalır.

export type LogicalChannel = 'FL' | 'FR' | 'FC' | 'LFE' | 'BL' | 'BR' | 'SL' | 'SR'

/** Meter ve karışım listelerinde kullanılan sabit sıra. */
export const LOGICAL_CHANNELS: readonly LogicalChannel[] = [
  'FL',
  'FR',
  'FC',
  'LFE',
  'BL',
  'BR',
  'SL',
  'SR',
]

export type SourceMode = 'loopback' | 'capture'

export interface Source {
  deviceId: string
  mode: SourceMode
}

export interface Output {
  deviceId: string
  latencyMs: number
  bufferMs: number
}

export interface Speaker {
  id: string
  name: string
  outputDeviceId: string
  /** 1 tabanlı fiziksel kanal numarası. */
  deviceChannel: number
  /** Mantıksal kanal -> kazanç (0..1). */
  source: Partial<Record<LogicalChannel, number>>
  delayMs: number
  gainDb: number
  mute: boolean
  /** Oda koordinatları, metre. Sol-üst köşe (0,0); y aşağı doğru artar. */
  x: number
  y: number
  /** Arayüze özgü: gecikme/kazanç otomatik mi. Motor yok sayar; yeniden açılışta korunsun diye config'te saklanır. */
  auto?: { delay: boolean; gain: boolean }
  /** Hoparlöre özel 10 bant EQ (dB, -12..+12); yoksa düz. */
  eq?: number[]
  /** Yalnızca arayüz etiketi (motor yok sayar). */
  eqPreset?: string
  /** Küçük hoparlör: bu frekansın altı kesilir (0/yok = kapalı, 40..250). Kesilen bas bassReceiver'lara gider. */
  highPassHz?: number
  /** Dahili sub / gerçek sub: kesilen bası ve LFE'yi alır. */
  bassReceiver?: boolean
}

export type DeviceKind = 'local' | 'network' | 'multichannel'
export type DeviceFlow = 'render' | 'capture'

export interface Device {
  id: string
  name: string
  kind: DeviceKind
  flow: DeviceFlow
  channels: number
  sampleRate: number
  isDefault: boolean
}

export interface SinkStatus {
  deviceId: string
  fillMs: number
  corrPpm: number
  underruns: number
  overruns: number
}

export interface Point {
  x: number
  y: number
}

export interface Room {
  widthM: number
  depthM: number
  listener: Point
}

/** Genel ses işleme (EQ, bas, netlik, limiter). Bkz. docs/ses-isleme.md. */
export interface Processing {
  enabled: boolean
  /** Yalnızca arayüz etiketi; 'custom' = Özel. */
  preset: string
  /** -24..+12 */
  preampDb: number
  /** 10 bant, dB -12..+12. */
  eq: number[]
  /** 0..12 */
  bassBoostDb: number
  /** 0..12 */
  clarityDb: number
  /** 0..1 */
  dynamicBoost: number
  /** 0..1 */
  ambience: number
  limiter: boolean
}

/** EQ bant merkez frekansları (Hz). */
export const EQ_FREQS: readonly number[] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const EQ_BANDS = EQ_FREQS.length
export const EQ_RANGE_DB = 12

export const flatEq = (): number[] => new Array<number>(EQ_BANDS).fill(0)

export const defaultProcessing = (): Processing => ({
  enabled: true,
  preset: 'flat',
  preampDb: 0,
  eq: flatEq(),
  bassBoostDb: 0,
  clarityDb: 0,
  dynamicBoost: 0,
  ambience: 0,
  limiter: true,
})

/** Eksik alanları varsayılanla doldurur, EQ'yu 10 banda tamamlar. */
export function normalizeProcessing(p?: Partial<Processing> | null): Processing {
  const d = defaultProcessing()
  if (!p) return d
  const eq = flatEq().map((_, i) => (typeof p.eq?.[i] === 'number' ? p.eq[i] : 0))
  return { ...d, ...p, eq }
}

/** Upmix modu: oyun = düşük gecikmeli matris çözücü, film = STFT tabanlı yüksek kalite. Bkz. docs/upmix.md. */
export type UpmixMode = 'game' | 'film'

/** Upmix ayrıntıları; `upmix` açık/kapalı anahtarı ayrı kalır (geriye uyum). */
export interface UpmixOptions {
  mode: UpmixMode
  /** Orta (diyalog) seviyesi, dB -12..+6. */
  centerDb: number
  /** Yan/arka seviyesi, dB -12..+6. */
  surroundDb: number
  /** LFE üret (yalnızca LFE'ye atanmış hoparlörde duyulur). */
  lfeEnabled: boolean
}

export const UPMIX_DB_MIN = -12
export const UPMIX_DB_MAX = 6

export const defaultUpmixOptions = (): UpmixOptions => ({
  mode: 'film',
  centerDb: 0,
  surroundDb: 0,
  lfeEnabled: true,
})

const clampDb = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(UPMIX_DB_MAX, Math.max(UPMIX_DB_MIN, v)) : d

/** Eksik/bozuk alanları varsayılanla doldurur. */
export function normalizeUpmixOptions(u?: Partial<UpmixOptions> | null): UpmixOptions {
  const d = defaultUpmixOptions()
  if (!u) return d
  return {
    mode: u.mode === 'game' || u.mode === 'film' ? u.mode : d.mode,
    centerDb: clampDb(u.centerDb, d.centerDb),
    surroundDb: clampDb(u.surroundDb, d.surroundDb),
    lfeEnabled: typeof u.lfeEnabled === 'boolean' ? u.lfeEnabled : d.lfeEnabled,
  }
}

/** Upmix durumu: kapalı | stereo içerik upmix ediliyor | yerel çok kanal geçiyor. */
export type UpmixStateName = 'off' | 'stereo' | 'native'

/** Motorun anlık durumu (çalışırken ~4 Hz). */
export interface EngineInfo {
  upmix: UpmixStateName
  sourceChannels: number
  sourceRate: number
  /** Upmix'in eklediği gecikme (ms); film modunda ~21 ms. */
  upmixLatencyMs: number
}

export interface Config {
  source: Source
  upmix: boolean
  /** Yoksa varsayılan geçerli. */
  upmixOptions?: UpmixOptions
  outputs: Output[]
  speakers: Speaker[]
  room: Room
  /** Yoksa varsayılan geçerli. */
  processing?: Processing
}

/** Kaynak kanal seviyeleri, dBFS (-90 .. 0). */
export type LevelFrame = Record<LogicalChannel, number>
