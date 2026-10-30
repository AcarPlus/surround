import type { AppSettings, Config, Device, EngineInfo, LevelFrame, SinkStatus } from './types'
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
  /** Windows entegrasyonu ayarları (varsayılan çıkışı çevirme, otomatik başlatma, tepsi). */
  getAppSettings(): Promise<AppSettings>
  saveAppSettings(settings: AppSettings): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  getStatus(): Promise<SinkStatus[]>
  /** deviceChannel 1 tabanlıdır. */
  playTone(deviceId: string, channel: number): Promise<void>
  /** Windows ses denetim masasını açar (mmsys.cpl); VB-Cable'ı 7.1 yapmak için. */
  openSoundPanel(): Promise<void>
  /** Çalışırken ~1 sn aralıkla çağrılır. Dönen fonksiyon aboneliği iptal eder. */
  onStatus(cb: (status: SinkStatus[]) => void): () => void
  /** Kaynak seviye ölçerleri için (tasarım aşamasında eklendi). */
  onLevels(cb: (levels: LevelFrame) => void): () => void
  /** Motor durumu (upmix durumu, kaynak formatı), durum örnekleriyle birlikte; durunca bir kez `upmix: 'off'`. */
  onEngine(cb: (info: EngineInfo) => void): () => void
  /** Çalışma sırasında motorun bildirdiği hatalar (yakalama/oynatma akışı kopması vb.). */
  onEngineError(cb: (message: string) => void): () => void
}

export const api: SurroundApi = hasBridge() ? createBridgeApi() : createMockApi()
