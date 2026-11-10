import { BLUETOOTH_BUFFER_MS, type Device, type Output, type Point, type Room, type Speaker } from '../api/types'
import { clamp, clampToRoom, polarToPoint, round } from './geometry'
import { ROLE_SUB, effectiveRole, roleDef, roleLabel } from './roles'
import { speakerPresetPatch } from './presets'

/**
 * Kurulum sihirbazının modeli: kullanıcı her çıkış cihazı için "buna ne bağlı?" sorusunu cevaplar,
 * hoparlör listesi bu cevaplardan üretilir. Sihirbaz düzen (X.Y.Z) yerine gerçek bağlantıdan yola çıkar;
 * böylece hangi hoparlörün hangi cihazın hangi kanalında olduğu hiç tahmin edilmez.
 */

export type KitKind = 'none' | 'pair' | 'pair21' | 'single' | 'multi'
export type PairPlace = 'front' | 'back' | 'side' | 'top-front' | 'top-back'
/** Çift hoparlör tipi (hoparlör ön ayarı kimliği). */
export type PairType = 'flat' | 'small-satellite'

export interface DeviceKit {
  deviceId: string
  kind: KitKind
  /** pair / pair21: çiftin yeri. */
  place: PairPlace
  /** pair: hoparlör tipi. */
  pairType: PairType
  /** pair / pair21: sol ve sağ kablolar ters takılı. */
  swap: boolean
  /** single: rol kimliği. */
  role: string
  /** multi: cihaz kanalı başına rol ('' = boş kanal). */
  roles: string[]
}

export const KIT_OPTIONS: { kind: KitKind; label: string; hint: string }[] = [
  { kind: 'pair21', label: '2.1 hoparlör seti', hint: 'Sol + sağ uydu ve kendi subwoofer’ı (masaüstü setleri).' },
  { kind: 'pair', label: 'Stereo hoparlör çifti', hint: 'İki hoparlör, ayrı subwoofer yok.' },
  { kind: 'single', label: 'Tek hoparlör', hint: 'Tek kutu: orta, subwoofer vb. Sinyal 1. kanaldan çıkar.' },
  { kind: 'multi', label: 'Çok kanallı sistem', hint: '5.1 / 7.1 ses kartı veya alıcı; her kanalın rolünü seç.' },
  { kind: 'none', label: 'Kullanılmıyor', hint: 'Bu cihaza Surround ses göndermez.' },
]

export const PLACE_OPTIONS: { value: PairPlace; label: string }[] = [
  { value: 'front', label: 'Önde' },
  { value: 'back', label: 'Arkada' },
  { value: 'side', label: 'Yanlarda' },
  { value: 'top-front', label: 'Üstte (ön)' },
  { value: 'top-back', label: 'Üstte (arka)' },
]

export const PAIR_TYPE_OPTIONS: { value: PairType; label: string; hint: string }[] = [
  { value: 'flat', label: 'Normal', hint: 'Bası iyi çalan, tam boy hoparlör.' },
  { value: 'small-satellite', label: 'Küçük / ucuz', hint: 'Bası zayıf; 150 Hz altı subwoofer’a yönlendirilir.' },
]

/** Çiftin rolleri (sol, sağ). */
export const PLACE_ROLES: Record<PairPlace, [string, string]> = {
  front: ['left', 'right'],
  back: ['back-left', 'back-right'],
  side: ['side-left', 'side-right'],
  'top-front': ['top-front-left', 'top-front-right'],
  'top-back': ['top-back-left', 'top-back-right'],
}

/** Windows çok kanallı sıra (WAVEFORMATEXTENSIBLE): FL FR FC LFE BL BR SL SR. */
const MULTI_DEFAULT = ['left', 'right', 'center', ROLE_SUB, 'back-left', 'back-right', 'side-left', 'side-right']

export function defaultMultiRoles(channels: number): string[] {
  return Array.from({ length: channels }, (_, i) => MULTI_DEFAULT[i] ?? '')
}

