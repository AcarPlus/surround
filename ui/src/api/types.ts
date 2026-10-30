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

export interface Config {
  source: Source
  upmix: boolean
  outputs: Output[]
  speakers: Speaker[]
  room: Room
  /** Yoksa varsayılan geçerli. */
  processing?: Processing
}

/** Kaynak kanal seviyeleri, dBFS (-90 .. 0). */
export type LevelFrame = Record<LogicalChannel, number>
