import type { SurroundApi } from './client'
import {
  LOGICAL_CHANNELS,
  defaultProcessing,
  type Config,
  type Device,
  type LevelFrame,
  type LogicalChannel,
  type SinkStatus,
  type Speaker,
} from './types'
import { computeAuto, presetLayout, round } from '../lib/geometry'

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function buildDevices(): Device[] {
  const devices: Device[] = [
    { id: 'realtek-spk', name: 'Hoparlör (Realtek)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: true },
    { id: 'usb-headset', name: 'Kulaklık (USB)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
    { id: 'hdmi-nvidia', name: 'HDMI (NVIDIA)', kind: 'multichannel', flow: 'render', channels: 8, sampleRate: 48000, isDefault: false },
    { id: 'phone-salon', name: 'Salon telefonu', kind: 'network', flow: 'render', channels: 2, sampleRate: 44100, isDefault: false },
    { id: 'vb-cable', name: 'CABLE Output (VB-Audio Virtual Cable)', kind: 'multichannel', flow: 'capture', channels: 8, sampleRate: 48000, isDefault: false },
    { id: 'vb-cable-in-16', name: 'CABLE In 16ch (VB-Audio Virtual Cable)', kind: 'multichannel', flow: 'render', channels: 8, sampleRate: 48000, isDefault: false },
    { id: 'vb-cable-in', name: 'CABLE Input (VB-Audio Virtual Cable)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
  ]
  if (typeof location !== 'undefined') {
    // Önizleme: ?nocable -> VB-Cable yokmuş gibi (kurulum adımlarını görmek için).
    if (location.search.includes('nocable')) return devices.filter((d) => !d.name.includes('CABLE'))
    // ?cable2ch -> CABLE In 16ch Windows'ta 7.1 yapılmamış (2 kanal).
    if (location.search.includes('cable2ch')) {
      return devices.map((d) => (d.id === 'vb-cable-in-16' ? { ...d, channels: 2 } : d))
    }
  }
  return devices
}

function initialConfig(): Config {
  const room = { widthM: 5, depthM: 4.5, listener: { x: 2.5, y: 2.3 } }
  const map: Record<string, { dev: string; ch: number; name: string }> = {
    FL: { dev: 'realtek-spk', ch: 1, name: 'Ön sol' },
    FR: { dev: 'realtek-spk', ch: 2, name: 'Ön sağ' },
    FC: { dev: 'hdmi-nvidia', ch: 1, name: 'Orta' },
    LFE: { dev: 'hdmi-nvidia', ch: 2, name: 'Sub' },
    BL: { dev: 'phone-salon', ch: 1, name: 'Arka sol' },
    BR: { dev: 'phone-salon', ch: 2, name: 'Arka sağ' },
  }
  const speakers: Speaker[] = presetLayout('5.1', room.listener).map((p, i) => {
    const m = map[p.channel]
    return {
      id: `spk-${i + 1}`,
      name: m.name,
      outputDeviceId: m.dev,
      deviceChannel: m.ch,
      source: { [p.channel]: 1 },
      delayMs: 0,
      gainDb: 0,
      mute: false,
      x: round(p.x, 3),
      y: round(p.y, 3),
    }
  })
  const { byId } = computeAuto(speakers, room.listener)
  for (const s of speakers) {
    s.delayMs = round(byId[s.id].delayMs, 2)
    s.gainDb = round(byId[s.id].gainDb, 2)
  }
  return {
    source: { deviceId: 'vb-cable', mode: 'capture' },
    upmix: true,
    outputs: [
      { deviceId: 'realtek-spk', latencyMs: 0, bufferMs: 40 },
      { deviceId: 'hdmi-nvidia', latencyMs: 0, bufferMs: 40 },
      { deviceId: 'phone-salon', latencyMs: 180, bufferMs: 200 },
    ],
    speakers,
    room,
    processing: defaultProcessing(),
  }
}

export function createMockApi(): SurroundApi {
  const devices = buildDevices()
  let config = initialConfig()
  let running = false

  const counters = new Map<string, { under: number; over: number }>()
  const statusListeners = new Set<(s: SinkStatus[]) => void>()
  const levelListeners = new Set<(l: LevelFrame) => void>()
  const levels = Object.fromEntries(LOGICAL_CHANNELS.map((c) => [c, -90])) as LevelFrame
  const energy = Object.fromEntries(LOGICAL_CHANNELS.map((c) => [c, rand(0.3, 0.7)])) as Record<LogicalChannel, number>

  function snapshot(): SinkStatus[] {
    return config.outputs.map((o) => {
      const dev = devices.find((d) => d.id === o.deviceId)
      const c = counters.get(o.deviceId) ?? { under: 0, over: 0 }
      const isNet = dev?.kind === 'network'
      // Ağ cihazı arada bir tampon kaçırır.
      if (isNet && Math.random() < 0.04) c.under += 1
      if (Math.random() < 0.01) c.over += 1
      counters.set(o.deviceId, c)
      const spread = isNet ? o.bufferMs * 0.18 : o.bufferMs * 0.08
      return {
        deviceId: o.deviceId,
        fillMs: round(Math.max(0, o.bufferMs * 0.92 + rand(-spread, spread)), 1),
        corrPpm: round(rand(-1, 1) * (isNet ? 38 : 6) + (isNet ? 22 : 2), 1),
        underruns: c.under,
        overruns: c.over,
      }
    })
  }

  setInterval(() => {
    if (!running) return
    const s = snapshot()
    statusListeners.forEach((cb) => cb(s))
  }, 1000)

  setInterval(() => {
    if (!running && LOGICAL_CHANNELS.every((c) => levels[c] <= -89)) return
    const surround = config.upmix || config.source.deviceId === 'vb-cable'
    for (const c of LOGICAL_CHANNELS) {
      if (!running) {
        levels[c] = Math.max(-90, levels[c] - 6)
        continue
      }
      energy[c] = Math.min(1, Math.max(0, energy[c] + rand(-0.18, 0.18)))
      const base = c === 'LFE' ? -34 : c === 'FC' ? -22 : c === 'FL' || c === 'FR' ? -18 : surround ? -30 : -44
      levels[c] = round(base + energy[c] * 22 + rand(-2, 2) - 8, 1)
    }
    const frame = { ...levels }
    levelListeners.forEach((cb) => cb(frame))
  }, 90)

  return {
    async listDevices() {
      await wait(120)
      return devices.map((d) => ({ ...d }))
    },
    async getConfig() {
      await wait(120)
      return structuredClone(config)
    },
    async saveConfig(c) {
      config = structuredClone(c)
    },
    async start() {
      await wait(450)
      running = true
      const s = snapshot()
      statusListeners.forEach((cb) => cb(s))
    },
    async stop() {
      await wait(150)
      running = false
      counters.clear()
    },
    async getStatus() {
      return running ? snapshot() : []
    },
    async playTone(deviceId, channel) {
      console.info('[mock] playTone', deviceId, channel)
      await wait(900)
    },
    async openSoundPanel() {
      console.info('[mock] openSoundPanel')
    },
    onStatus(cb) {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    onLevels(cb) {
      levelListeners.add(cb)
      return () => levelListeners.delete(cb)
    },
    onEngineError() {
      return () => {}
    },
  }
}