/** Sihirbazın listelediği cihazlar: kaynak ve sanal kablo uçları hariç tüm çıkışlar. */
export function candidateDevices(devices: Device[], sourceDeviceId: string): Device[] {
  return devices.filter((d) => d.flow === 'render' && d.id !== sourceDeviceId && !/cable|virtual/i.test(d.name))
}

const isHeadphone = (d: Device) => /kulakl|headphone|headset|earphone/i.test(d.name)

function emptyKit(d: Device): DeviceKit {
  return {
    deviceId: d.id,
    kind: 'none',
    place: 'front',
    pairType: 'flat',
    swap: false,
    role: 'center',
    roles: defaultMultiRoles(d.channels),
  }
}

/** Mevcut hoparlörlerden cihazın kitini çıkarır; o cihazda hoparlör yoksa null. */
export function kitFromSpeakers(d: Device, speakers: Speaker[]): DeviceKit | null {
  const on = speakers.filter((s) => s.outputDeviceId === d.id)
  if (on.length === 0) return null
  const kit = emptyKit(d)
  const roleAt = (ch: number) => {
    const s = on.find((v) => v.deviceChannel === ch)
    return s ? effectiveRole(s) : ''
  }
  if (d.channels > 2) {
    kit.kind = 'multi'
    kit.roles = Array.from({ length: d.channels }, (_, i) => {
      const r = roleAt(i + 1)
      return roleDef(r) ? r : ''
    })
    return kit
  }
  if (on.length === 1) {
    kit.kind = 'single'
    const r = effectiveRole(on[0])
    kit.role = roleDef(r) ? r : 'center'
    return kit
  }
  const r1 = roleAt(1)
  const r2 = roleAt(2)
  for (const [place, [l, r]] of Object.entries(PLACE_ROLES) as [PairPlace, [string, string]][]) {
    if ((r1 === l && r2 === r) || (r1 === r && r2 === l)) {
      kit.place = place
      kit.swap = r1 === r
      break
    }
  }
  const first = on.find((s) => s.deviceChannel === 1) ?? on[0]
  kit.kind = first.bassReceiver && first.eqPreset !== 'subwoofer' ? 'pair21' : 'pair'
  kit.pairType = first.eqPreset === 'small-satellite' || (first.highPassHz ?? 0) > 0 ? 'small-satellite' : 'flat'
  return kit
}

/**
 * Sihirbazın başlangıç cevapları: mevcut hoparlörlerden çıkarılır; hiç hoparlör yoksa tahmin edilir
 * (ilk "Hoparlör" cihazı ön çift, çok kanallı cihaz çok kanallı, diğerleri kullanılmıyor).
 */
export function initialKits(candidates: Device[], speakers: Speaker[]): DeviceKit[] {
  const fromConfig = candidates.map((d) => kitFromSpeakers(d, speakers))
  if (fromConfig.some(Boolean)) return candidates.map((d, i) => fromConfig[i] ?? emptyKit(d))
  let frontTaken = false
  return candidates.map((d) => {
    const kit = emptyKit(d)
    if (isHeadphone(d)) return kit
    if (d.channels >= 6) {
      kit.kind = 'multi'
      frontTaken = true
      return kit
    }
    if (!frontTaken && /hoparl|speaker/i.test(d.name)) {
      kit.kind = 'pair'
      frontTaken = true
    }
    return kit
  })
}

/**
 * Sihirbaz açıkken listeye yeni giren (ya da açılışta henüz listelenmemiş) cihazların kitlerini ekler; listeden
 * çıkan cihazların kitlerini gizler. Kullanıcının bir kurulumu varsa (`configured`) yeni cihaz "kullanılmıyor"
 * başlar; yoksa ilk açılış tahmini (ön çift, çok kanallı) uygulanır.
 */
export function mergeKits(kits: DeviceKit[], candidates: Device[], configured: boolean): DeviceKit[] {
  const have = new Set(kits.map((k) => k.deviceId))
  const extra = initialKits(
    candidates.filter((d) => !have.has(d.id)),
    [],
  ).map((k) => (configured ? { ...k, kind: 'none' as const } : k))
  return [...kits.filter((k) => candidates.some((d) => d.id === k.deviceId)), ...extra]
}

