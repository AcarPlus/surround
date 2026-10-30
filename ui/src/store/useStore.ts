import { create } from 'zustand'
import { api } from '../api/client'
import {
  LOGICAL_CHANNELS,
  isHeightChannel,
  type Config,
  type Device,
  type EngineInfo,
  type LogicalChannel,
  type Output,
  type Point,
  type Processing,
  type Profile,
  defaultProcessing,
  normalizeProcessing,
  type Room,
  type SinkStatus,
  type Source,
  type Speaker,
  type UpmixOptions,
  defaultUpmixOptions,
  normalizeUpmixOptions,
} from '../api/types'
import { clamp, clampToRoom, computeAuto, round, type PresetId } from '../lib/geometry'
import { assignExisting, layoutSlots, type LayoutSpec } from '../lib/layout'
import { ROLE_CUSTOM_MANUAL, ROLE_CUSTOM_MAP, computeMapSource, roleDef, rolePatch } from '../lib/roles'
import { matchSoundPreset, soundPresetPatch } from '../lib/presets'
import {
  builtinProfile,
  cleanProfileName,
  isProfileModified,
  newProfileId,
  normalizeProfiles,
  profilePatch,
  snapshotState,
} from '../lib/profiles'

export type Screen = 'room' | 'devices' | 'source' | 'sound' | 'calibration' | 'settings'
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
  upmixOptions: UpmixOptions
  outputs: Output[]
  speakers: Speaker[]
  room: Room
  processing: Processing
  /** Yerleşik + kullanıcı profilleri; yerleşikler her zaman başta. */
  profiles: Profile[]
  /** Etkin profilin kimliği (hiçbiri seçili değilse null). */
  activeProfileId: string | null
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
  /** Çalışırken motorun bildirdiği durum (upmix durumu vb.); dururken null. */
  engine: EngineInfo | null
  toast: string | null

  init: () => Promise<void>
  setTheme: (t: Theme) => void
  setScreen: (s: Screen) => void
  select: (id: string | null) => void
  toggleRun: () => Promise<void>
  setPreset: (p: PresetChoice) => void
  /** X.Y.Z düzenini uygular; mevcut hoparlörlerin cihaz/EQ/bas ayarları rol, sonra konum sırasıyla korunur. */
  applyLayout: (spec: LayoutSpec) => void
  /** Rol seçer: karışım satırını (ve Subwoofer için bassReceiver'ı) yazar. */
  setRole: (id: string, role: string) => void
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
  /** Upmix ayrıntıları; seviyeler ve LFE canlı uygulanır (kısa gecikmeli kayıt), mod değişimi motoru yeniden başlatır. */
  setUpmixOptions: (patch: Partial<UpmixOptions>) => void
  /** Ses işleme alanlarını değiştirir; ses karakterini etkileyen bir alan değişirse etiket 'Özel' olur. */
  setProcessing: (patch: Partial<Processing>) => void
  applySoundPreset: (id: string) => void
  /** Profili uygular: ses işleme + upmix + upmix ayrıntıları tek commit'te (motor canlı uygular). */
  selectProfile: (id: string) => void
  /** Mevcut ayarları yeni kullanıcı profili olarak kaydeder ve etkin yapar. Kaydedildiyse true. */
  saveCurrentAsProfile: (name: string) => boolean
  /** Etkin profilin içeriğini mevcut ayarlarla değiştirir ("Profili güncelle"). */
  updateActiveProfile: () => void
  renameProfile: (id: string, name: string) => void
  /** Yalnızca kullanıcı profilleri silinir. */
  deleteProfile: (id: string) => void
  /** Yerleşik profili varsayılanına döndürür; etkinse hemen uygular. */
  resetBuiltinProfile: (id: string) => void
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

