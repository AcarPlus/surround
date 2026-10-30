import { create } from 'zustand'
import { api } from '../api/client'
import {
  LOGICAL_CHANNELS,
  type Config,
  type Device,
  type LogicalChannel,
  type Output,
  type Point,
  type Processing,
  defaultProcessing,
  normalizeProcessing,
  type Room,
  type SinkStatus,
  type Source,
  type Speaker,
} from '../api/types'
import {
  clamp,
  clampToRoom,
  computeAuto,
  presetLayout,
  round,
  type PresetId,
} from '../lib/geometry'
import { matchSoundPreset, soundPresetPatch } from '../lib/presets'

export type Screen = 'room' | 'devices' | 'source' | 'sound' | 'calibration'
export type Theme = 'dark' | 'light'
export type PresetChoice = PresetId | 'custom'
export type RunState = 'stopped' | 'starting' | 'running'
export const LISTENER_ID = 'listener'

export interface AutoFlags {
  delay: boolean
  gain: boolean
}

interface State {
  ready: boolean
  devices: Device[]
  source: Source
  upmix: boolean
  outputs: Output[]
  speakers: Speaker[]
  room: Room
  processing: Processing
  /** Hoparlör başına gecikme/kazanç otomatik mi (yalnızca arayüz durumu). */
  auto: Record<string, AutoFlags>

  preset: PresetChoice
  lowLatency: boolean
  theme: Theme
  screen: Screen
  /** Hoparlör id'si, 'listener' ya da null. */
  selection: string | null
  runState: RunState
  status: SinkStatus[]
  toast: string | null

  init: () => Promise<void>
  setTheme: (t: Theme) => void
  setScreen: (s: Screen) => void
  select: (id: string | null) => void
  toggleRun: () => Promise<void>
  setPreset: (p: PresetChoice) => void
  setLowLatency: (v: boolean) => void
  setRoomSize: (widthM: number, depthM: number) => void
  moveListener: (x: number, y: number) => void
  moveSpeaker: (id: string, x: number, y: number) => void
  nudgeSelected: (dx: number, dy: number) => void
  updateSpeaker: (id: string, patch: Partial<Speaker>) => void
  setMix: (id: string, ch: LogicalChannel, gain: number) => void
  setAuto: (id: string, patch: Partial<AutoFlags>) => void
  autoAll: () => void
  addSpeaker: () => void
  removeSpeaker: (id: string) => void
  setOutput: (deviceId: string, patch: Partial<Output>) => void
  addOutput: (deviceId: string) => void
  setSource: (patch: Partial<Source>) => void
  setUpmix: (v: boolean) => void
  /** Ses işleme alanlarını değiştirir; ses karakterini etkileyen bir alan değişirse etiket 'Özel' olur. */
  setProcessing: (patch: Partial<Processing>) => void
  applySoundPreset: (id: string) => void
  playTone: (id: string) => Promise<void>
  showToast: (msg: string, ms?: number) => void
}