/** Sihirbazın ürettiği tek bir hoparlör tanımı (henüz konumsuz). */
export interface PlannedSpeaker {
  deviceId: string
  channel: number
  role: string
  name: string
  /** Hoparlör ön ayarı (EQ / bas kesme / bas alıcısı). */
  preset: string
}

const ROLE_NAMES: Record<string, string> = { left: 'Ön sol', right: 'Ön sağ', [ROLE_SUB]: 'Subwoofer' }
export const plannedName = (role: string) => ROLE_NAMES[role] ?? roleLabel(role)

/** Kitlerden hoparlör listesi. */
export function planSpeakers(kits: DeviceKit[], devices: Device[]): PlannedSpeaker[] {
  const out: PlannedSpeaker[] = []
  for (const k of kits) {
    const d = devices.find((v) => v.id === k.deviceId)
    if (!d || k.kind === 'none') continue
    if (k.kind === 'pair' || k.kind === 'pair21') {
      const [l, r] = PLACE_ROLES[k.place]
      const preset = k.kind === 'pair21' ? 'desktop-front' : k.pairType
      const roles = k.swap ? [r, l] : [l, r]
      roles.forEach((role, i) => {
        if (i < d.channels) out.push({ deviceId: d.id, channel: i + 1, role, name: plannedName(role), preset })
      })
    } else if (k.kind === 'single') {
      const preset = k.role === ROLE_SUB ? 'subwoofer' : k.role === 'center' ? 'center' : 'flat'
      out.push({ deviceId: d.id, channel: 1, role: k.role, name: plannedName(k.role), preset })
    } else {
      k.roles.slice(0, d.channels).forEach((role, i) => {
        if (!role) return
        const preset = role === ROLE_SUB ? 'subwoofer' : role === 'center' ? 'center' : 'flat'
        out.push({ deviceId: d.id, channel: i + 1, role, name: plannedName(role), preset })
      })
    }
  }
  // Aynı rolden birden fazla varsa adlara sıra numarası ekle.
  const totals: Record<string, number> = {}
  for (const p of out) totals[p.role] = (totals[p.role] ?? 0) + 1
  const seen: Record<string, number> = {}
  for (const p of out) {
    if (totals[p.role] > 1) {
      seen[p.role] = (seen[p.role] ?? 0) + 1
      p.name = `${p.name} ${seen[p.role]}`
    }
  }
  return out
}

/** Rolün dinleyiciye göre standart açısı (0 = ön, + = sağ). Yan hoparlör varsa arkalar daha geriye alınır. */
export function roleAngle(role: string, hasSides: boolean): number {
  const back = hasSides ? 145 : 115
  const table: Record<string, number> = {
    left: -30,
    right: 30,
    center: 0,
    'wide-left': -60,
    'wide-right': 60,
    'side-left': -90,
    'side-right': 90,
    'back-left': -back,
    'back-right': back,
    'back-center': 180,
    [ROLE_SUB]: 20,
    'top-front-left': -45,
    'top-front-right': 45,
    'top-back-left': -135,
    'top-back-right': 135,
    'top-center': 0,
  }
  return table[role] ?? 0
}

/** Dinleyicinin duvarlara uzaklığına göre hoparlör yarıçapı (0,6..2 m). */
export function placementRadius(room: Room): number {
  const L = room.listener
  const toWall = Math.min(L.x, room.widthM - L.x, L.y, room.depthM - L.y)
  return round(clamp(Math.max(toWall, 0.6) * 0.95, 0.6, 2), 2)
}

export function standardPosition(role: string, room: Room, hasSides: boolean): Point {
  const r = placementRadius(room)
  const elevated = !!roleDef(role)?.elevated
  const p = polarToPoint(room.listener, roleAngle(role, hasSides), elevated ? r * 0.6 : role === 'top-center' ? 0 : r)
  const c = clampToRoom(p, room)
  return { x: round(c.x, 2), y: round(c.y, 2) }
}