const sameRowStrict = (a: Speaker['source'], b: Speaker['source']): boolean => {
  const ka = Object.keys(a) as LogicalChannel[]
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/**
 * Otomatik işaretli hoparlörlerin gecikme/kazanç değerlerini geometriden yeniden hesaplar;
 * "Özel (haritadan)" rolündekilerin karışım satırını dinleyiciye göre açıdan yeniden üretir.
 */
function recalc(speakers: Speaker[], listener: Point, auto: Record<string, AutoFlags>): Speaker[] {
  const { byId } = computeAuto(speakers, listener)
  return speakers.map((s0) => {
    let s = s0
    if (s.role === ROLE_CUSTOM_MAP) {
      const row = computeMapSource(s, listener)
      if (!sameRowStrict(row, s.source)) s = { ...s, source: row }
    }
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
    upmixOptions: s.upmixOptions,
    outputs: s.outputs,
    speakers: s.speakers.map((sp) => ({ ...sp, auto: s.auto[sp.id] ?? { delay: true, gain: true } })),
    room: s.room,
    processing: s.processing,
    profiles: s.profiles,
    ...(s.activeProfileId ? { activeProfileId: s.activeProfileId } : {}),
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
    upmixOptions: defaultUpmixOptions(),
    outputs: [],
    speakers: [],
    room: { widthM: 5, depthM: 4.5, listener: { x: 2.5, y: 2.3 } },
    processing: defaultProcessing(),
    profiles: normalizeProfiles(undefined),
    activeProfileId: null,
    auto: {},

    preset: 'custom',
    lowLatency: false,
    theme: initialTheme(),
    screen: 'room',
    selection: null,
    runState: 'stopped',
    status: [],
    engine: null,
    toast: null,

    async init() {
      const [devices, cfg] = await Promise.all([api.listDevices(), api.getConfig()])
      const auto = Object.fromEntries(
        cfg.speakers.map((s) => [s.id, s.auto ?? { delay: true, gain: true }]),
      )
      const speakers = cfg.speakers.map(({ auto: _auto, ...rest }) => rest)
      const profiles = normalizeProfiles(cfg.profiles)
      set({
        devices,
        source: cfg.source,
        upmix: cfg.upmix,
        upmixOptions: normalizeUpmixOptions(cfg.upmixOptions),
        outputs: cfg.outputs,
        speakers: recalc(speakers, cfg.room.listener, auto),
        room: cfg.room,
        processing: normalizeProcessing(cfg.processing),
        profiles,
        activeProfileId: cfg.activeProfileId && profiles.some((p) => p.id === cfg.activeProfileId) ? cfg.activeProfileId : null,
        auto,
        preset: speakers.length === 0 ? 'custom' : '5.1',
        ready: true,
      })
      api.onStatus((status) => set({ status }))
      api.onEngine((info) => set({ engine: info.sourceRate > 0 ? info : null }))
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
        set({ runState: 'stopped', status: [], engine: null })
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
      const [floor, sub] = preset.split('.').map(Number)
      get().applyLayout({ floor, sub, height: 0 })
    },

    applyLayout(spec) {
      const { room, devices, outputs, lowLatency, speakers: existing, auto: oldAuto } = get()
      const slots = layoutSlots(spec, room.listener)
      const renders = devices.filter((d) => d.flow === 'render' && !(lowLatency && d.kind === 'network'))
      if (renders.length === 0 || slots.length === 0) {
        get().showToast('Çıkış cihazı bulunamadı.')
        return
      }
      const { matches, byRole, dropped } = assignExisting(slots, existing)
      // Yeni yuvalar için boş cihaz kanalları: çok kanallı cihaz yeterliyse onu, yoksa yerel cihazları sırayla kullan.
      const multi = renders.find((d) => d.channels >= slots.length) ?? null
      const pool = multi ? [multi] : renders
      const taken = new Set(matches.flatMap((m) => (m ? [`${m.outputDeviceId}#${m.deviceChannel}`] : [])))
      const free: { dev: Device; ch: number }[] = []
      for (const d of pool) for (let c = 1; c <= d.channels; c++) if (!taken.has(`${d.id}#${c}`)) free.push({ dev: d, ch: c })
      const stamp = Date.now().toString(36)
      const speakers: Speaker[] = slots.map((slot, i) => {
        const pos = clampToRoom(slot, room)
        const pt = { x: round(pos.x, 3), y: round(pos.y, 3) }
        const prev = matches[i]
        const elevated = slot.category === 'height' ? true : undefined
        const def = roleDef(slot.role)
        const base: Speaker = prev
          ? { ...prev, name: byRole[i] ? prev.name : slot.name }
          : (() => {
              const f = free.shift() ?? { dev: pool[pool.length - 1], ch: 1 }
              return {
                id: `spk-${stamp}-${i}`,
                name: slot.name,
                outputDeviceId: f.dev.id,
                deviceChannel: f.ch,
                source: {},
                delayMs: 0,
                gainDb: 0,
                mute: false,
                x: 0,
                y: 0,
              }
            })()
        const next: Speaker = { ...base, ...pt, role: slot.role, elevated }
        next.source = def ? { ...def.source } : computeMapSource(next, room.listener)
        if (slot.category === 'sub') {
          next.bassReceiver = true
          next.highPassHz = undefined
        }
        return next
      })
      let outs = outputs
      for (const s of speakers) outs = ensureOutput(outs, s.outputDeviceId)
      const label = `${spec.floor}.${spec.sub}`
      commit({
        speakers,
        outputs: outs,
        preset: spec.height === 0 && (label === '2.0' || label === '5.1' || label === '7.1') ? (label as PresetId) : 'custom',
        selection: null,
        auto: Object.fromEntries(speakers.map((s) => [s.id, oldAuto[s.id] ?? { delay: true, gain: true }])),
      })
      if (dropped > 0) get().showToast(`${dropped} eski hoparlör yeni düzene sığmadı, çıkarıldı.`, 4000)
    },

    setRole(id, role) {
      const { speakers, room } = get()
      commit({
        speakers: speakers.map((s) => (s.id === id ? { ...s, ...rolePatch(s, role, room.listener) } : s)),
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
          return { ...s, source, role: ROLE_CUSTOM_MANUAL }
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
      const logical = LOGICAL_CHANNELS.find((c) => !isHeightChannel(c) && !usedLogical.has(c))
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
    setUpmixOptions(patch) {
      const next = normalizeUpmixOptions({ ...get().upmixOptions, ...patch })
      // Seviye kaydırıcıları canlı uygulanır; kayıt sıklığı ses işleme kaydırıcılarıyla aynı.
      commit({ upmixOptions: next }, 'mode' in patch ? 400 : 150)
    },

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

    selectProfile(id) {
      const p = get().profiles.find((v) => v.id === id)
      if (!p) return
      commit({ ...profilePatch(p), activeProfileId: id }, 150)
    },

    saveCurrentAsProfile(name) {
      const clean = cleanProfileName(name)
      if (!clean) return false
      const { profiles, processing, upmix, upmixOptions } = get()
      const profile: Profile = { id: newProfileId(), name: clean, builtin: false, ...snapshotState({ processing, upmix, upmixOptions }) }
      commit({ profiles: [...profiles, profile], activeProfileId: profile.id })
      return true
    },

    updateActiveProfile() {
      const { profiles, activeProfileId, processing, upmix, upmixOptions } = get()
      if (!activeProfileId) return
      const snap = snapshotState({ processing, upmix, upmixOptions })
      commit({ profiles: profiles.map((p) => (p.id === activeProfileId ? { ...p, ...snap } : p)) })
    },

    renameProfile(id, name) {
      const clean = cleanProfileName(name)
      const { profiles } = get()
      if (!clean || !profiles.some((p) => p.id === id && !p.builtin)) return
      commit({ profiles: profiles.map((p) => (p.id === id ? { ...p, name: clean } : p)) })
    },

    deleteProfile(id) {
      const { profiles, activeProfileId } = get()
      if (!profiles.some((p) => p.id === id && !p.builtin)) return
      commit({ profiles: profiles.filter((p) => p.id !== id), activeProfileId: activeProfileId === id ? null : activeProfileId })
    },

    resetBuiltinProfile(id) {
      const def = builtinProfile(id)
      const { profiles, activeProfileId } = get()
      if (!def || !profiles.some((p) => p.id === id)) return
      const next = profiles.map((p) => (p.id === id ? def : p))
      commit(activeProfileId === id ? { profiles: next, ...profilePatch(def) } : { profiles: next }, 150)
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

/** Etkin profil (yoksa null). */
export const selectActiveProfile = (s: State): Profile | null =>
  s.activeProfileId ? (s.profiles.find((p) => p.id === s.activeProfileId) ?? null) : null

/** Etkin profil seçiliyken ayarlar ondan sapmış mı? */
export const selectProfileModified = (s: State): boolean => {
  const p = selectActiveProfile(s)
  return p ? isProfileModified(p, s) : false
}

/** Seçili hoparlör (dinleyici seçiliyse null). */
export const selectSpeaker = (s: State): Speaker | null =>
  s.selection && s.selection !== LISTENER_ID ? (s.speakers.find((v) => v.id === s.selection) ?? null) : null
