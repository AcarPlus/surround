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

export interface Config {
  source: Source
  upmix: boolean
  outputs: Output[]
  speakers: Speaker[]
  room: Room
}

/** Kaynak kanal seviyeleri, dBFS (-90 .. 0). */
export type LevelFrame = Record<LogicalChannel, number>
