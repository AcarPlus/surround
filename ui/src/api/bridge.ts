import type { SurroundApi } from './client'
import {
  defaultAppSettings,
  type AppSettings,
  type CalibrationProgress,
  type CalibrationResult,
  type Config,
  type Device,
  type EngineInfo,
  type EngineState,
  type LevelFrame,
  type PhoneLinkStatus,
  type SinkStatus,
} from './types'

/**
 * WebView2 köprüsü: `window.chrome.webview` üzerinden C# tarafıyla (Surround.App/Bridge) JSON-RPC.
 *
 *   JS -> C#: { id, method, params: unknown[] }
 *   C# -> JS: { id, result } | { id, error: { message, errors? } }
 *   C# -> JS (itme): { event: 'status' | 'levels' | 'engine' | 'engineError' | 'engineState' | 'deviceRejoined' | 'calibration' | 'profileApplied' | 'phoneLink' | 'phoneStart', data }
 */

interface WebViewHost {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
}

declare global {
  interface Window {
    chrome?: { webview?: WebViewHost }
  }
}

export const hasBridge = (): boolean =>
  typeof window !== 'undefined' && typeof window.chrome?.webview?.postMessage === 'function'

/** Motor/doğrulama hatası; `errors` varsa tek tek hata satırlarıdır. */
export class BridgeError extends Error {
  readonly errors: string[]
  constructor(message: string, errors: string[] = []) {
    super(message)
    this.name = 'BridgeError'
    this.errors = errors
  }
}

/** Eksik/bozuk alanlara karşı: bilinmeyen durum `stopped`, `missing` her zaman dizi. */
function normalizeEngineState(d: any): EngineState {
  const state = d?.state === 'running' || d?.state === 'waiting' ? d.state : 'stopped'
  const missing = Array.isArray(d?.missing) ? d.missing.map(String) : []
  return typeof d?.message === 'string' ? { state, missing, message: d.message } : { state, missing }
}

type Pending ={ resolve: (v: unknown) => void; reject: (e: Error) => void }

export function createBridgeApi(): SurroundApi {
  const host = window.chrome!.webview!
  const pending = new Map<number, Pending>()
  const statusListeners = new Set<(s: SinkStatus[]) => void>()
  const levelListeners = new Set<(l: LevelFrame) => void>()
  const errorListeners = new Set<(m: string) => void>()
  const engineListeners = new Set<(i: EngineInfo) => void>()
  const stateListeners = new Set<(s: EngineState) => void>()
  const calibrationListeners = new Set<(p: CalibrationProgress) => void>()
  const profileListeners = new Set<(id: string) => void>()
  const rejoinListeners = new Set<(names: string[]) => void>()
  const phoneListeners = new Set<(s: PhoneLinkStatus) => void>()
  const phoneStartListeners = new Set<() => void>()
  let nextId = 1

  host.addEventListener('message', (e) => {
    let msg: any = e.data
    if (typeof msg === 'string') {
      try {
        msg = JSON.parse(msg)
      } catch {
        return
      }
    }
    if (!msg || typeof msg !== 'object') return
    if (typeof msg.event === 'string') {
      switch (msg.event) {
        case 'status':
          statusListeners.forEach((cb) => cb(msg.data as SinkStatus[]))
          break
        case 'levels':
          levelListeners.forEach((cb) => cb(msg.data as LevelFrame))
          break
        case 'engine':
          engineListeners.forEach((cb) => cb(msg.data as EngineInfo))
          break
        case 'engineError':
          errorListeners.forEach((cb) => cb(String(msg.data)))
          break
        case 'engineState': {
          const s = normalizeEngineState(msg.data)
          stateListeners.forEach((cb) => cb(s))
          break
        }
        case 'calibration':
          calibrationListeners.forEach((cb) => cb(msg.data as CalibrationProgress))
          break
        case 'phoneLink':
          phoneListeners.forEach((cb) => cb(msg.data as PhoneLinkStatus))
          break
        case 'phoneStart':
          phoneStartListeners.forEach((cb) => cb())
          break
        case 'deviceRejoined': {
          const names: string[] = Array.isArray(msg.data?.names) ? msg.data.names.map(String) : []
          if (names.length) rejoinListeners.forEach((cb) => cb(names))
          break
        }
        case 'profileApplied': {
          const id = msg.data && typeof msg.data.id === 'string' ? msg.data.id : null
          if (id) profileListeners.forEach((cb) => cb(id))
          break
        }
      }
      return
    }
    if (typeof msg.id === 'number') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) {
        const errors: string[] = Array.isArray(msg.error.errors) ? msg.error.errors.map(String) : []
        p.reject(new BridgeError(String(msg.error.message ?? 'Bilinmeyen hata'), errors))
      } else {
        p.resolve(msg.result)
      }
    }
  })

  function call<T>(method: string, ...params: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      host.postMessage({ id, method, params })
    })
  }

  const subscribe = <T>(set: Set<T>, cb: T) => {
    set.add(cb)
    return () => {
      set.delete(cb)
    }
  }

  return {
    listDevices: () => call<Device[]>('listDevices'),
    getConfig: () => call<Config>('getConfig'),
    saveConfig: (config) => call<void>('saveConfig', config),
    takeConfigNotice: () => call<{ backupPath: string } | null>('takeConfigNotice'),
    resetConfig: () => call<void>('resetConfig'),
    startWithoutMissing: () => call<void>('startWithoutMissing'),
    openLogFolder: () => call<void>('openLogFolder'),
    getAppSettings: async () => ({ ...defaultAppSettings(), ...(await call<Partial<AppSettings> | null>('getAppSettings')) }),
    saveAppSettings: (settings) => call<void>('saveAppSettings', settings),
    start: () => call<void>('start'),
    stop: () => call<void>('stop'),
    getStatus: () => call<SinkStatus[]>('getStatus'),
    playTone: (deviceId, channel) => call<void>('playTone', deviceId, channel),
    openSoundPanel: () => call<void>('openSoundPanel'),
    onStatus: (cb) => subscribe(statusListeners, cb),
    onLevels: (cb) => subscribe(levelListeners, cb),
    onEngine: (cb) => subscribe(engineListeners, cb),
    onEngineError: (cb) => subscribe(errorListeners, cb),
    getEngineState: async () => normalizeEngineState(await call<unknown>('getEngineState')),
    onEngineState: (cb) => subscribe(stateListeners, cb),
    calibrate: (request) => call<CalibrationResult>('calibrate', request),
    cancelCalibration: () => call<void>('cancelCalibration'),
    onCalibration: (cb) => subscribe(calibrationListeners, cb),
    phoneLinkStart: () => call<PhoneLinkStatus>('phoneLinkStart'),
    phoneLinkStop: () => call<void>('phoneLinkStop'),
    phoneLinkStatus: () => call<PhoneLinkStatus>('phoneLinkStatus'),
    phoneLinkPrompt: (text) => call<void>('phoneLinkPrompt', text),
    onPhoneLink: (cb) => subscribe(phoneListeners, cb),
    onPhoneStart: (cb) => subscribe(phoneStartListeners, cb),
    onProfileApplied: (cb) => subscribe(profileListeners, cb),
    onDeviceRejoined: (cb) => subscribe(rejoinListeners, cb),
  }
}