const initialTheme = (): Theme => {
  try {
    return localStorage.getItem('surround.theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** Otomatik işaretli hoparlörlerin gecikme/kazanç değerlerini geometriden yeniden hesaplar. */
function recalc(speakers: Speaker[], listener: Point, auto: Record<string, AutoFlags>): Speaker[] {
  const { byId } = computeAuto(speakers, listener)
  return speakers.map((s) => {
    const a = auto[s.id]
    const v = byId[s.id]
    if (!a || !v) return s
    const delayMs = a.delay ? round(v.delayMs, 2) : s.delayMs
    const gainDb = a.gain ? round(v.gainDb, 2) : s.gainDb
    return delayMs === s.delayMs && gainDb === s.gainDb ? s : { ...s, delayMs, gainDb }
  })
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Hata mesajını kullanıcıya gösterilecek tek satıra çevirir (köprü hataları satır listesi taşıyabilir). */
function describeError(e: unknown): string {
  const errors = (e as { errors?: unknown })?.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const first = String(errors[0])
    return errors.length > 1 ? `${first} (+${errors.length - 1} hata daha)` : first
  }
  return e instanceof Error ? e.message : String(e)
}

export const useStore = create<State>()((set, get) => {
  /** Yapılandırmayı değiştiren her eylem buradan geçer: yeniden hesapla + gecikmeli kaydet. */
  const commit = (patch: Partial<State>, delayMs = 400) => {
    const cur = get()
    const next = { ...cur, ...patch }
    const speakers = recalc(next.speakers, next.room.listener, next.auto)
    set({ ...patch, speakers })
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      api.saveConfig(buildConfig(get())).catch((e) => get().showToast(describeError(e), 6000))
    }, delayMs)
  }

  /** Kaydedilecek belge: hoparlörlerin `auto` bayrakları da içinde taşınır. */
  const buildConfig = (s: State): Config => ({
    source: s.source,
    upmix: s.upmix,
    outputs: s.outputs,
    speakers: s.speakers.map((sp) => ({ ...sp, auto: s.auto[sp.id] ?? { delay: true, gain: true } })),
    room: s.room,
    processing: s.processing,
  })

  const ensureOutput = (outputs: Output[], deviceId: string): Output[] =>
    outputs.some((o) => o.deviceId === deviceId)
      ? outputs
      : [...outputs, { deviceId, latencyMs: 0, bufferMs: 40 }]

  return {
    ready: false,
    devices: [],
    source: { deviceId: '', mode: 'loopback' },
    upmix: false,
    outputs: [],
    speakers: [],
    room: { widthM: 5, depthM: 4.5, listener: { x: 2.5, y: 2.3 } },
    processing: defaultProcessing(),
    auto: {},

    preset: 'custom',
    lowLatency: false,
    theme: initialTheme(),
    screen: 'room',
    selection: null,
    runState: 'stopped',
    status: [],
    toast: null,

    async init() {
      const [devices, cfg] = await Promise.all([api.listDevices(), api.getConfig()])
      const auto = Object.fromEntries(
        cfg.speakers.map((s) => [s.id, s.auto ?? { delay: true, gain: true }]),
      )
      const speakers = cfg.speakers.map(({ auto: _auto, ...rest }) => rest)
      set({
        devices,
        source: cfg.source,
        upmix: cfg.upmix,
        outputs: cfg.outputs,
        speakers: recalc(speakers, cfg.room.listener, auto),
        room: cfg.room,
        processing: normalizeProcessing(cfg.processing),
        auto,
        preset: speakers.length === 0 ? 'custom' : '5.1',
        ready: true,
      })
      api.onStatus((status) => set({ status }))
      api.onEngineError((msg) => get().showToast(msg, 7000))
    },

    setTheme(theme) {
      set({ theme })
      document.documentElement.dataset.theme = theme
      try {
        localStorage.setItem('surround.theme', theme)
      } catch {
        /* yoksay */
      }
    },
    setScreen: (screen) => set({ screen }),
    select: (selection) => set({ selection }),

    async toggleRun() {
      const { runState } = get()
      if (runState === 'starting') return
      if (runState === 'running') {
        try {
          await api.stop()
        } catch (e) {
          get().showToast(describeError(e), 6000)
        }
        set({ runState: 'stopped', status: [] })
        return
      }
      set({ runState: 'starting' })
      clearTimeout(saveTimer)
      try {
        await api.saveConfig(buildConfig(get()))
        await api.start()
        set({ runState: 'running' })
      } catch (e) {
        set({ runState: 'stopped', status: [] })
        get().showToast(describeError(e), 7000)
      }
    },

    setPreset(preset) {
      if (preset === 'custom') {
        set({ preset })
        return
      }
      const { room, devices, outputs, lowLatency } = get()
      const layout = presetLayout(preset, room.listener)
      // Çok kanallı cihaz varsa kanalları sırayla ona, yoksa yerel cihazlara dağıt.
      const renders = devices.filter((d) => d.flow === 'render' && !(lowLatency && d.kind === 'network'))
      const multi = renders.find((d) => d.channels >= layout.length) ?? null
      const pool = multi ? [multi] : renders
      const slots: { dev: Device; ch: number }[] = []
      for (const d of pool) for (let c = 1; c <= d.channels; c++) slots.push({ dev: d, ch: c })
      const names: Record<LogicalChannel, string> = {
        FL: 'Ön sol',
        FR: 'Ön sağ',
        FC: 'Orta',
        LFE: 'Sub',
        BL: 'Arka sol',
        BR: 'Arka sağ',
        SL: 'Yan sol',
        SR: 'Yan sağ',
      }
      const speakers: Speaker[] = layout.map((p, i) => {
        const slot = slots[i] ?? slots[slots.length - 1]
        const pos = clampToRoom(p, room)
        return {
          id: `spk-${Date.now().toString(36)}-${i}`,
          name: names[p.channel],
          outputDeviceId: slot.dev.id,
          deviceChannel: slot.ch,
          source: { [p.channel]: 1 },
          delayMs: 0,
          gainDb: 0,
          mute: false,
          x: round(pos.x, 3),
          y: round(pos.y, 3),
        }
      })
      let outs = outputs
      for (const s of speakers) outs = ensureOutput(outs, s.outputDeviceId)
      commit({
        speakers,
        outputs: outs,
        preset,
        selection: null,
        auto: Object.fromEntries(speakers.map((s) => [s.id, { delay: true, gain: true }])),
      })
    },

    setLowLatency: (lowLatency) => set({ lowLatency }),

    setRoomSize(widthM, depthM) {
      const w = clamp(widthM, 2, 20)
      const d = clamp(depthM, 2, 20)
      const { speakers, room } = get()
      const room2: Room = {
        widthM: w,
        depthM: d,
        listener: clampToRoom(room.listener, { widthM: w, depthM: d }),
      }
      commit({
        room: room2,
        speakers: speakers.map((s) => ({ ...s, ...clampToRoom(s, room2) })),
      })
    },

    moveListener(x, y) {
      const { room } = get()
      const p = clampToRoom({ x: round(x, 2), y: round(y, 2) }, room)
      commit({ room: { ...room, listener: p } })
    },

    moveSpeaker(id, x, y) {
      const { room, speakers } = get()
      const p = clampToRoom({ x: round(x, 2), y: round(y, 2) }, room)
      commit({
        speakers: speakers.map((s) => (s.id === id ? { ...s, ...p } : s)),
        preset: 'custom',
      })
    },

    nudgeSelected(dx, dy) {
      const { selection, room, speakers } = get()
      if (!selection) return
      if (selection === LISTENER_ID) {
        get().moveListener(room.listener.x + dx, room.listener.y + dy)
        return
      }
      const s = speakers.find((v) => v.id === selection)
      if (s) get().moveSpeaker(s.id, s.x + dx, s.y + dy)
    },

    updateSpeaker(id, patch) {
      const { speakers, outputs } = get()
      let outs = outputs
      if (patch.outputDeviceId) outs = ensureOutput(outs, patch.outputDeviceId)
      // EQ sürüklemesi canlı uygulanır; kayıt sıklığını sınırla.
      const live = 'eq' in patch || 'eqPreset' in patch
      commit({ speakers: speakers.map((s) => (s.id === id ? { ...s, ...patch } : s)), outputs: outs }, live ? 150 : 400)
    },

    setMix(id, ch, gain) {
      const { speakers } = get()
      commit({
        speakers: speakers.map((s) => {
          if (s.id !== id) return s
          const source = { ...s.source }
          if (gain <= 0) delete source[ch]
          else source[ch] = round(clamp(gain, 0, 1), 2)
          return { ...s, source }
        }),
      })
    },

    setAuto(id, patch) {
      const { auto } = get()
      commit({ auto: { ...auto, [id]: { ...(auto[id] ?? { delay: true, gain: true }), ...patch } } })
    },

    autoAll() {
      const { speakers } = get()
      commit({ auto: Object.fromEntries(speakers.map((s) => [s.id, { delay: true, gain: true }])) })
    },

    addSpeaker() {
      const { speakers, devices, room, auto, outputs, lowLatency } = get()
      const dev = devices.find((d) => d.flow === 'render' && !(lowLatency && d.kind === 'network'))
      if (!dev) return
      const usedCh = new Set(speakers.filter((s) => s.outputDeviceId === dev.id).map((s) => s.deviceChannel))
      let ch = 1
      while (usedCh.has(ch) && ch < dev.channels) ch++
      const usedLogical = new Set(speakers.flatMap((s) => Object.keys(s.source)))
      const logical = LOGICAL_CHANNELS.find((c) => !usedLogical.has(c))
      const id = `spk-${Date.now().toString(36)}`
      const p = clampToRoom({ x: room.listener.x + 1, y: room.listener.y - 1 }, room)
      const sp: Speaker = {
        id,
        name: `Hoparlör ${speakers.length + 1}`,
        outputDeviceId: dev.id,
        deviceChannel: ch,
        source: logical ? { [logical]: 1 } : {},
        delayMs: 0,
        gainDb: 0,
        mute: false,
        x: p.x,
        y: p.y,
      }
      commit({
        speakers: [...speakers, sp],
        auto: { ...auto, [id]: { delay: true, gain: true } },
        outputs: ensureOutput(outputs, dev.id),
        selection: id,
        preset: 'custom',
      })
    },

    removeSpeaker(id) {
      const { speakers, auto, selection } = get()
      const rest = { ...auto }
      delete rest[id]
      commit({
        speakers: speakers.filter((s) => s.id !== id),
        auto: rest,
        selection: selection === id ? null : selection,
        preset: 'custom',
      })
    },

    setOutput(deviceId, patch) {
      commit({ outputs: get().outputs.map((o) => (o.deviceId === deviceId ? { ...o, ...patch } : o)) })
    },
    addOutput(deviceId) {
      commit({ outputs: ensureOutput(get().outputs, deviceId) })
    },

    setSource(patch) {
      const { source, devices } = get()
      const next = { ...source, ...patch }
      // Mod değişince akışa uymayan cihazı ilk uygun olanla değiştir.
      const flow = next.mode === 'capture' ? 'capture' : 'render'
      const cur = devices.find((d) => d.id === next.deviceId)
      if (!cur || cur.flow !== flow) {
        const fallback = devices.find((d) => d.flow === flow && (flow === 'capture' || d.isDefault)) ??
          devices.find((d) => d.flow === flow)
        next.deviceId = fallback?.id ?? ''
      }
      commit({ source: next })
    },
    setUpmix: (upmix) => commit({ upmix }),

    setProcessing(patch) {
      const cur = get().processing
      const changesSound = Object.keys(patch).some((k) => k !== 'enabled' && k !== 'limiter' && k !== 'preset')
      const next: Processing = {
        ...cur,
        ...patch,
        preset: patch.preset ?? cur.preset,
      }
      if (changesSound && patch.preset === undefined) next.preset = matchSoundPreset(next)
      commit({ processing: next }, 150)
    },

    applySoundPreset(id) {
      const patch = soundPresetPatch(id)
      if (patch) commit({ processing: { ...get().processing, ...patch } }, 150)
    },

    async playTone(id) {
      const s = get().speakers.find((v) => v.id === id)
      if (!s) return
      get().showToast(`Test sesi: ${s.name} (kanal ${s.deviceChannel})`)
      try {
        await api.playTone(s.outputDeviceId, s.deviceChannel)
      } catch (e) {
        get().showToast(describeError(e), 6000)
      }
    },

    showToast(msg, ms = 2200) {
      set({ toast: msg })
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null })
      }, ms)
    },
  }
})

/** Seçili hoparlör (dinleyici seçiliyse null). */
export const selectSpeaker = (s: State): Speaker | null =>
  s.selection && s.selection !== LISTENER_ID ? (s.speakers.find((v) => v.id === s.selection) ?? null) : null
