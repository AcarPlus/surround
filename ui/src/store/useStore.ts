import { create } from 'zustand'
import { api } from '../api/client'
import {
  LOGICAL_CHANNELS,
  isHeightChannel,
  type Config,
  type Device,
  type EngineInfo,
  type EngineState,
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
  type UserSoundPreset,
  type UserSpeakerPreset,
  normalizePeq,
  defaultUpmixOptions,
  normalizeUpmixOptions,
  isHighLatencyKind,
} from '../api/types'
import { clamp, clampToRoom, computeAuto, round } from '../lib/geometry'
import { assignExisting, layoutSlots, type LayoutSpec } from '../lib/layout'
import { ROLE_CUSTOM_MANUAL, ROLE_CUSTOM_MAP, computeMapSource, roleDef, rolePatch } from '../lib/roles'
import { idealSpeakerPoint } from '../lib/snap'
import { applyAutoNames } from '../lib/naming'
import { positionalRows } from '../lib/positional'
import { plannedName, standardPosition, type BuildResult } from '../lib/setup'
import { findCable, type FixId } from '../lib/health'
import { explainError } from '../lib/errors'
import {
  MAX_USER_PRESETS,
  cleanPresetName,
  makeUserSoundPreset,
  makeUserSpeakerPreset,
  matchSoundPreset,
  normalizeUserSoundPresets,
  normalizeUserSpeakerPresets,
  soundPresetPatch,
  userPresetKey,
  userSoundPatch,
  userSpeakerPatch,
} from '../lib/presets'
import {
  builtinProfile,
  cleanProfileName,
  isProfileModified,
  newProfileId,
  normalizeProfiles,
  profilePatch,
  snapshotState,
} from '../lib/profiles'

export type Screen = 'home' | 'sound' | 'calibration' | 'settings'
export type Theme = 'dark' | 'light'
/** 'waiting': motor bir cihaz değişikliğiyle durdu, cihazlar dönünce kendiliğinden yeniden başlar (Durdur bitirir). */
export type RunState = 'stopped' | 'starting' | 'running' | 'waiting'
export const LISTENER_ID = 'listener'

export interface AutoFlags {
  delay: boolean
  gain: boolean
}

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  message: string
  tone?: 'error'
  action?: ToastAction
  /** Teknik ayrıntı (katlanabilir "Ayrıntı" içinde). */
  detail?: string
}

/** Düzen şablonu önizlemesi: hangi hoparlör korunur, eklenir, çıkarılır. */
export interface LayoutPreview {
  kept: string[]
  added: string[]
  removed: string[]
}

/** Geri alınabilir yapılandırma alanları. */
const HISTORY_KEYS = [
  'source',
  'upmix',
  'upmixOptions',
  'outputs',
  'speakers',
  'room',
  'processing',
  'profiles',
  'activeProfileId',
  'userSoundPresets',
  'userSpeakerPresets',
  'auto',
  'setupDone',
  'lastCalibration',
  'positionalMix',
] as const
type HistoryKey = (typeof HISTORY_KEYS)[number]
type Snapshot = Pick<State, HistoryKey>
interface HistoryEntry {
  snap: Snapshot
  label: string
}
const HISTORY_MAX = 100
/** Kendiliğinden tampon büyütme: bu kadar yeni kesintide bir kez +20 ms, en çok bu kadar ms. */
const AUTO_BUFFER_DROPS = 3
const AUTO_BUFFER_MAX_MS = 200
/** Aynı türden art arda gelen değişiklikler (sürükleme, kaydırıcı) bu süre içinde tek adım sayılır. */
const COALESCE_MS = 900
/**
 * Yalnızca sürekli eylemler (sürükleme, kaydırıcı, sayı alanı) birleştirilir; etiketleri hedefin kimliğini taşır.
 * Ayrık eylemler (ekle, kopyala, sil, otomatik, profil, kalibrasyon, sihirbaz, düzen …) her zaman ayrı adımdır.
 */
const CONTINUOUS_LABEL = /^(Taşı:|Hoparlör ayarı:|Ses ayarı:|Upmix ayarı:|Karışım:|Çıkış ayarı:|Dinleyiciyi taşı$|Oda boyutu$)/
export const isContinuousLabel = (label: string): boolean => CONTINUOUS_LABEL.test(label)

export interface ApplySetupOptions {
  /** Yeni hoparlörlerin gecikme/kazancı geometriden otomatik hesaplansın mı (varsayılan true; ölçüm yoksa false → 0). */
  autoForNew?: boolean
  /** Varsayılan "Kurulum tamam" bildirimini gösterme (çağıran kendi bildirimini gösterir). */
  silent?: boolean
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
  /** Kullanıcı genel ses ön ayarları (config kökünde `userSoundPresets`, yedeğe dahil). */
  userSoundPresets: UserSoundPreset[]
  /** Kullanıcı hoparlör EQ ön ayarları (config kökünde `userSpeakerPresets`). */
  userSpeakerPresets: UserSpeakerPreset[]
  /**
   * "A/B (işlemesiz dinle)": açıkken motora `processing.enabled: false` gider; ayarın kendisi değişmez, geri alma
   * geçmişine yazılmaz. Config'e yalnızca `abBypass` işaretiyle yazılır (açılışta işleme geri açılır).
   */
  abBypass: boolean
  /** Hoparlör başına gecikme/kazanç otomatik mi (yalnızca arayüz durumu). */
  auto: Record<string, AutoFlags>
  /** Kurulum sihirbazı en az bir kez tamamlandı (config'te saklanır). */
  setupDone: boolean
  lastCalibration: NonNullable<Config['lastCalibration']> | null
  /** Kanalları hoparlörlerin sahnedeki yönüne göre dağıt (config'te `positionalMix`). */
  positionalMix: boolean

  wizardOpen: boolean
  /** Test sesi çalan hoparlör (haritada vurgulanır). */
  playing: string | null
  past: HistoryEntry[]
  future: HistoryEntry[]
  lowLatency: boolean
  theme: Theme
  screen: Screen
  /** Hoparlör id'si, 'listener' ya da null. */
  selection: string | null
  runState: RunState
  status: SinkStatus[]
  /** Çalışırken motorun bildirdiği durum (upmix durumu vb.); dururken null. */
  engine: EngineInfo | null
  /** runState 'waiting' iken: geri gelmesi beklenen cihazların adları ve (varsa) bekleme nedeni. */
  waitingFor: string[]
  waitMessage: string | null
  /**
   * Eksik cihaz olmadan çalışırken kalan hoparlörlerin motorda çaldığı gecikme/kazanç (hoparlör kimliğine göre); yoksa null.
   * Kayıtlı değerler değişmez; ekranlar bunu "şu an" olarak gösterir.
   */
  live: Record<string, { delayMs: number; gainDb: number }> | null
  /** Bekleme başladığındaki zaman (ms); bekleme yokken null. 30 sn sonra "eksiksiz başlat" önerilir. */
  waitingSince: number | null
  toast: Toast | null
  /** Açılışta ayarlar yüklenemediyse hata; ana ekran yerine kurtarma ekranı gösterilir. */
  initError: { message: string; detail?: string } | null

