import type { SurroundApi } from './client'
import {
  LOGICAL_CHANNELS,
  isHeightChannel,
  defaultAppSettings,
  defaultProcessing,
  defaultUpmixOptions,
  type AppSettings,
  type CalibrationProgress,
  type CalibrationResult,
  type Config,
  type EngineInfo,
  type EngineState,
  type Device,
  type LevelFrame,
  type LogicalChannel,
  type PhoneLinkStatus,
  type CableSetupResult,
  type SinkStatus,
  type Speaker,
  type UpdateState,
  type VolumeState,
} from './types'
import { computeAuto, presetLayout, round } from '../lib/geometry'

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const rand = (a: number, b: number) => a + Math.random() * (b - a)

const query = (k: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(k)

/** Önizleme: ?masaustu -> tipik masaüstü kurulumu (iki Realtek çıkışı + VB-Cable + kulaklık mikrofonu). */
const DESKTOP = query('masaustu')
/** Önizleme: ?bekle -> başlattıktan 5 sn sonra bir çıkış cihazı "çıkarılır", 5 sn sonra geri gelir (cihaz bekleniyor). */
const DROP_DEVICE = query('bekle')
const DROP_AFTER_MS = 5000
/** Önizleme: ?gelismis -> Gelişmiş kip (varsayılan Basit); gerçek uygulamada config'teki `uiMode` belirler. */
const ADVANCED = query('gelismis')

function buildDevices(): Device[] {
  if (DESKTOP) {
    return [
      { id: 'rt-spk', name: 'Hoparlör (Realtek(R) Audio)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
      { id: 'rt-2nd', name: 'Realtek HD Audio 2nd output (Realtek(R) Audio)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
      { id: 'bt-pill', name: 'Beats Pill (Bluetooth)', kind: 'bluetooth', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
      { id: 'usb-hs', name: 'Kulaklık (USBZH11S-ENC)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
      { id: 'cable-in', name: 'CABLE Input (VB-Audio Virtual Cable)', kind: 'multichannel', flow: 'render', channels: 8, sampleRate: 48000, isDefault: true },
      { id: 'cable-16', name: 'CABLE In 16ch (VB-Audio Virtual Cable)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
      { id: 'usb-mic', name: 'Mikrofon (USBZH11S-ENC)', kind: 'local', flow: 'capture', channels: 1, sampleRate: 48000, isDefault: true },
      { id: 'cable-out', name: 'CABLE Output (VB-Audio Virtual Cable)', kind: 'multichannel', flow: 'capture', channels: 8, sampleRate: 48000, isDefault: false },
    ]
  }
  const devices: Device[] = [
    { id: 'realtek-spk', name: 'Hoparlör (Realtek)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: true },
    { id: 'usb-headset', name: 'Kulaklık (USB)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
    { id: 'hdmi-nvidia', name: 'HDMI (NVIDIA)', kind: 'multichannel', flow: 'render', channels: 8, sampleRate: 48000, isDefault: false },
    { id: 'phone-salon', name: 'Salon telefonu', kind: 'network', flow: 'render', channels: 2, sampleRate: 44100, isDefault: false },
    { id: 'vb-cable', name: 'CABLE Output (VB-Audio Virtual Cable)', kind: 'multichannel', flow: 'capture', channels: 8, sampleRate: 48000, isDefault: false },
    { id: 'vb-cable-in-16', name: 'CABLE In 16ch (VB-Audio Virtual Cable)', kind: 'local', flow: 'render', channels: 2, sampleRate: 48000, isDefault: false },
    { id: 'vb-cable-in', name: 'CABLE Input (VB-Audio Virtual Cable)', kind: 'multichannel', flow: 'render', channels: 8, sampleRate: 48000, isDefault: false },
    { id: 'realtek-mic', name: 'Mikrofon (Realtek)', kind: 'local', flow: 'capture', channels: 2, sampleRate: 48000, isDefault: true },
  ]
  if (typeof location !== 'undefined') {
    // Önizleme: ?tekcikis -> VB-Cable yok ve tek hoparlör çıkışı var (kaynak olduğu için listeye giremez).
    if (location.search.includes('tekcikis')) return devices.filter((d) => d.id === 'realtek-spk' || d.flow === 'capture').filter((d) => !d.name.includes('CABLE'))
    // Önizleme: ?nocable -> VB-Cable yokmuş gibi (kurulum adımlarını görmek için).
    if (location.search.includes('nocable')) return devices.filter((d) => !d.name.includes('CABLE'))
    // ?cable2ch -> CABLE Input Windows'ta 7.1 yapılmamış (2 kanal).
    if (location.search.includes('cable2ch')) {
      return devices.map((d) => (d.id === 'vb-cable-in' ? { ...d, channels: 2 } : d))
    }
  }
  return devices
}

function initialConfig(): Config {
  if (query('bos') || DESKTOP) {
    return {
      source: { deviceId: DESKTOP ? 'cable-in' : 'realtek-spk', mode: 'loopback' },
      upmix: true,
      upmixOptions: defaultUpmixOptions(),
      outputs: [],
      speakers: [],
      room: { widthM: 4, depthM: 3.5, listener: { x: 2, y: 2 } },
      processing: defaultProcessing(),
    }
  }
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
    upmixOptions: defaultUpmixOptions(),
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

/** C# ResponseGrid: 100 Hz'den 1/12 oktav, 89 nokta. */
const RESP_HZ = Array.from({ length: 89 }, (_, i) => Math.round(100 * Math.pow(2, i / 12) * 10) / 10)

/** Önizleme: cihaza göre renklenmiş, konuma göre biraz oynayan bir hoparlör yanıtı (dB). */
function mockResponse(id: string, deviceId: string): number[] {
  const h = [...(id + deviceId)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const f1 = 300 + (h % 9) * 350
  const g1 = ((h >> 3) % 13) - 6
  const tilt = (((h >> 7) % 7) - 3) * 0.8
  const lowCut = deviceId.length % 2 ? 180 : 70
  return RESP_HZ.map((f) => {
    const o = Math.log2(f / f1)
    const bump = g1 * Math.exp(-o * o * 3)
    const hp = f < lowCut ? -12 * Math.log2(lowCut / f) : 0
    return Math.round((-38 + bump + tilt * Math.log2(f / 1000) + hp + (Math.random() - 0.5) * 1.2) * 100) / 100
  })
}

export function createMockApi(): SurroundApi {
  const devices = buildDevices()
  let config: Config = { ...initialConfig(), ...(ADVANCED ? { uiMode: 'advanced' as const } : {}) }
  let running = false
  let appSettings: AppSettings = defaultAppSettings()

  const counters = new Map<string, { under: number; over: number }>()
  const statusListeners = new Set<(s: SinkStatus[]) => void>()
  const levelListeners = new Set<(l: LevelFrame) => void>()
  const engineListeners = new Set<(i: EngineInfo) => void>()
  const calibrationListeners = new Set<(p: CalibrationProgress) => void>()
  const stateListeners = new Set<(s: EngineState) => void>()
  let calibrationAbort: (() => void) | null = null
  let startedAt = 0
  // Tepsi menüsünün taklidi (tarayıcı önizlemesi): konsoldan window.__trayProfile('builtin-game').
  const profileListeners = new Set<(id: string) => void>()
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __trayProfile?: (id: string) => void }).__trayProfile = (id) => profileListeners.forEach((cb) => cb(id))
  }
  const rejoinListeners = new Set<(names: string[]) => void>()
  const phoneListeners = new Set<(s: PhoneLinkStatus) => void>()
  const phoneStartListeners = new Set<() => void>()
  let phone: PhoneLinkStatus = { running: false, url: null, urls: [], connected: false, state: 'ready' }
  const setPhone = (p: Partial<PhoneLinkStatus>) => {
    phone = { ...phone, ...p }
    phoneListeners.forEach((cb) => cb(phone))
  }
  // Önizlemede telefonun "Ölçümü başlat" düğmesi.
  if (typeof window !== 'undefined')
    (window as unknown as { __phoneStart?: () => void }).__phoneStart = () => phoneStartListeners.forEach((cb) => cb())
  // Ses düzeyi (Windows kaydırıcısının taklidi): konsoldan window.__volumeKey(0.3) ses tuşuna basmış gibi.
  const volumeListeners = new Set<(v: VolumeState) => void>()
  let volume: VolumeState = { available: true, level: 0.72, muted: false, db: -5 }
  const setVol = (p: Partial<VolumeState>) => {
    const level = p.level ?? volume.level
    volume = { ...volume, ...p, db: level <= 0 ? -96 : Math.round(40 * Math.log10(level) * 10) / 10 }
    volumeListeners.forEach((cb) => cb({ ...volume }))
    return { ...volume }
  }
  if (typeof window !== 'undefined')
    (window as unknown as { __volumeKey?: (l: number) => void }).__volumeKey = (l) => setVol({ level: l })
  // Güncelleme: ?guncelleme ile birkaç saniye sonra yeni sürüm indirilmiş olur.
  const updateListeners = new Set<(u: UpdateState) => void>()
  let update: UpdateState = { state: 'idle', current: '0.3.4', version: null, progress: 0 }
  const setUpdate = (u: Partial<UpdateState>) => {
    update = { ...update, ...u }
    updateListeners.forEach((cb) => cb({ ...update }))
    return { ...update }
  }
  const fakeDownload = () => {
    setUpdate({ state: 'downloading', version: '0.3.5', progress: 0 })
    let p = 0
    const id = setInterval(() => {
      p += 20
      if (p >= 100) {
        clearInterval(id)
        setUpdate({ state: 'ready', progress: 100 })
      } else setUpdate({ progress: p })
    }, 300)
  }
  if (query('guncelleme')) setTimeout(fakeDownload, 1500)
  let engineState: EngineState = { state: 'stopped', missing: [] }
  let dropTimers: ReturnType<typeof setTimeout>[] = []

  const setEngineState = (s: EngineState) => {
    engineState = s
    stateListeners.forEach((cb) => cb({ ...s, missing: [...s.missing] }))
  }
  const clearDrop = () => {
    dropTimers.forEach(clearTimeout)
    dropTimers = []
  }
  /** ?bekle: motor gibi — cihaz gidince durur ve bekler, geri gelince kendiliğinden yeniden başlar. */
  function scheduleDrop() {
    clearDrop()
    const outs = config.outputs.flatMap((o) => devices.filter((d) => d.id === o.deviceId))
    const name = outs[outs.length - 1]?.name ?? 'Hoparlör (USB)'
    dropTimers.push(
      setTimeout(() => {
        running = false
        statusListeners.forEach((cb) => cb([]))
        emitEngine()
        setEngineState({ state: 'waiting', missing: [name] })
        dropTimers.push(
          setTimeout(() => {
            running = true
            startedAt = Date.now()
            setEngineState({ state: 'running', missing: [] })
            const s = snapshot()
            statusListeners.forEach((cb) => cb(s))
            emitEngine()
          }, DROP_AFTER_MS),
        )
      }, DROP_AFTER_MS),
    )
  }

  /** Upmix durumu: 2 kanallı kaynakta hep stereo; çok kanallıda ~6 sn'de bir stereo/yerel arasında gidip gelir. */
  function engineInfo(): EngineInfo {
    if (!running) return { upmix: 'off', sourceChannels: 0, sourceRate: 0, upmixLatencyMs: 0 }
    const dev = devices.find((d) => d.id === config.source.deviceId)
    const channels = dev?.channels ?? 2
    let upmix: EngineInfo['upmix'] = 'off'
    if (config.upmix) upmix = channels <= 2 || Math.floor((Date.now() - startedAt) / 6000) % 2 === 0 ? 'stereo' : 'native'
    const film = config.upmixOptions?.mode !== 'game'
    return { upmix, sourceChannels: channels, sourceRate: dev?.sampleRate ?? 48000, upmixLatencyMs: config.upmix && film ? 21.3 : 0 }
  }

  const emitEngine = () => {
    const info = engineInfo()
    engineListeners.forEach((cb) => cb(info))
  }
  const levels = Object.fromEntries(LOGICAL_CHANNELS.map((c) => [c, -90])) as LevelFrame
  const energy = Object.fromEntries(LOGICAL_CHANNELS.map((c) => [c, rand(0.3, 0.7)])) as Record<LogicalChannel, number>

  function snapshot(): SinkStatus[] {
    return config.outputs.map((o) => {
      const dev = devices.find((d) => d.id === o.deviceId)
      const c = counters.get(o.deviceId) ?? { under: 0, over: 0 }
      const isNet = dev?.kind === 'network' || dev?.kind === 'bluetooth'
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
    emitEngine()
  }, 1000)

  setInterval(() => {
    if (!running && LOGICAL_CHANNELS.every((c) => levels[c] <= -89)) return
    const surround = config.upmix || config.source.deviceId === 'vb-cable'
    const laneUsed = (c: LogicalChannel) => config.speakers.some((sp) => (sp.source[c] ?? 0) > 0)
    for (const c of LOGICAL_CHANNELS) {
      // Hiçbir hoparlörün satırında olmayan üst şerit hesaplanmaz (motor gibi): sessiz.
      if (running && isHeightChannel(c) && !laneUsed(c)) {
        levels[c] = -90
        continue
      }
      if (!running) {
        levels[c] = Math.max(-90, levels[c] - 6)
        continue
      }
      energy[c] = Math.min(1, Math.max(0, energy[c] + rand(-0.18, 0.18)))
      const base = isHeightChannel(c) ? -34 + (config.upmixOptions?.heightDb ?? -3) : c === 'LFE' ? -34 : c === 'FC' ? -22 : c === 'FL' || c === 'FR' ? -18 : surround ? -30 : -44
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
    async takeConfigNotice() {
      return typeof location !== 'undefined' && /[?&]bozuk/.test(location.search)
        ? { backupPath: 'C:\…\Surround\config.bad-20260101-120000.json' }
        : null
    },
    async resetConfig() {
      console.info('[mock] resetConfig')
    },
    async startWithoutMissing() {
      console.info('[mock] startWithoutMissing')
    },
    async openLogFolder() {
      console.info('[mock] openLogFolder')
    },
    async getAppSettings() {
      await wait(60)
      return { ...appSettings }
    },
    async saveAppSettings(s) {
      appSettings = { ...s }
    },
    async start() {
      await wait(450)
      running = true
      startedAt = Date.now()
      const s = snapshot()
      statusListeners.forEach((cb) => cb(s))
      emitEngine()
      setEngineState({ state: 'running', missing: [] })
      if (DROP_DEVICE) scheduleDrop()
    },
    async stop() {
      await wait(150)
      clearDrop()
      running = false
      counters.clear()
      emitEngine()
      setEngineState({ state: 'stopped', missing: [] })
    },
    async getStatus() {
      return running ? snapshot() : []
    },
    async demoStart(scene) {
      console.info('[mock] demoStart', scene)
      return { orbit: 20, pingpong: 15, flyby: 16, speakers: 8.4 }[scene]
    },
    async demoStop() {
      console.info('[mock] demoStop')
    },
    async playTone(deviceId, channel) {
      console.info('[mock] playTone', deviceId, channel)
      await wait(900)
    },
    async openSoundPanel() {
      console.info('[mock] openSoundPanel')
    },
    async cableSetup(): Promise<CableSetupResult> {
      await new Promise((r) => setTimeout(r, 1500))
      // ?kablohata: Windows onayı reddedilmiş gibi; ?yenidenbaslat: kuruldu ama yeniden başlatma gerekiyor.
      if (query('kablohata')) throw new Error('Kurulum tamamlanamadı: yönetici onayı verilmedi.')
      const cable = devices.find((d) => d.flow === 'render' && /cable/i.test(d.name))
      if (!cable) {
        if (query('yenidenbaslat')) return { state: 'reboot', installed: true }
        // Kurulum başarılı: sanal kablo uç noktaları belirir.
        devices.push(
          { id: 'vb-cable-in', name: 'CABLE Input (VB-Audio Virtual Cable)', kind: 'multichannel', flow: 'render', channels: 8, sampleRate: 48000, isDefault: true },
          { id: 'vb-cable', name: 'CABLE Output (VB-Audio Virtual Cable)', kind: 'multichannel', flow: 'capture', channels: 8, sampleRate: 48000, isDefault: false },
        )
        return { state: 'done', deviceId: 'vb-cable-in', channels: 8, installed: true }
      }
      cable.channels = 8
      return { state: 'done', deviceId: cable.id, channels: 8, installed: false }
    },
    onStatus(cb) {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    onLevels(cb) {
      levelListeners.add(cb)
      return () => levelListeners.delete(cb)
    },
    onEngine(cb) {
      engineListeners.add(cb)
      return () => engineListeners.delete(cb)
    },
    onEngineError() {
      return () => {}
    },
    async getEngineState() {
      return { ...engineState, missing: [...engineState.missing] }
    },
    onEngineState(cb) {
      stateListeners.add(cb)
      return () => stateListeners.delete(cb)
    },
    calibrate(req) {
      // Ölçümü odadaki konumdan taklit eder: varış = mesafe/343 + cihaza özgü gecikme, seviye = mesafe kaybı + cihaz farkı.
      const speakers = req.speakerIds.map((id) => config.speakers.find((s) => s.id === id))
      if (speakers.some((s) => !s)) return Promise.reject(new Error('Bilinmeyen hoparlör.'))
      const ref = config.speakers.find((s) => s.id === (req.referenceSpeakerId ?? req.speakerIds[0]))!
      const L = config.room.listener
      const devLat = (id: string) => (id.length * 7) % 11 // cihaz başına sabit, 0..10 ms
      const devLvl = (id: string) => -((id.length * 5) % 7) // 0..-6 dB
      const path = (s: Speaker) => Math.hypot(s.x - L.x, s.y - L.y)
      const arrival = (s: Speaker) => (path(s) / 343) * 1000 + devLat(s.outputDeviceId)
      const level = (s: Speaker) => -20 * Math.log10(Math.max(0.3, path(s))) + devLvl(s.outputDeviceId)
      const emit = (p: CalibrationProgress) => calibrationListeners.forEach((cb) => cb(p))
      const wantResp = req.responses || req.micDeviceId === 'phone'
      if (req.micDeviceId === 'phone' && !phone.connected) return Promise.reject(new Error('Telefon bağlı değil. QR kodu telefonla okutup sayfayı açık tutun.'))
      const total = speakers.length
      return new Promise<CalibrationResult>((resolve, reject) => {
        let step = -2
        const timer = setInterval(() => {
          step++
          if (step === -1) return emit({ phase: 'noise', index: 0, total, message: 'Ortam gürültüsü ölçülüyor…' })
          // Motor gibi: ölçümde index 1 tabanlı; çözümleme aşaması 1'den yeniden sayar.
          if (step < total) {
            const s = speakers[step]!
            return emit({ phase: 'measuring', speakerId: s.id, index: step + 1, total, message: `${s.name} ölçülüyor…` })
          }
          if (step < 2 * total) {
            const s = speakers[step - total]!
            return emit({ phase: 'analyzing', speakerId: s.id, index: step - total + 1, total, message: `${s.name} çözümleniyor…` })
          }
          clearInterval(timer)
          calibrationAbort = null
          emit({ phase: 'done', index: total, total, message: 'Bitti.' })
          resolve({
            referenceSpeakerId: ref.id,
            micDeviceId: req.micDeviceId,
            noiseFloorDb: -62,
            micClipped: false,
            ...(wantResp ? { responseHz: RESP_HZ } : {}),
            ...(req.applyCorrections ? { verified: true } : {}),
            ...(req.micDeviceId === 'phone' ? { note: 'Telefon 48000 Hz, saat farkı 42 ppm.' } : {}),
            speakers: speakers.map((s, i) => {
              // ?zayif: son hoparlör zayıf duyulur; "Yüksek" ölçüm sesiyle (−12 dBFS) tekrar ölçünce düzelir.
              const weak = query('zayif') && i === total - 1 && (req.levelDb ?? -20) < -15
              return {
                ...(wantResp && !req.lowBandSpeakerIds?.includes(s!.id) ? { responseDb: mockResponse(s!.id, s!.outputDeviceId) } : {}),
                ...(req.applyCorrections && s!.id !== ref.id
                  ? { residualArrivalMs: round(rand(-0.15, 0.15), 3), residualLevelDb: round(rand(-0.4, 0.4), 2) }
                  : {}),
                speakerId: s!.id,
                ok: !weak,
                arrivalMs: round(arrival(s!) - arrival(ref) + rand(-0.03, 0.03), 3),
                levelDb: round(level(s!) - level(ref) + rand(-0.2, 0.2), 2),
                snrDb: weak ? 8 : round(rand(28, 40), 1),
                spreadMs: round(rand(0.01, 0.06), 3),
                lowBand: !!req.lowBandSpeakerIds?.includes(s!.id),
                ...(weak ? { message: 'Sinyal çok zayıf (SNR 8 dB).' } : {}),
              }
            }),
          })
        }, 700)
        emit({ phase: 'preparing', index: 0, total, message: 'Hazırlanıyor…' })
        calibrationAbort = () => {
          clearInterval(timer)
          calibrationAbort = null
          reject(new Error('Kalibrasyon iptal edildi.'))
        }
      })
    },
    async cancelCalibration() {
      calibrationAbort?.()
    },
    onCalibration(cb) {
      calibrationListeners.add(cb)
      return () => calibrationListeners.delete(cb)
    },
    async phoneLinkStart() {
      if (!phone.running) {
        const url = 'https://192.168.1.20:47810/c/onizleme1234'
        // ?duvar: güvenlik duvarı engelliyor; "İzin ver" sonrası telefon bağlanır.
        setPhone({ running: true, url, urls: [url], state: 'ready', firewall: !query('duvar') })
        if (!query('duvar')) setTimeout(() => setPhone({ connected: true, device: 'Android Chrome (önizleme)' }), 1500)
      }
      return phone
    },
    async phoneLinkAllowFirewall() {
      await new Promise((r) => setTimeout(r, 600))
      setPhone({ firewall: true })
      setTimeout(() => setPhone({ connected: true, device: 'Android Chrome (önizleme)' }), 1200)
      return phone
    },
    async phoneLinkStop() {
      setPhone({ running: false, connected: false, url: null, urls: [] })
    },
    async phoneLinkStatus() {
      return phone
    },
    async phoneLinkPrompt() {},
    onPhoneLink(cb) {
      phoneListeners.add(cb)
      return () => phoneListeners.delete(cb)
    },
    onPhoneStart(cb) {
      phoneStartListeners.add(cb)
      return () => phoneStartListeners.delete(cb)
    },
    onDeviceRejoined(cb) {
      rejoinListeners.add(cb)
      return () => rejoinListeners.delete(cb)
    },
    onProfileApplied(cb) {
      profileListeners.add(cb)
      return () => profileListeners.delete(cb)
    },
    async getVolume() {
      return { ...volume }
    },
    async setVolume(level) {
      const l = Math.min(1, Math.max(0, level))
      return setVol(l > 0 ? { level: l, muted: false } : { level: l })
    },
    async setMute(muted) {
      return setVol({ muted })
    },
    onVolume(cb) {
      volumeListeners.add(cb)
      return () => volumeListeners.delete(cb)
    },
    async startupMark() {},
    async getUpdate() {
      return { ...update }
    },
    async checkUpdate() {
      if (update.state === 'ready' || update.state === 'downloading') return { ...update }
      setUpdate({ state: 'checking' })
      await new Promise((r) => setTimeout(r, 800))
      return setUpdate({ state: 'idle', version: null })
    },
    async applyUpdate() {
      setUpdate({ state: 'idle', current: update.version ?? update.current, version: null })
    },
    onUpdate(cb) {
      updateListeners.add(cb)
      return () => updateListeners.delete(cb)
    },
  }
}