export interface BuildResult {
  speakers: Speaker[]
  outputs: Output[]
  /** Yeni oluşturulan ya da rolü değişen hoparlörler (otomatik gecikme/kazanç açık başlar). */
  createdIds: string[]
}

/** Mevcut hoparlörlerin sihirbaz karşılığı (yeniden açılışta "ön ayar değişti mi?" karşılaştırması için). */
export function previousPlan(devices: Device[], speakers: Speaker[]): PlannedSpeaker[] {
  const kits = devices.flatMap((d) => {
    const k = kitFromSpeakers(d, speakers)
    return k ? [k] : []
  })
  return planSpeakers(kits, devices)
}

/** Sihirbazın kapsamadığı cihazlardaki (takılı değil, sanal, kaynak) hoparlörler: dokunulmadan korunur. */
export function outsideSpeakers(speakers: Speaker[], candidates: Device[]): Speaker[] {
  return speakers.filter((s) => !candidates.some((d) => d.id === s.outputDeviceId))
}

/** Hoparlörde kayıtlı ön ayar yoksa (ör. elle EQ = 'custom') alanlardan çıkarılan ön ayar. */
function impliedPreset(sp: Speaker): string {
  if (sp.eqPreset && speakerPresetPatch(sp.eqPreset)) return sp.eqPreset
  const role = effectiveRole(sp)
  if (role === ROLE_SUB) return 'subwoofer'
  if (sp.bassReceiver) return 'desktop-front'
  if ((sp.highPassHz ?? 0) > 0) return 'small-satellite'
  return role === 'center' ? 'center' : 'flat'
}

/** Rolün kaba yeri (taraf + bölge); bilinmeyen (özel) rolde null. Yer değişmezse hoparlör taşınmaz. */
function rolePlace(role: string): string | null {
  const def = roleDef(role)
  if (!def) return null
  if (role === ROLE_SUB) return 'sub'
  const a = roleAngle(role, false)
  const side = a < 0 ? 'L' : a > 0 ? 'R' : 'C'
  const abs = Math.abs(a)
  const zone = abs <= 45 ? 'front' : abs <= 100 ? 'side' : 'back'
  return `${def.elevated ? 'top-' : ''}${zone}-${side}`
}

export interface BuildOptions {
  /** Sihirbaz açılmadan önceki plan (bkz. `previousPlan`); ön ayarın değişip değişmediğini söyler. */
  prevPlan?: PlannedSpeaker[]
  /** Olduğu gibi sona eklenecek hoparlörler (bkz. `outsideSpeakers`). */
  keep?: Speaker[]
  /** Cihaz listesi: Bluetooth çıkışların yeni Output kaydı daha büyük tamponla açılır. */
  devices?: Device[]
}

/**
 * Planı hoparlörlere çevirir. Aynı cihaz + kanaldaki mevcut hoparlör korunur (kimlik, ad, konum, EQ, gecikme/kazanç,
 * kalibrasyon); ad bozuksa (�) yenilenir.
 * - Rol değişirse (ters takılı, çiftin yeri, kanal rolü): rol, karışım ve ad yeni role göre yazılır; gecikme/kazanç
 *   ve kalibrasyon sıfırlanır (otomatik açılır); taraf/bölge değiştiyse rolün standart konumuna taşınır.
 * - Planın ön ayarı öncekinden farklıysa (Normal → Küçük, çift → 2.1 set …) ön ayar yeniden uygulanır;
 *   aynıysa elle yapılmış EQ korunur.
 * Diğerleri standart konumla yeni oluşturulur.
 */
