import type {
  AppSettings,
  CalibrationProgress,
  CalibrationRequest,
  CalibrationResult,
  CableSetupResult,
  PhoneLinkStatus,
  Config,
  Device,
  EngineInfo,
  EngineState,
  LevelFrame,
  SinkStatus,
  UpdateState,
  VolumeState,
} from './types'
import { createMockApi } from './mock'
import { createBridgeApi, hasBridge } from './bridge'

/**
 * Arayüzün backend ile konuştuğu TEK sınır. Uygulama yalnızca bu arayüzü kullanır;
 * Masaüstü uygulamasında (WebView2) köprü, tarayıcıda (`npm run dev`) sahte veri kullanılır.
 */
export interface SurroundApi {
  listDevices(): Promise<Device[]>
  getConfig(): Promise<Config>
  saveConfig(config: Config): Promise<void>
  /** Açılışta ayar dosyası okunamadıysa (bir kez) yedeğin yolu; yoksa null. */
  takeConfigNotice(): Promise<{ backupPath: string } | null>
  /** Ayarı varsayılana döndürür; eski dosya zaman damgalı yedek olarak kalır. */
  resetConfig(): Promise<void>
  /** Beklemeyi bırakıp mevcut cihazlarla başlatır; eksik cihazdaki hoparlörler sessiz kalır. */
  startWithoutMissing(): Promise<void>
  /** Günlük (log) klasörünü Gezgin'de açar. */
  openLogFolder(): Promise<void>
  /** Windows entegrasyonu ayarları (varsayılan çıkışı çevirme, otomatik başlatma, tepsi). */
  getAppSettings(): Promise<AppSettings>
  saveAppSettings(settings: AppSettings): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  getStatus(): Promise<SinkStatus[]>
  /** deviceChannel 1 tabanlıdır. */
  playTone(deviceId: string, channel: number): Promise<void>
  /** Ses turu: motorda hareketli sentez kaynağı başlatır (kaynak sesi susar); süreyi (sn) döner. Motor çalışmalı. */
  demoStart(scene: 'orbit' | 'pingpong' | 'flyby' | 'speakers'): Promise<number>
  demoStop(): Promise<void>
  /** Windows ses denetim masasını açar (mmsys.cpl); VB-Cable'ı 7.1 yapmak için. */
  openSoundPanel(): Promise<void>
  /**
   * Tek tıkla VB-Cable: yoksa resmi siteden indirip imzasını doğrular ve kurar (Windows bir kez yönetici onayı sorar),
   * 7.1'e ayarlar, Surround çalışırken varsayılan çıkış yapar. 'reboot': kuruldu ama Windows yeniden başlamalı.
   */
  cableSetup(): Promise<CableSetupResult>
  /** Çalışırken ~1 sn aralıkla çağrılır. Dönen fonksiyon aboneliği iptal eder. */
  onStatus(cb: (status: SinkStatus[]) => void): () => void
  /** Kaynak seviye ölçerleri için (tasarım aşamasında eklendi). */
  onLevels(cb: (levels: LevelFrame) => void): () => void
  /** Motor durumu (upmix durumu, kaynak formatı), durum örnekleriyle birlikte; durunca bir kez `upmix: 'off'`. */
  onEngine(cb: (info: EngineInfo) => void): () => void
  /** Çalışma sırasında motorun bildirdiği hatalar (yakalama/oynatma akışı kopması vb.). */
  onEngineError(cb: (message: string) => void): () => void
  /** Anlık çalışma durumu (açılışta; sonrası `onEngineState` ile gelir). */
  getEngineState(): Promise<EngineState>
  /** running / waiting (cihaz bekleniyor) / stopped geçişleri. */
  onEngineState(cb: (state: EngineState) => void): () => void
  /**
   * Mikrofonla ölçüm (docs/kalibrasyon.md). Uzun sürer; motor çalışıyorsa backend durdurup sonra yeniden başlatır.
   * İptal edilirse "Kalibrasyon iptal edildi." ile reddeder.
   */
  calibrate(request: CalibrationRequest): Promise<CalibrationResult>
  cancelCalibration(): Promise<void>
  onCalibration(cb: (p: CalibrationProgress) => void): () => void
  /** Telefon mikrofonu: yerel ağda HTTPS bağlantısını açar (QR adresi döner); açıksa aynısını döner. */
  phoneLinkStart(): Promise<PhoneLinkStatus>
  phoneLinkStop(): Promise<void>
  /** Güvenlik duvarına tek kural ekler (yerel ağ, Surround portları); Windows bir kez yönetici onayı sorar. */
  phoneLinkAllowFirewall(): Promise<PhoneLinkStatus>
  phoneLinkStatus(): Promise<PhoneLinkStatus>
  /** Telefon ekranında gösterilecek yönerge (ör. sonraki konum); null temizler. */
  phoneLinkPrompt(text: string | null): Promise<void>
  onPhoneLink(cb: (s: PhoneLinkStatus) => void): () => void
  /** Telefonda "Ölçümü başlat"a basıldı. */
  onPhoneStart(cb: () => void): () => void
  /** Tepsi menüsünden bir profil seçildi; backend onu kayıtlı yapılandırmaya zaten uyguladı. */
  onProfileApplied(cb: (id: string) => void): () => void
  /** "Eksik cihaz olmadan başlat"tan sonra eksik cihaz geri geldi ve motora eklendi (cihaz adları). */
  onDeviceRejoined(cb: (names: string[]) => void): () => void
  /** Ana ses düzeyi = loopback kaynağının Windows ses düzeyi; motor onu uygular. */
  getVolume(): Promise<VolumeState>
  /** 0..1; 0'dan büyükse sessizi de kaldırır. */
  setVolume(level: number): Promise<VolumeState>
  setMute(muted: boolean): Promise<VolumeState>
  /** Ses tuşları, görev çubuğu ya da kaynak değişimi. */
  onVolume(cb: (v: VolumeState) => void): () => void
  /** Otomatik güncelleme: açılıştan kısa süre sonra ve birkaç saatte bir arka planda denetlenir ve indirilir. */
  getUpdate(): Promise<UpdateState>
  /** Açılış ölçümü: sayfanın bir adıma ulaştığını bildirir ("paint" ilk çizim, "init" veriler yüklendi); günlüğe yazılır. */
  startupMark(step: string): Promise<void>
  checkUpdate(): Promise<UpdateState>
  /** İndirilen sürümü kurar: uygulama kapanır, güncellenir ve yeniden açılır. */
  applyUpdate(): Promise<void>
  onUpdate(cb: (u: UpdateState) => void): () => void
}

export const api: SurroundApi = hasBridge() ? createBridgeApi() : createMockApi()