  init: () => Promise<void>
  /** İç: ayarları ve cihazları yükler (init hatayı yakalar). */
  loadAll: () => Promise<void>
  /** Ayarı varsayılana döndürür (eski dosya yedek kalır) ve yeniden yükler. */
  recoverWithDefaults: () => Promise<void>
  /** Seçilen yedek dosyasını doğrular, kaydeder ve yeniden yükler. Hata metni ya da null. */
  recoverFromBackup: (raw: unknown) => Promise<string | null>
  /** Cihaz beklemeyi bırakıp mevcut cihazlarla başlatır. */
  startWithoutMissing: () => Promise<void>
  /** Hata gösterir: anlaşılır cümle + katlanabilir teknik ayrıntı. */
  showError: (e: unknown, ms?: number) => void
  /** Backend'in `engineState` olayı: running / waiting (cihaz bekleniyor) / stopped. */
  setEngineState: (e: EngineState) => void
  /** Cihaz listesini yeniden okur (Windows'ta kanal sayısı/varsayılan değişince ekran güncellensin). */
  refreshDevices: () => Promise<void>
  setTheme: (t: Theme) => void
  setScreen: (s: Screen) => void
  select: (id: string | null) => void
  toggleRun: () => Promise<void>
  /** Düzen şablonu uygulanırsa ne olacağı (onay penceresi için). */
  previewLayout: (spec: LayoutSpec) => LayoutPreview
  /** X.Y.Z düzenini uygular; mevcut hoparlörlerin cihaz/EQ/bas ayarları rol, sonra konum sırasıyla korunur. */
  applyLayout: (spec: LayoutSpec) => void
  /** Kurulum sihirbazının sonucunu tek adımda uygular (geri alınabilir). */
  applySetup: (r: BuildResult, opts?: ApplySetupOptions) => void
  /** Kalibrasyon yamalarını uygular; değişen değerlerin "Otomatik" bayrağı kapanır. */
  applyCalibration: (
    patches: Record<string, Partial<Speaker>>,
    micDeviceId: string,
    at: string,
    opts?: { silent?: boolean },
  ) => void
  openWizard: () => void
  closeWizard: () => void
  undo: () => void
  redo: () => void
  /** Sistem kontrolündeki "düzelt" düğmeleri. */
  fixHealth: (id: FixId, arg?: string) => void
  /** Tüm hoparlörleri sırayla çalar (hangisi hangisi?). */
  playTour: () => Promise<void>
  stopTour: () => void
  /** Bekleyen kaydı hemen diske yazar (backend yapılandırmayı diskten okuyacaksa, ör. kalibrasyondan önce). */
  flushSave: () => Promise<void>
  /** Çalışma durumunu motordan yeniden okur (backend motoru kendisi durdurup başlattıktan sonra). */
  syncRunState: () => Promise<void>
  /** Rol seçer: karışım satırını (ve Subwoofer için bassReceiver'ı) yazar. */
  setRole: (id: string, role: string) => void
  setLowLatency: (v: boolean) => void
  setPositionalMix: (on: boolean) => void
  setRoomSize: (widthM: number, depthM: number) => void
  moveListener: (x: number, y: number) => void
  moveSpeaker: (id: string, x: number, y: number) => void
  /** Hoparlörü rolünün standart açısına kaydırır (uzaklık korunur); dinleyiciyi odanın tam ortasına. */
  snapSpeaker: (id: string) => void
  snapListener: () => void
  nudgeSelected: (dx: number, dy: number) => void
  updateSpeaker: (id: string, patch: Partial<Speaker>) => void
  setMix: (id: string, ch: LogicalChannel, gain: number) => void
  setAuto: (id: string, patch: Partial<AutoFlags>) => void
  autoAll: () => void
  /** Hoparlör ekler; rol verilirse karışım satırı ve standart konum ondan gelir. */
  addSpeaker: (role?: string) => void
  duplicateSpeaker: (id: string) => void
  removeSpeaker: (id: string) => void
  setOutput: (deviceId: string, patch: Partial<Output>) => void
  setSource: (patch: Partial<Source>) => void
  setUpmix: (v: boolean) => void
  /** Upmix ayrıntıları; seviyeler ve LFE canlı uygulanır (kısa gecikmeli kayıt), mod değişimi motoru yeniden başlatır. */
  setUpmixOptions: (patch: Partial<UpmixOptions>) => void
  /** Ses işleme alanlarını değiştirir; ses karakterini etkileyen bir alan değişirse etiket 'Özel' olur. */
  setProcessing: (patch: Partial<Processing>) => void
  applySoundPreset: (id: string) => void
  /** Geçerli genel ses ayarlarını adla kaydeder; kaydedildiyse true (ad boşsa ya da 20 sınırı dolduysa false). */
  saveUserSoundPreset: (name: string) => boolean
  /** Ön ayarın içeriğini geçerli ayarlarla değiştirir. */
  overwriteUserSoundPreset: (id: string) => void
  renameUserSoundPreset: (id: string, name: string) => void
  deleteUserSoundPreset: (id: string) => void
  applyUserSoundPreset: (id: string) => void
  /** Hoparlörün EQ + parametrik bantlarını adla kaydeder. */
  saveUserSpeakerPreset: (speakerId: string, name: string) => boolean
  overwriteUserSpeakerPreset: (id: string, speakerId: string) => void
  renameUserSpeakerPreset: (id: string, name: string) => void
  deleteUserSpeakerPreset: (id: string) => void
  applyUserSpeakerPreset: (id: string, speakerId: string) => void
  /** A/B: genel işlemeyi geçici olarak atlar/geri açar (geçmişe yazılmaz, anında uygulanır). */
  setAbBypass: (on: boolean) => void
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
  /** Kaydedilecek yapılandırma belgesi (yedek dışa aktarma için). */
  exportConfig: () => Config
  /** Yedekten geri yükler (geri alınabilir). Geçersizse hata metni döner. */
  importConfig: (raw: unknown) => string | null
  showToast: (msg: string, ms?: number, opts?: { action?: ToastAction; tone?: 'error'; detail?: string }) => void
  dismissToast: () => void
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
function recalc(speakers0: Speaker[], listener: Point, auto: Record<string, AutoFlags>): Speaker[] {
  // Otomatik adlar konumu izler (taşıma, ekleme, düzen, dinleyiciyi taşıma); elle verilen adlar korunur.
  const speakers = applyAutoNames(speakers0, listener)
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
/** Bekleyen kaydın zamanı (Date.now() ms). */
let saveDue = 0
/** Hoparlör/dinleyici sürüklenirken kaydın (motorun canlı güncellemesinin) en sık aralığı: ses sürüklemeyi izler, IPC boğulmaz. */
export const DRAG_SAVE_MS = 100
const cancelSave = () => {
  clearTimeout(saveTimer)
  saveTimer = undefined
}

/**
 * Motora gidecek hoparlörler: "Konuma göre dağıt" açıksa katılan hoparlörlerin `source`'u konumdan hesaplanır, rol satırı
 * `roleSource`'ta saklanır (açılışta geri alınır). Kapalıysa olduğu gibi.
 */
export function withPositionalRows(s: Pick<State, 'speakers' | 'room' | 'positionalMix'>): Speaker[] {
  if (!s.positionalMix) return s.speakers
  const rows = positionalRows(s.speakers, s.room.listener)
  return s.speakers.map((sp) => {
    const row = rows.get(sp.id)
    // Hiç kanal düşmeyen hoparlör (sıkışık dizilimde ikisinin arasında kalan) rol satırını korur: motor boş satırı reddeder.
    return row && Object.keys(row).length > 0 ? { ...sp, source: row, roleSource: sp.source } : sp
  })
}

/** Hata mesajını kullanıcıya gösterilecek tek satıra çevirir (köprü hataları satır listesi taşıyabilir). */
export function describeError(e: unknown): string {
  return explainError(e).message
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Yedek dosyasını doğrular ve eksik isteğe bağlı alanları tamamlar. Geçersizse Türkçe hata metni döner.
 * Zorunlu: source, room (sayısal boyut ve dinleyici), outputs (cihaz + sayısal gecikme/tampon),
 * speakers (id, outputDeviceId, deviceChannel, source, x, y).
 */
export function checkConfig(raw: unknown): Config | string {
  const NOT = 'Bu dosya bir Surround yapılandırması değil.'
  if (!isObj(raw)) return NOT
  const c = raw as Record<string, unknown>
  if (!Array.isArray(c.speakers) || !isObj(c.source) || !isObj(c.room) || !Array.isArray(c.outputs)) return NOT
  const src = c.source
  if (typeof src.deviceId !== 'string' || typeof src.mode !== 'string') return 'Yedekte ses kaynağı bozuk.'
  const room = c.room
  const L = room.listener
  if (!isNum(room.widthM) || !isNum(room.depthM) || room.widthM <= 0 || room.depthM <= 0) return 'Yedekte oda boyutu bozuk.'
  if (!isObj(L) || !isNum(L.x) || !isNum(L.y)) return 'Yedekte dinleyici konumu bozuk.'
  for (const [i, o] of c.outputs.entries()) {
    if (!isObj(o) || typeof o.deviceId !== 'string' || !isNum(o.latencyMs) || !isNum(o.bufferMs)) {
      return `Yedekteki ${i + 1}. çıkış kaydı bozuk.`
    }
  }
  const ids = new Set<string>()
  const speakers: Config['speakers'] = []
  for (const [i, s] of c.speakers.entries()) {
    const bad = `Yedekteki ${i + 1}. hoparlör bozuk`
    if (!isObj(s)) return `${bad}.`
    if (typeof s.id !== 'string' || !s.id) return `${bad} (kimlik yok).`
    if (ids.has(s.id)) return `${bad} (kimlik tekrarlanıyor).`
    ids.add(s.id)
    if (typeof s.outputDeviceId !== 'string') return `${bad} (çıkış cihazı yok).`
    if (!isNum(s.deviceChannel) || s.deviceChannel < 1) return `${bad} (kanal numarası geçersiz).`
    if (!isObj(s.source) || !Object.values(s.source).every(isNum)) return `${bad} (karışım satırı geçersiz).`
    if (!isNum(s.x) || !isNum(s.y)) return `${bad} (konum geçersiz).`
    speakers.push({
      ...(s as unknown as Speaker),
      name: typeof s.name === 'string' ? s.name : `Hoparlör ${i + 1}`,
      delayMs: isNum(s.delayMs) ? s.delayMs : 0,
      gainDb: isNum(s.gainDb) ? s.gainDb : 0,
      mute: s.mute === true,
      auto: isObj(s.auto) ? { delay: s.auto.delay !== false, gain: s.auto.gain !== false } : undefined,
    })
  }
  return { ...(c as unknown as Config), speakers }
}

export const useStore = create<State>()((set, get) => {
  /** Hoparlörün parametrik bantlarını doğrular (yoksa alan hiç yazılmaz). */
  const withPeq = (sp: Speaker): Speaker => {
    const { peq, ...rest } = sp
    const n = normalizePeq(peq)
    return n ? { ...rest, peq: n } : rest
  }

  const snapshot = (s: State): Snapshot => Object.fromEntries(HISTORY_KEYS.map((k) => [k, s[k]])) as Snapshot

  let lastPush = { key: '', t: 0 }
  /** Her tur kendi numarasıyla çalışır; durdurma ya da yeni tur eski döngüyü geçersiz kılar. */
  let tourToken = 0
  let touring = false
  let listening = false
  let toastSeq = 0
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * Kaydedilecek belge: hoparlörlerin `auto` bayrakları da içinde taşınır. Hiçbir hoparlörün kullanmadığı
   * çıkışlar yazılmaz (eski sürümler kaldırılan cihazları listede bırakıyordu).
   */
  const buildConfig = (s: State): Config => ({
    source: s.source,
    upmix: s.upmix,
    upmixOptions: s.upmixOptions,
    outputs: s.outputs.filter((o) => s.speakers.some((sp) => sp.outputDeviceId === o.deviceId)),
    speakers: withPositionalRows(s).map((sp) => ({ ...sp, auto: s.auto[sp.id] ?? { delay: true, gain: true } })),
    room: s.room,
    processing: s.abBypass ? { ...s.processing, enabled: false } : s.processing,
    profiles: s.profiles,
    ...(s.userSoundPresets.length ? { userSoundPresets: s.userSoundPresets } : {}),
    ...(s.userSpeakerPresets.length ? { userSpeakerPresets: s.userSpeakerPresets } : {}),
    ...(s.abBypass ? { abBypass: true } : {}),
    ...(s.activeProfileId ? { activeProfileId: s.activeProfileId } : {}),
    ...(s.setupDone ? { setupDone: true } : {}),
    ...(s.lastCalibration ? { lastCalibration: s.lastCalibration } : {}),
    ...(s.positionalMix ? { positionalMix: true } : {}),
  })

  /**
   * `throttle`: bekleyen bir kayıt varsa ertelenmez (sürüklemede her `delayMs`'de bir kayıt, son konum dahil); yoksa her
   * değişiklik zamanlayıcıyı yeniden kurar (debounce).
   */
  const scheduleSave = (delayMs: number, throttle = false) => {
    const due = Date.now() + delayMs
    if (throttle && saveTimer !== undefined && saveDue <= due) return
    clearTimeout(saveTimer)
    saveDue = due
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      api.saveConfig(buildConfig(get())).catch((e) => get().showError(e, 6000))
    }, delayMs)
  }

  /**
   * Kesinti olan cihazın tamponunu kendiliğinden büyütür (kullanıcı ayar görmez): son büyütmeden beri en az
   * `AUTO_BUFFER_DROPS` kesinti olduysa +20 ms, en çok `AUTO_BUFFER_MAX_MS`, iki büyütme arası en az 15 sn.
   * Geri alma geçmişine girmez. Motor yeniden başlayınca sayaçlar sıfırlanır; taban da onlarla birlikte düşer.
   */
  const bufferBase: Record<string, { drops: number; at: number }> = {}
  const autoBuffer = (status: SinkStatus[]) => {
    if (get().runState !== 'running') return
    const now = Date.now()
    let outputs = get().outputs
    for (const st of status) {
      const drops = st.underruns
      const base = bufferBase[st.deviceId]
      if (!base || drops < base.drops) {
        bufferBase[st.deviceId] = { drops, at: base?.at ?? 0 }
        continue
      }
      const o = outputs.find((v) => v.deviceId === st.deviceId)
      if (!o || drops - base.drops < AUTO_BUFFER_DROPS || now - base.at < 15000 || o.bufferMs >= AUTO_BUFFER_MAX_MS) continue
      outputs = outputs.map((v) => (v === o ? { ...v, bufferMs: Math.min(AUTO_BUFFER_MAX_MS, o.bufferMs + 20) } : v))
      bufferBase[st.deviceId] = { drops, at: now }
    }
    if (outputs !== get().outputs) {
      set({ outputs })
      scheduleSave(400)
    }
  }

  /**
   * Kaynak her zaman VB-Cable'dır (loopback) ve kullanıcı değiştirmez: kablo varsa kaynak kendiliğinden ona geçer.
   * Geri alma geçmişine girmez; kablo yoksa kaynak olduğu gibi kalır (Bağlantı ekranı kurulum kartını gösterir).
   */
  const followCable = () => {
    const { devices, source } = get()
    const cable = findCable(devices)
    if (!cable || (source.mode === 'loopback' && source.deviceId === cable.id)) return
    set({ source: { ...source, mode: 'loopback', deviceId: cable.id } })
    scheduleSave(400)
  }

  /**
   * Yapılandırmayı değiştiren her eylem buradan geçer: geçmişe yaz + yeniden hesapla + gecikmeli kaydet.
   * `label` geri al ipucunda görünür; aynı `label` ile art arda (sürükleme) gelen değişiklikler tek adımdır.
   */
  const commit = (patch: Partial<State>, delayMs = 400, label = 'Değişiklik', throttle = false) => {
    const cur = get()
    const now = Date.now()
    const coalesce =
      isContinuousLabel(label) && lastPush.key === label && now - lastPush.t < COALESCE_MS && cur.past.length > 0
    const past = coalesce ? cur.past : [...cur.past, { snap: snapshot(cur), label: label.split(':')[0] }].slice(-HISTORY_MAX)
    lastPush = { key: label, t: now }
    const next = { ...cur, ...patch }
    const speakers = recalc(next.speakers, next.room.listener, next.auto)
    set({ ...patch, speakers, past, future: [] })
    scheduleSave(delayMs, throttle)
  }

  const restore = (snap: Snapshot) => {
    set({ ...snap, speakers: recalc(snap.speakers, snap.room.listener, snap.auto) })
    lastPush = { key: '', t: 0 }
    const sel = get().selection
    if (sel && sel !== LISTENER_ID && !get().speakers.some((s) => s.id === sel)) set({ selection: null })
    scheduleSave(150)
  }

  const ensureOutput = (outputs: Output[], deviceId: string): Output[] =>
    outputs.some((o) => o.deviceId === deviceId) ? outputs : [...outputs, { deviceId, latencyMs: 0, bufferMs: 40 }]

  const undoAction: ToastAction = { label: 'Geri al', run: () => get().undo() }

  /** Hoparlör atanabilecek çıkışlar: kaynak cihaz, sanal kablo ve (düşük gecikmede) ağ cihazları hariç. */
  const renderTargets = (s: State): Device[] =>
    s.devices.filter(
      (d) =>
        d.flow === 'render' &&
        !(s.lowLatency && isHighLatencyKind(d.kind)) &&
        !(s.source.mode === 'loopback' && d.id === s.source.deviceId) &&
        !/cable/i.test(d.name),
    )

  /** Sıradaki cihazlarda ilk boş kanal (`taken`: "cihaz#kanal"). */
  const firstFree = (devs: Device[], taken: Set<string>): { dev: Device; ch: number } | null => {
    for (const d of devs) for (let c = 1; c <= d.channels; c++) if (!taken.has(`${d.id}#${c}`)) return { dev: d, ch: c }
    return null
  }
  const takenOf = (speakers: Speaker[]) => new Set(speakers.map((s) => `${s.outputDeviceId}#${s.deviceChannel}`))
  const CLASH_WARNING = 'Boş kanal kalmadı: iki hoparlör aynı kanalda (Sistem kontrolü uyarır).'

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
    userSoundPresets: [],
    userSpeakerPresets: [],
    abBypass: false,
    auto: {},
    setupDone: false,
    lastCalibration: null,
    positionalMix: false,

    wizardOpen: false,
    playing: null,
    past: [],
    future: [],
    // Düşük gecikme kapalı (arayüzde anahtarı yok): Bluetooth ve ağ hoparlörleri de kullanılır.
    lowLatency: false,
    theme: initialTheme(),
    screen: 'home',
    selection: null,
    runState: 'stopped',
    status: [],
    engine: null,
    waitingFor: [],
    live: null,
    waitMessage: null,
    waitingSince: null,
    toast: null,
    initError: null,

    async init() {
      set({ initError: null })
      try {
        await get().loadAll()
        // Açılış ölçümü: veriler bu karede çizilir.
        const mark = () => api.startupMark('init').catch(() => {})
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(mark)
        else void mark()
      } catch (e) {
        set({ initError: explainError(e) })
      }
    },

    async recoverWithDefaults() {
      try {
        await api.resetConfig()
      } catch (e) {
        set({ initError: explainError(e) })
        return
      }
      await get().init()
    },

    async recoverFromBackup(raw) {
      const checked = checkConfig(raw)
      if (typeof checked === 'string') return checked
      try {
        await api.saveConfig(checked)
      } catch (e) {
        return `Yedek yüklenemedi: ${describeError(e)}`
      }
      await get().init()
      return get().initError?.message ?? null
    },

    async startWithoutMissing() {
      try {
        await api.startWithoutMissing()
        const e = await api.getEngineState().catch(() => null)
        if (e) get().setEngineState(e)
        else set({ runState: 'running', waitingFor: [], waitMessage: null, waitingSince: null, live: null })
      } catch (e) {
        get().showError(e, 7000)
      }
    },

    showError(e, ms = 6000) {
      const x = explainError(e)
      get().showToast(x.message, ms, { tone: 'error', detail: x.detail })
    },

    async loadAll() {
      const [devices, cfg] = await Promise.all([api.listDevices(), api.getConfig()])
      const auto = Object.fromEntries(cfg.speakers.map((s) => [s.id, s.auto ?? { delay: true, gain: true }]))
      // Konuma göre dağıt açıkken kaydedilen `source` hesaplanmış satırdır; asıl (rol) satırı `roleSource`'tadır.
      const speakers = cfg.speakers.map(({ auto: _auto, roleSource, ...rest }) => withPeq(roleSource ? { ...rest, source: roleSource } : rest))
      const profiles = normalizeProfiles(cfg.profiles)
      // A/B açıkken uygulama kapandıysa config'te işleme kapalı kalmıştır; işaretten geri açılır.
      const abLeftover = cfg.abBypass === true
      const loaded = normalizeProcessing(cfg.processing)
      set({
        abBypass: false,
        userSoundPresets: normalizeUserSoundPresets(cfg.userSoundPresets),
        userSpeakerPresets: normalizeUserSpeakerPresets(cfg.userSpeakerPresets),
        devices,
        source: cfg.source,
        upmix: cfg.upmix,
        upmixOptions: normalizeUpmixOptions(cfg.upmixOptions),
        outputs: cfg.outputs,
        speakers: recalc(speakers, cfg.room.listener, auto),
        room: cfg.room,
        processing: abLeftover ? { ...loaded, enabled: true } : loaded,
        profiles,
        activeProfileId:
          cfg.activeProfileId && profiles.some((p) => p.id === cfg.activeProfileId) ? cfg.activeProfileId : null,
        auto,
        setupDone: !!cfg.setupDone || speakers.length > 0,
        lastCalibration: cfg.lastCalibration ?? null,
        positionalMix: cfg.positionalMix === true,
        // Yeni kullanıcıda (hoparlör yok, kurulum yapılmamış) sihirbaz kendiliğinden açılır.
        wizardOpen: speakers.length === 0 && !cfg.setupDone,
        past: [],
        future: [],
        ready: true,
      })
      if (abLeftover) scheduleSave(100)
      followCable()
      if (!listening) {
        listening = true
        api.onStatus((status) => {
          set({ status })
          autoBuffer(status)
        })
        api.onEngine((info) => set({ engine: info.sourceRate > 0 ? info : null }))
        api.onEngineError((msg) => get().showError(new Error(msg), 7000))
        api.onEngineState((e) => get().setEngineState(e))
        // Tepsiden seçilen profil: backend kaydetti ve uyguladı; arayüz de aynı değerlere geçer (geri alınabilir).
        api.onProfileApplied((id) => {
          const p = get().profiles.find((v) => v.id === id)
          if (!p) return
          get().selectProfile(id)
        })
      }
      // Ayar dosyası okunamadıysa backend varsayılanı yükledi ve eskisini yedekledi: bir kez haber ver.
      try {
        const notice = await api.takeConfigNotice()
        if (notice)
          get().showToast(
            `Ayar dosyası okunamadı; yedeği şuraya kaydedildi: ${notice.backupPath}. Varsayılan ayarlar yüklendi.`,
            20000,
            { tone: 'error' },
          )
      } catch {
        /* eski backend */
      }
      // Pencere sonradan açıldıysa (tepsiden başlatma) motor zaten çalışıyor ya da cihaz bekliyor olabilir.
      try {
        const e = await api.getEngineState()
        if (e.state !== 'stopped') get().setEngineState(e)
      } catch {
        /* olaylarla gelir */
      }
    },

    setEngineState(e) {
      const idle = { waitingFor: [] as string[], waitMessage: null, waitingSince: null, live: null }
      if (e.state === 'waiting') {
        set({
          runState: 'waiting',
          status: [],
          engine: null,
          waitingFor: [...e.missing],
          waitMessage: e.message ?? null,
          waitingSince: get().waitingSince ?? Date.now(),
        })
      } else if (e.state === 'running') {
        const live = e.live?.length ? Object.fromEntries(e.live.map((x) => [x.id, { delayMs: x.delayMs, gainDb: x.gainDb }])) : null
        set({ runState: 'running', ...idle, live })
      } else if (get().runState !== 'starting') {
        // Başlatılırken gelen eski bir "stopped" yok sayılır; sonucu toggleRun belirler.
        set({ runState: 'stopped', status: [], engine: null, ...idle })
      }
    },

    async refreshDevices() {
      try {
        const devices = await api.listDevices()
        const prev = get().devices
        const same =
          prev.length === devices.length &&
          prev.every((d, i) => {
            const n = devices[i]
            return d.id === n.id && d.name === n.name && d.channels === n.channels && d.isDefault === n.isDefault
          })
        if (!same) {
          set({ devices })
          followCable()
        }
      } catch {
        /* sonraki denemede */
      }
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
    // Seçim yalnızca Oda ekranında anlamlı (Delete ve ok tuşları orada çalışır).
    setScreen: (screen) => set(screen === 'home' ? { screen } : { screen, selection: null }),
    select: (selection) => set({ selection }),

    async toggleRun() {
      const { runState } = get()
      if (runState === 'starting') return
      // Cihaz beklerken Durdur beklemeyi de bitirir.
      if (runState === 'running' || runState === 'waiting') {
        try {
          await api.stop()
        } catch (e) {
          get().showError(e, 6000)
        }
        set({ runState: 'stopped', status: [], engine: null, waitingFor: [], waitMessage: null, waitingSince: null, live: null })
        return
      }
      set({ runState: 'starting' })
      cancelSave()
      try {
        await api.saveConfig(buildConfig(get()))
        await api.start()
        // Eksik cihaz yüzünden motor beklemeye geçmiş olabilir (start hata vermez): gerçek durumu sor.
        const e = await api.getEngineState().catch(() => null)
        if (e?.state === 'waiting') get().setEngineState(e)
        else set({ runState: 'running' })
      } catch (e) {
        set({ runState: 'stopped', status: [] })
        get().showError(e, 7000)
      }
    },

    previewLayout(spec) {
      const { room, speakers } = get()
      const slots = layoutSlots(spec, room.listener)
      const { matches } = assignExisting(slots, speakers)
      const keptIds = new Set(matches.flatMap((m) => (m ? [m.id] : [])))
      return {
        kept: matches.flatMap((m) => (m ? [m.name] : [])),
        added: slots.filter((_, i) => !matches[i]).map((s) => s.name),
        removed: speakers.filter((s) => !keptIds.has(s.id)).map((s) => s.name),
      }
    },

    applyLayout(spec) {
      const { room, outputs, speakers: existing, auto: oldAuto } = get()
      const slots = layoutSlots(spec, room.listener)
      const renders = renderTargets(get())
      if (renders.length === 0 || slots.length === 0) {
        get().showToast('Çıkış cihazı bulunamadı.', 4000, { tone: 'error' })
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
      let clashes = 0
      const speakers: Speaker[] = slots.map((slot, i) => {
        const pos = clampToRoom(slot, room)
        const pt = { x: round(pos.x, 3), y: round(pos.y, 3) }
        const prev = matches[i]
        const elevated = slot.category === 'height' ? true : undefined
        const def = roleDef(slot.role)
        const base: Speaker = prev
          ? { ...prev, name: byRole[i] || prev.customName ? prev.name : slot.name }
          : (() => {
              // Havuz bitti: diğer cihazlarda boş kanal ara; yoksa çakışmayı kabul et ve uyar.
              let f = free.shift() ?? firstFree(renders, taken)
              if (!f) {
                clashes++
                f = { dev: pool[pool.length - 1], ch: 1 }
              }
              taken.add(`${f.dev.id}#${f.ch}`)
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
      const label = `${spec.floor}.${spec.sub}${spec.height ? `.${spec.height}` : ''}`
      commit(
        {
          speakers,
          outputs: outs,
          selection: null,
          auto: Object.fromEntries(speakers.map((s) => [s.id, oldAuto[s.id] ?? { delay: true, gain: true }])),
        },
        400,
        `${label} düzeni`,
      )
      const msg = dropped > 0 ? `${label} düzeni uygulandı; ${dropped} hoparlör çıkarıldı.` : `${label} düzeni uygulandı.`
      // Bildirim yalnızca dikkat gerektiğinde: boş kanal kalmadıysa düzen zaten sahnede görünüyor.
      if (clashes > 0) get().showToast(`${msg} ${CLASH_WARNING}`, 6000, { action: undoAction })
    },

    applySetup(r, opts = {}) {
      const { auto } = get()
      const created = new Set(r.createdIds)
      commit(
        {
          speakers: r.speakers,
          outputs: r.outputs,
          auto: Object.fromEntries(
            r.speakers.map((s) => [
              s.id,
              created.has(s.id)
                ? { delay: opts.autoForNew !== false, gain: opts.autoForNew !== false }
                : (auto[s.id] ?? { delay: true, gain: true }),
            ]),
          ),
          selection: null,
          setupDone: true,
        },
        150,
        'Kurulum sihirbazı',
      )
    },

    applyCalibration(patches, micDeviceId, at, _opts = {}) {
      const { speakers, auto } = get()
      const nextAuto = { ...auto }
      for (const [id, p] of Object.entries(patches)) {
        const a = auto[id] ?? { delay: true, gain: true }
        nextAuto[id] = { delay: 'delayMs' in p ? false : a.delay, gain: 'gainDb' in p ? false : a.gain }
      }
      const n = Object.keys(patches).length
      commit(
        {
          speakers: speakers.map((s) => (patches[s.id] ? { ...s, ...patches[s.id] } : s)),
          auto: nextAuto,
          lastCalibration: { at, micDeviceId, speakers: n },
        },
        150,
        'Kalibrasyon',
      )
    },

    openWizard: () => set({ wizardOpen: true }),
    closeWizard: () => set({ wizardOpen: false, selection: null }),

    undo() {
      const { past, future } = get()
      const e = past[past.length - 1]
      if (!e) return
      set({ past: past.slice(0, -1), future: [...future, { snap: snapshot(get()), label: e.label }] })
      restore(e.snap)
    },

    redo() {
      const { past, future } = get()
      const e = future[future.length - 1]
      if (!e) return
      set({ future: future.slice(0, -1), past: [...past, { snap: snapshot(get()), label: e.label }] })
      restore(e.snap)
    },

    fixHealth(id, arg) {
      const st = get()
      switch (id) {
        case 'open-setup':
          st.openWizard()
          break
        case 'open-calibration':
          st.setScreen('calibration')
          break
        case 'open-sound-panel':
          api.openSoundPanel().catch((e) => st.showError(e, 6000))
          break
        case 'select-cable': {
          const cable = findCable(st.devices)
          if (cable) st.setSource({ mode: 'loopback', deviceId: cable.id })
          break
        }
        case 'add-bass-receiver': {
          // Bas kesmesiz ön hoparlörler (2.1 setin uyduları) kesilen bası alır.
          const plain = st.speakers.filter((s) => !s.mute && !(s.highPassHz ?? 0))
          const fronts = plain.filter((s) => (s.source.FL ?? 0) > 0 || (s.source.FR ?? 0) > 0)
          const ids = new Set((fronts.length ? fronts : plain).map((s) => s.id))
          if (ids.size === 0) break
          commit({ speakers: st.speakers.map((s) => (ids.has(s.id) ? { ...s, bassReceiver: true } : s)) }, 400, 'Bas alıcısı')
          break
        }
        case 'select-speaker':
          if (arg) {
            set({ selection: arg })
            st.setScreen('home')
          }
          break
        case 'raise-buffer': {
          const o = st.outputs.find((v) => v.deviceId === arg)
          if (o) st.setOutput(o.deviceId, { bufferMs: Math.min(400, o.bufferMs + 20) })
          break
        }
        case 'unmute-all':
          commit({ speakers: st.speakers.map((s) => (s.mute ? { ...s, mute: false } : s)) }, 400, 'Sessizi kaldır')
          break
        case 'enable-upmix':
          st.setUpmix(true)
          break
      }
    },

    async playTour() {
      // Zaten çalıyorsa ikinci bir tur başlatma: durdur.
      if (touring) {
        get().stopTour()
        return
      }
      const token = ++tourToken
      touring = true
      try {
        const list = get().speakers.filter((s) => !s.mute)
        for (const s of list) {
          if (token !== tourToken) break
          set({ playing: s.id })
          try {
            await api.playTone(s.outputDeviceId, s.deviceChannel)
          } catch (e) {
            get().showError(e, 5000)
            break
          }
          // Test sesi 2 sn sürer; köprü hemen döner, sıradakine geçmeden bekle.
          await new Promise((r) => setTimeout(r, 2300))
        }
      } finally {
        if (token === tourToken) {
          touring = false
          set({ playing: null })
        }
      }
    },

    stopTour() {
      tourToken++
      touring = false
      set({ playing: null })
    },

    async flushSave() {
      cancelSave()
      await api.saveConfig(buildConfig(get()))
    },

    async syncRunState() {
      try {
        const status = await api.getStatus()
        if (get().runState === 'starting') return
        if (status.length > 0) set({ runState: 'running', status })
        else if (get().runState === 'running') set({ runState: 'stopped', status: [], engine: null })
      } catch {
        /* durum okunamadı: olduğu gibi bırak */
      }
    },

    setRole(id, role) {
      const { speakers, room } = get()
      commit(
        { speakers: speakers.map((s) => (s.id === id ? { ...s, ...rolePatch(s, role, room.listener) } : s)) },
        400,
        'Rol',
      )
    },

    setLowLatency: (lowLatency) => set({ lowLatency }),

    setPositionalMix(on) {
      if (get().positionalMix === on) return
      commit({ positionalMix: on }, 150, on ? 'Konuma göre dağıt' : 'Rollere göre dağıt')
    },

    setRoomSize(widthM, depthM) {
      const w = clamp(widthM, 2, 20)
      const d = clamp(depthM, 2, 20)
      const { speakers, room } = get()
      const room2: Room = {
        widthM: w,
        depthM: d,
        listener: clampToRoom(room.listener, { widthM: w, depthM: d }),
      }
      commit({ room: room2, speakers: speakers.map((s) => ({ ...s, ...clampToRoom(s, room2) })) }, 400, 'Oda boyutu')
    },

    moveListener(x, y) {
      const { room } = get()
      const p = clampToRoom({ x: round(x, 2), y: round(y, 2) }, room)
      commit({ room: { ...room, listener: p } }, DRAG_SAVE_MS, 'Dinleyiciyi taşı', true)
    },

    snapSpeaker(id) {
      const { room, speakers } = get()
      const sp = speakers.find((s) => s.id === id)
      const p = sp && idealSpeakerPoint(sp, speakers, room.listener, room)
      if (!p) return
      const q = { x: round(p.x, 2), y: round(p.y, 2) }
      if (q.x === sp.x && q.y === sp.y) return
      commit({ speakers: speakers.map((s) => (s.id === id ? { ...s, ...q } : s)) }, 400, `Yerine oturt:${id}`)
    },

    snapListener() {
      const { room } = get()
      // Enes'in isteği: dinleyici odanın tam ortasına.
      const q = { x: round(room.widthM / 2, 2), y: round(room.depthM / 2, 2) }
      if (q.x === room.listener.x && q.y === room.listener.y) return
      commit({ room: { ...room, listener: q } }, 400, 'Dinleyiciyi yerine oturt')
    },

    moveSpeaker(id, x, y) {
      const { room, speakers } = get()
      const p = clampToRoom({ x: round(x, 2), y: round(y, 2) }, room)
      // Motor konum değişikliğini yeniden başlamadan, yumuşak geçişle uygular: ses sürüklemeyi ~10 Hz izler.
      commit({ speakers: speakers.map((s) => (s.id === id ? { ...s, ...p } : s)) }, DRAG_SAVE_MS, `Taşı:${id}`, true)
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
      const live = 'eq' in patch || 'peq' in patch || 'eqPreset' in patch
      const key = Object.keys(patch).sort().join(',')
      commit(
        { speakers: speakers.map((s) => (s.id === id ? { ...s, ...patch } : s)), outputs: outs },
        live ? 150 : 400,
        `Hoparlör ayarı:${id}:${key}`,
      )
    },

    setMix(id, ch, gain) {
      const { speakers } = get()
      commit(
        {
          speakers: speakers.map((s) => {
            if (s.id !== id) return s
            const source = { ...s.source }
            if (gain <= 0) delete source[ch]
            else source[ch] = round(clamp(gain, 0, 1), 2)
            return { ...s, source, role: ROLE_CUSTOM_MANUAL }
          }),
        },
        400,
        `Karışım:${id}:${ch}`,
      )
    },

    setAuto(id, patch) {
      const { auto } = get()
      commit({ auto: { ...auto, [id]: { ...(auto[id] ?? { delay: true, gain: true }), ...patch } } }, 400, `Otomatik:${id}`)
    },

    autoAll() {
      const { speakers } = get()
      commit(
        { auto: Object.fromEntries(speakers.map((s) => [s.id, { delay: true, gain: true }])) },
        400,
        'Tümünü otomatikle',
      )
    },

    addSpeaker(role) {
      const { speakers, room, auto, outputs } = get()
      const renders = renderTargets(get())
      // Boş kanalı olan ilk cihaz (kullanılan cihazlar önce).
      const ordered = [
        ...renders.filter((d) => speakers.some((s) => s.outputDeviceId === d.id)),
        ...renders.filter((d) => !speakers.some((s) => s.outputDeviceId === d.id)),
      ]
      let dev: Device | undefined = ordered[0]
      let ch = 1
      for (const d of ordered) {
        const used = new Set(speakers.filter((s) => s.outputDeviceId === d.id).map((s) => s.deviceChannel))
        const free = Array.from({ length: d.channels }, (_, i) => i + 1).find((c) => !used.has(c))
        if (free) {
          dev = d
          ch = free
          break
        }
      }
      if (!dev) {
        get().showToast('Çıkış cihazı bulunamadı.', 4000, { tone: 'error' })
        return
      }
      const id = `spk-${Date.now().toString(36)}`
      const def = role ? roleDef(role) : undefined
      let src: Speaker['source']
      if (def) src = { ...def.source }
      else {
        const usedLogical = new Set(speakers.flatMap((s) => Object.keys(s.source)))
        const logical = LOGICAL_CHANNELS.find((c) => !isHeightChannel(c) && !usedLogical.has(c))
        src = logical ? { [logical]: 1 } : {}
      }
      const hasSides = speakers.some((s) => (s.source.SL ?? 0) > 0 || (s.source.SR ?? 0) > 0)
      const p = def
        ? standardPosition(def.id, room, hasSides)
        : clampToRoom({ x: room.listener.x + 1, y: room.listener.y - 1 }, room)
      const sp: Speaker = {
        id,
        name: def ? plannedName(def.id) : `Hoparlör ${speakers.length + 1}`,
        outputDeviceId: dev.id,
        deviceChannel: ch,
        source: src,
        delayMs: 0,
        gainDb: 0,
        mute: false,
        x: p.x,
        y: p.y,
        ...(def ? { role: def.id } : {}),
        ...(def?.elevated ? { elevated: true } : {}),
        ...(def?.bassReceiver ? { bassReceiver: true } : {}),
      }
      commit(
        {
          speakers: [...speakers, sp],
          auto: { ...auto, [id]: { delay: true, gain: true } },
          outputs: ensureOutput(outputs, dev.id),
          selection: id,
        },
        400,
        'Hoparlör ekle',
      )
    },

    duplicateSpeaker(id) {
      const { speakers, auto, room, outputs } = get()
      const s = speakers.find((v) => v.id === id)
      if (!s) return
      const nid = `spk-${Date.now().toString(36)}`
      const p = clampToRoom({ x: s.x + 0.3, y: s.y + 0.3 }, room)
      // Kopya aynı kanala düşmesin: önce aynı cihazda, sonra kullanılan, sonra diğer cihazlarda boş kanal.
      const renders = renderTargets(get())
      const used = (d: Device) => speakers.some((v) => v.outputDeviceId === d.id)
      const ordered = [
        ...renders.filter((d) => d.id === s.outputDeviceId),
        ...renders.filter((d) => d.id !== s.outputDeviceId && used(d)),
        ...renders.filter((d) => d.id !== s.outputDeviceId && !used(d)),
      ]
      const f = firstFree(ordered, takenOf(speakers))
      const target = f ? { outputDeviceId: f.dev.id, deviceChannel: f.ch } : {}
      commit(
        {
          speakers: [
            ...speakers,
            { ...s, ...target, id: nid, name: `${s.name} kopya`, x: p.x, y: p.y, calibratedAt: undefined },
          ],
          outputs: f ? ensureOutput(outputs, f.dev.id) : outputs,
          auto: { ...auto, [nid]: { ...(auto[id] ?? { delay: true, gain: true }) } },
          selection: nid,
        },
        400,
        'Kopyala',
      )
      if (!f) get().showToast(CLASH_WARNING, 6000)
    },

    removeSpeaker(id) {
      const { speakers, auto, selection } = get()
      const s = speakers.find((v) => v.id === id)
      if (!s) return
      const rest = { ...auto }
      delete rest[id]
      commit(
        { speakers: speakers.filter((v) => v.id !== id), auto: rest, selection: selection === id ? null : selection },
        400,
        `Sil: ${s.name}`,
      )
      get().showToast(`“${s.name}” silindi.`, 6000, { action: undoAction })
    },

    setOutput(deviceId, patch) {
      commit(
        { outputs: get().outputs.map((o) => (o.deviceId === deviceId ? { ...o, ...patch } : o)) },
        400,
        `Çıkış ayarı:${deviceId}:${Object.keys(patch).join(',')}`,
      )
    },

    setSource(patch) {
      const { source, devices } = get()
      const next = { ...source, ...patch }
      // Mod değişince akışa uymayan cihazı ilk uygun olanla değiştir.
      const flow = next.mode === 'capture' ? 'capture' : 'render'
      const cur = devices.find((d) => d.id === next.deviceId)
      if (!cur || cur.flow !== flow) {
        const fallback =
          devices.find((d) => d.flow === flow && (flow === 'capture' || d.isDefault)) ??
          devices.find((d) => d.flow === flow)
        next.deviceId = fallback?.id ?? ''
      }
      commit({ source: next }, 400, 'Kaynak')
    },
    setUpmix: (upmix) => commit({ upmix }, 400, 'Upmix'),
    setUpmixOptions(patch) {
      const next = normalizeUpmixOptions({ ...get().upmixOptions, ...patch })
      // Seviye kaydırıcıları canlı uygulanır; kayıt sıklığı ses işleme kaydırıcılarıyla aynı.
      commit({ upmixOptions: next }, 'mode' in patch ? 400 : 150, `Upmix ayarı:${Object.keys(patch).join(',')}`)
    },

    setProcessing(patch) {
      const cur = get().processing
      const changesSound = Object.keys(patch).some((k) => k !== 'enabled' && k !== 'limiter' && k !== 'preset')
      const next: Processing = {
        ...cur,
        ...patch,
        preset: patch.preset ?? cur.preset,
      }
      if (changesSound && patch.preset === undefined) next.preset = matchSoundPreset(next, get().userSoundPresets)
      commit({ processing: next }, 150, `Ses ayarı:${Object.keys(patch).join(',')}`)
    },

    applySoundPreset(id) {
      const patch = soundPresetPatch(id)
      if (patch) commit({ processing: { ...get().processing, ...patch } }, 150, 'Ses ön ayarı')
    },

    saveUserSoundPreset(name) {
      const clean = cleanPresetName(name)
      const { userSoundPresets, processing } = get()
      if (!clean || userSoundPresets.length >= MAX_USER_PRESETS) return false
      const preset = makeUserSoundPreset(processing, clean)
      commit(
        { userSoundPresets: [...userSoundPresets, preset], processing: { ...processing, preset: userPresetKey(preset.id) } },
        400,
        'Ses ön ayarı kaydet',
      )
      return true
    },

    overwriteUserSoundPreset(id) {
      const { userSoundPresets, processing } = get()
      const old = userSoundPresets.find((u) => u.id === id)
      if (!old) return
      const preset = makeUserSoundPreset(processing, old.name, id)
      commit(
        {
          userSoundPresets: userSoundPresets.map((u) => (u.id === id ? preset : u)),
          processing: { ...processing, preset: userPresetKey(id) },
        },
        400,
        'Ses ön ayarını güncelle',
      )
    },

    renameUserSoundPreset(id, name) {
      const clean = cleanPresetName(name)
      const { userSoundPresets } = get()
      if (!clean || !userSoundPresets.some((u) => u.id === id)) return
      commit({ userSoundPresets: userSoundPresets.map((u) => (u.id === id ? { ...u, name: clean } : u)) }, 400, 'Ses ön ayarı adı')
    },

    deleteUserSoundPreset(id) {
      const { userSoundPresets, processing } = get()
      if (!userSoundPresets.some((u) => u.id === id)) return
      const next = userSoundPresets.filter((u) => u.id !== id)
      const preset = processing.preset === userPresetKey(id) ? matchSoundPreset(processing, next) : processing.preset
      commit({ userSoundPresets: next, processing: { ...processing, preset } }, 400, 'Ses ön ayarını sil')
    },

    applyUserSoundPreset(id) {
      const u = get().userSoundPresets.find((v) => v.id === id)
      if (u) commit({ processing: { ...get().processing, ...userSoundPatch(u) } }, 150, 'Ses ön ayarı')
    },

    saveUserSpeakerPreset(speakerId, name) {
      const clean = cleanPresetName(name)
      const { userSpeakerPresets, speakers } = get()
      const sp = speakers.find((v) => v.id === speakerId)
      if (!clean || !sp || userSpeakerPresets.length >= MAX_USER_PRESETS) return false
      const preset = makeUserSpeakerPreset(sp, clean)
      commit(
        {
          userSpeakerPresets: [...userSpeakerPresets, preset],
          speakers: speakers.map((v) => (v.id === speakerId ? { ...v, eqPreset: userPresetKey(preset.id) } : v)),
        },
        400,
        'Hoparlör ön ayarı kaydet',
      )
      return true
    },

    overwriteUserSpeakerPreset(id, speakerId) {
      const { userSpeakerPresets, speakers } = get()
      const old = userSpeakerPresets.find((u) => u.id === id)
      const sp = speakers.find((v) => v.id === speakerId)
      if (!old || !sp) return
      const preset = makeUserSpeakerPreset(sp, old.name, id)
      commit(
        {
          userSpeakerPresets: userSpeakerPresets.map((u) => (u.id === id ? preset : u)),
          speakers: speakers.map((v) => (v.id === speakerId ? { ...v, eqPreset: userPresetKey(id) } : v)),
        },
        400,
        'Hoparlör ön ayarını güncelle',
      )
    },

    renameUserSpeakerPreset(id, name) {
      const clean = cleanPresetName(name)
      const { userSpeakerPresets } = get()
      if (!clean || !userSpeakerPresets.some((u) => u.id === id)) return
      commit(
        { userSpeakerPresets: userSpeakerPresets.map((u) => (u.id === id ? { ...u, name: clean } : u)) },
        400,
        'Hoparlör ön ayarı adı',
      )
    },

    deleteUserSpeakerPreset(id) {
      const { userSpeakerPresets, speakers } = get()
      if (!userSpeakerPresets.some((u) => u.id === id)) return
      commit(
        {
          userSpeakerPresets: userSpeakerPresets.filter((u) => u.id !== id),
          speakers: speakers.map((v) => (v.eqPreset === userPresetKey(id) ? { ...v, eqPreset: 'custom' } : v)),
        },
        400,
        'Hoparlör ön ayarını sil',
      )
    },

    applyUserSpeakerPreset(id, speakerId) {
      const u = get().userSpeakerPresets.find((v) => v.id === id)
      if (u) get().updateSpeaker(speakerId, userSpeakerPatch(u))
    },

    setAbBypass(on) {
      const { abBypass, processing } = get()
      if (on === abBypass || (on && !processing.enabled)) return
      // Geçmişe yazılmaz (commit kullanılmaz); doğrudan kaydedilir, böylece motor hemen uygular.
      set({ abBypass: on })
      cancelSave()
      api.saveConfig(buildConfig(get())).catch((e) => get().showError(e, 6000))
    },

    selectProfile(id) {
      const p = get().profiles.find((v) => v.id === id)
      if (!p) return
      commit({ ...profilePatch(p), activeProfileId: id }, 150, `Profil: ${p.name}`)
    },

    saveCurrentAsProfile(name) {
      const clean = cleanProfileName(name)
      if (!clean) return false
      const { profiles, processing, upmix, upmixOptions } = get()
      const profile: Profile = {
        id: newProfileId(),
        name: clean,
        builtin: false,
        ...snapshotState({ processing, upmix, upmixOptions }),
      }
      commit({ profiles: [...profiles, profile], activeProfileId: profile.id }, 400, 'Profil kaydet')
      return true
    },

    updateActiveProfile() {
      const { profiles, activeProfileId, processing, upmix, upmixOptions } = get()
      if (!activeProfileId) return
      const snap = snapshotState({ processing, upmix, upmixOptions })
      commit({ profiles: profiles.map((p) => (p.id === activeProfileId ? { ...p, ...snap } : p)) }, 400, 'Profili güncelle')
    },

    renameProfile(id, name) {
      const clean = cleanProfileName(name)
      const { profiles } = get()
      if (!clean || !profiles.some((p) => p.id === id && !p.builtin)) return
      commit({ profiles: profiles.map((p) => (p.id === id ? { ...p, name: clean } : p)) }, 400, 'Profil adı')
    },

    deleteProfile(id) {
      const { profiles, activeProfileId } = get()
      if (!profiles.some((p) => p.id === id && !p.builtin)) return
      commit(
        { profiles: profiles.filter((p) => p.id !== id), activeProfileId: activeProfileId === id ? null : activeProfileId },
        400,
        'Profil sil',
      )
    },

    resetBuiltinProfile(id) {
      const def = builtinProfile(id)
      const { profiles, activeProfileId } = get()
      if (!def || !profiles.some((p) => p.id === id)) return
      const next = profiles.map((p) => (p.id === id ? def : p))
      commit(
        activeProfileId === id ? { profiles: next, ...profilePatch(def) } : { profiles: next },
        150,
        'Profili sıfırla',
      )
    },

    async playTone(id) {
      const s = get().speakers.find((v) => v.id === id)
      if (!s) return
      set({ playing: id })
      try {
        await api.playTone(s.outputDeviceId, s.deviceChannel)
        await new Promise((r) => setTimeout(r, 1500))
      } catch (e) {
        get().showError(e, 6000)
      } finally {
        if (get().playing === id) set({ playing: null })
      }
    },

    exportConfig: () => buildConfig(get()),

    importConfig(raw) {
      try {
        const checked = checkConfig(raw)
        if (typeof checked === 'string') return checked
        const c = checked
        const auto = Object.fromEntries(c.speakers.map((s) => [s.id, s.auto ?? { delay: true, gain: true }]))
        const speakers = c.speakers.map(({ auto: _a, ...rest }) => withPeq(rest))
        const profiles = normalizeProfiles(c.profiles)
        commit(
          {
            source: c.source,
            upmix: !!c.upmix,
            upmixOptions: normalizeUpmixOptions(c.upmixOptions),
            outputs: c.outputs,
            speakers,
            room: c.room,
            processing: normalizeProcessing(c.processing),
            userSoundPresets: normalizeUserSoundPresets(c.userSoundPresets),
            userSpeakerPresets: normalizeUserSpeakerPresets(c.userSpeakerPresets),
            profiles,
            activeProfileId:
              c.activeProfileId && profiles.some((p) => p.id === c.activeProfileId) ? c.activeProfileId : null,
            auto,
            setupDone: true,
            lastCalibration: c.lastCalibration ?? null,
            selection: null,
          },
          150,
          'Yedekten geri yükle',
        )
        get().showToast(`Yedek yüklendi: ${speakers.length} hoparlör.`, 6000, { action: undoAction })
        return null
      } catch (e) {
        return `Yedek yüklenemedi: ${describeError(e)}`
      }
    },

    showToast(message, ms = 2200, opts = {}) {
      const id = ++toastSeq
      set({ toast: { id, message, ...opts } })
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, ms)
    },

    dismissToast: () => set({ toast: null }),
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
