import type { SurroundApi } from './client'
import { defaultAppSettings, type AppSettings, type Config, type Device, type EngineInfo, type LevelFrame, type SinkStatus } from './types'

/**
 * WebView2 köprüsü: `window.chrome.webview` üzerinden C# tarafıyla (Surround.App/Bridge) JSON-RPC.
 *
 *   JS -> C#: { id, method, params: unknown[] }
 *   C# -> JS: { id, result } | { id, error: { message, errors? } }
 *   C# -> JS (itme): { event: 'status' | 'levels' | 'engine' | 'engineError', data }
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

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export function createBridgeApi(): SurroundApi {
  const host = window.chrome!.webview!
  const pending = new Map<number, Pending>()
  const statusListeners = new Set<(s: SinkStatus[]) => void>()
  const levelListeners = new Set<(l: LevelFrame) => void>()
  const errorListeners = new Set<(m: string) => void>()
  const engineListeners = new Set<(i: EngineInfo) => void>()
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
  }
}
