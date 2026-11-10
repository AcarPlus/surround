// Motor yapılandırmasını (C# Surround.Engine) yansıtan tipler.
// Backend bağlandığında bu dosya tek doğruluk kaynağı olarak kalır.

export type LogicalChannel =
  | 'FL'
  | 'FR'
  | 'FC'
  | 'LFE'
  | 'BL'
  | 'BR'
  | 'SL'
  | 'SR'
  | 'TFL'
  | 'TFR'
  | 'TBL'
  | 'TBR'

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
  'TFL',
  'TFR',
  'TBL',
  'TBR',
]

/** Üst şeritler (kaynaktan her zaman türetilir). */
export const HEIGHT_CHANNELS: readonly LogicalChannel[] = ['TFL', 'TFR', 'TBL', 'TBR']

export const isHeightChannel = (c: LogicalChannel): boolean => HEIGHT_CHANNELS.includes(c)

/** Kullanıcıya gösterilen Türkçe kanal etiketleri. */
export const CHANNEL_LABELS: Record<LogicalChannel, string> = {
  FL: 'Ön sol',
  FR: 'Ön sağ',
  FC: 'Orta',
  LFE: 'Sub (LFE)',
  BL: 'Arka sol',
  BR: 'Arka sağ',
  SL: 'Yan sol',
  SR: 'Yan sağ',
  TFL: 'Üst ön sol',
  TFR: 'Üst ön sağ',
  TBL: 'Üst arka sol',
  TBR: 'Üst arka sağ',
}

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
  /** Yalnızca arayüz: rol kimliği (bkz. lib/roles.ts, docs/duzen.md). Motor yok sayar. */
  role?: string
  /** Üst (tavan/yükseklik) hoparlörü; "Özel (haritadan)" rolünde üst şeritleri seçtirir. Motor yok sayar. */
  elevated?: boolean
  /** Yalnızca arayüz: gecikme/kazanç mikrofon ölçümünden geldiyse ölçüm zamanı (ISO). Motor yok sayar. */
  calibratedAt?: string
}

export type DeviceKind = 'local' | 'network' | 'multichannel' | 'bluetooth'

/** Yüksek gecikmeli (ağ / Bluetooth) cihaz: düşük gecikme modunda çalmaz. */
export const isHighLatencyKind = (k: DeviceKind | undefined): boolean => k === 'network' || k === 'bluetooth'

/** Bluetooth çıkışlar için varsayılan tampon (ms). */
export const BLUETOOTH_BUFFER_MS = 150
export type DeviceFlow = 'render' | 'capture'

export interface Device {
  id: string
  name: string
  kind: DeviceKind
  flow: DeviceFlow
  channels: number
  sampleRate: number
  isDefault: boolean
  /** Bluetooth Hands-Free (HFP) uç noktası: düşük kalite, mono. */
  handsFree?: boolean
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
  /** Üst şerit (TFL/TFR/TBL/TBR) seviyesi, dB -24..+6. */
  heightDb: number
}

export const UPMIX_DB_MIN = -12
export const UPMIX_DB_MAX = 6
export const HEIGHT_DB_MIN = -24
export const HEIGHT_DB_MAX = 6

export const defaultUpmixOptions = (): UpmixOptions => ({
  mode: 'film',
  centerDb: 0,
  surroundDb: 0,
  lfeEnabled: true,
  heightDb: -3,
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
    heightDb:
      typeof u.heightDb === 'number' && Number.isFinite(u.heightDb)
        ? Math.min(HEIGHT_DB_MAX, Math.max(HEIGHT_DB_MIN, u.heightDb))
        : d.heightDb,
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

/**
 * Profil: tek tıkla uygulanan ses işleme + upmix takımı (Film, Oyun, Müzik, kullanıcı profilleri).
 * Config kökünde `profiles` olarak saklanır; motor bilinmeyen kök alanları olduğu gibi korur.
 */
export interface Profile {
  id: string
  name: string
  /** Yerleşik profiller silinemez, yalnızca varsayılana döndürülür. */
  builtin: boolean
  processing: Processing
  upmix: boolean
  upmixOptions: UpmixOptions
}

/** Uygulama (Windows entegrasyonu) ayarları; yapılandırma belgesinden ayrı saklanır. */
export interface AppSettings {
  /** Başlatınca Windows varsayılan çıkışını kaynak cihaza (VB-Cable) çevir, durdurunca geri al. */
  switchDefaultDevice: boolean
  startWithWindows: boolean
  startEngineOnLaunch: boolean
  minimizeToTray: boolean
}

export const defaultAppSettings = (): AppSettings => ({
  switchDefaultDevice: true,
  startWithWindows: false,
  startEngineOnLaunch: false,
  minimizeToTray: true,
})

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
  /** Profiller (yerleşik + kullanıcı); yoksa yerleşikler oluşturulur. */
  profiles?: Profile[]
  /** Etkin profilin kimliği; yoksa profil seçili değil. */
  activeProfileId?: string
  /** Yalnızca arayüz: kurulum sihirbazı tamamlandı mı (ilk açılış ekranı için). */
  setupDone?: boolean
  /** Yalnızca arayüz: son kalibrasyon özeti. */
  lastCalibration?: { at: string; micDeviceId: string; speakers: number }
}

/* ---------- Mikrofonla kalibrasyon (docs/kalibrasyon.md) ---------- */

export interface CalibrationRequest {
  /** Kayıt (capture) cihazı; `micLoopback` ise bir çıkış cihazının loopback'i (deneme amaçlı). */
  micDeviceId: string
  micLoopback?: boolean
  speakerIds: string[]
  /** Zaman ve seviye referansı; yoksa ilk hoparlör. */
  referenceSpeakerId?: string
  /** Bas bandında ölçülecek hoparlörler (subwoofer). */
  lowBandSpeakerIds?: string[]
  /** Her hoparlör kaç kez ölçülsün (medyan alınır). */
  repeats?: number
  /** Süpürme tepe seviyesi, dBFS. */
  levelDb?: number
}

export type CalibrationPhase = 'preparing' | 'noise' | 'measuring' | 'analyzing' | 'done'

export interface CalibrationProgress {
  phase: CalibrationPhase
  speakerId?: string
  index: number
  total: number
  message: string
}

export interface SpeakerMeasurement {
  speakerId: string
  /** Varış bulundu ve sinyal yeterince güçlü. */
  ok: boolean
  /** Referans hoparlöre göre varış (ms); hoparlörün kendi gecikmesi hariç. */
  arrivalMs: number
  /** Referansa göre seviye (dB); hoparlörün kendi kazancı hariç. */
  levelDb: number
  snrDb: number
  /** Tekrarlar arası en büyük fark (ms). */
  spreadMs: number
  /** Bas bandında ölçüldü (zamanlama daha az güvenilir). */
  lowBand: boolean
  message?: string
}

export interface CalibrationResult {
  referenceSpeakerId: string
  micDeviceId: string
  noiseFloorDb: number
  micClipped: boolean
  speakers: SpeakerMeasurement[]
}

/** Kaynak kanal seviyeleri, dBFS (-90 .. 0). Eski motorlarda üst şeritler eksik olabilir; okurken `?? -90` kullan. */
export type LevelFrame = Record<LogicalChannel, number>