export function buildSpeakers(
  plan: PlannedSpeaker[],
  existing: Speaker[],
  outputs: Output[],
  room: Room,
  opts: BuildOptions = {},
): BuildResult {
  const keep = opts.keep ?? []
  const hasSides =
    plan.some((p) => p.role === 'side-left' || p.role === 'side-right') ||
    keep.some((s) => ['side-left', 'side-right'].includes(effectiveRole(s)))
  const stamp = Date.now().toString(36)
  const createdIds: string[] = []
  const usedPrev = new Set<string>()
  const keepIds = new Set(keep.map((s) => s.id))
  const presetOf = (sp: Speaker): string =>
    opts.prevPlan?.find((q) => q.deviceId === sp.outputDeviceId && q.channel === sp.deviceChannel)?.preset ??
    impliedPreset(sp)
  /** Ön ayarı baştan uygular: önceki bas kesme / bas alıcısı ayarı kalmasın. */
  const withPreset = (sp: Speaker, preset: string, role: string): Speaker => {
    const patch = speakerPresetPatch(preset)
    if (!patch) return sp
    const base: Speaker = { ...sp, highPassHz: undefined, bassReceiver: roleDef(role)?.bassReceiver || undefined }
    return { ...base, ...patch }
  }

  const speakers = plan.map((p, i): Speaker => {
    const same = existing.filter(
      (s) =>
        s.outputDeviceId === p.deviceId && s.deviceChannel === p.channel && !usedPrev.has(s.id) && !keepIds.has(s.id),
    )
    const prev = same.find((s) => effectiveRole(s) === p.role) ?? same[0]
    const def = roleDef(p.role)
    if (prev) {
      usedPrev.add(prev.id)
      const oldRole = effectiveRole(prev)
      const roleChanged = oldRole !== p.role
      let sp: Speaker = { ...prev, role: p.role, source: def ? { ...def.source } : prev.source }
      if (def?.elevated) sp.elevated = true
      else delete sp.elevated
      if (roleChanged) {
        sp.name = p.name
        sp.delayMs = 0
        sp.gainDb = 0
        delete sp.calibratedAt
        createdIds.push(sp.id)
        const before = rolePlace(oldRole)
        if (before !== null && before !== rolePlace(p.role)) {
          const pos = standardPosition(p.role, room, hasSides)
          sp.x = pos.x
          sp.y = pos.y
        }
      } else if (prev.name.includes('�') || !prev.name.trim()) {
        sp.name = p.name
      }
      if (presetOf(prev) !== p.preset) sp = withPreset(sp, p.preset, p.role)
      return sp
    }
    const id = `spk-${stamp}-${i}`
    createdIds.push(id)
    const pos = standardPosition(p.role, room, hasSides)
    const sp: Speaker = {
      id,
      name: p.name,
      outputDeviceId: p.deviceId,
      deviceChannel: p.channel,
      source: def ? { ...def.source } : {},
      delayMs: 0,
      gainDb: 0,
      mute: false,
      x: pos.x,
      y: pos.y,
      role: p.role,
      ...(def?.elevated ? { elevated: true } : {}),
    }
    return withPreset(sp, p.preset, p.role)
  })
  const all = [...speakers, ...keep]
  const used = [...new Set(all.map((s) => s.outputDeviceId))]
  const outs = used.map((id) => outputs.find((o) => o.deviceId === id) ?? {
      deviceId: id,
      latencyMs: 0,
      bufferMs: opts.devices?.find((d) => d.id === id)?.kind === 'bluetooth' ? BLUETOOTH_BUFFER_MS : 40,
    })
  return { speakers: all, outputs: outs, createdIds }
}

/** "5.1", "4.0", "2.1.2" gibi kısa özet. */
export function planLabel(plan: PlannedSpeaker[]): string {
  let floor = 0
  let sub = 0
  let top = 0
  for (const p of plan) {
    if (p.role === ROLE_SUB) sub++
    else if (roleDef(p.role)?.elevated) top++
    else floor++
  }
  // 2.1 seti: sol/sağ uydu + dahili sub = .1 sayılır.
  if (sub === 0 && plan.some((p) => p.preset === 'desktop-front')) sub = 1
  return top > 0 ? `${floor}.${sub}.${top}` : `${floor}.${sub}`
}
