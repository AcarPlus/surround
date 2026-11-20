import type { Device, Output, Point, Room, Speaker } from '../api/types'
import { ROLE_SUB, roleDef } from './roles'
import {
  buildSpeakers,
  candidateDevices,
  defaultMultiRoles,
  isHeadphone,
  numberDuplicateNames,
  outsideSpeakers,
  planSpeakers,
  plannedName,
  previousPlan,
  type BuildResult,
  type DeviceKit,
  type PairPlace,
  type PlannedSpeaker,
} from './setup'
import { angleToPosition, nearestRole } from './tapPlace'

/**
 * "Ölçmeden başla" (Basit kip): cihazları otomatik bulur, her biri için makul bir kit tahmin eder,
 * kullanıcı hoparlörün yerine dokunarak yerini söyler; ölçüm yapılmaz (gecikme 0, kazanç 0, oda EQ'su yok).
 */

/** Dokunarak yerleştirmede önerilen cihazlar: kaynak, sanal kablo ve kulaklık çıkışları hariç. */
export function quickStartDevices(devices: Device[], sourceDeviceId: string): Device[] {
  const speakerLike = (d: Device) => /hoparl|speaker/i.test(d.name)
  const list = candidateDevices(devices, sourceDeviceId).filter((d) => !isHeadphone(d))
  // "Hoparlör" adlı cihazlar öne alınır (ön çift olurlar); sıra diğer yönden korunur.
  return [...list.filter(speakerLike), ...list.filter((d) => !speakerLike(d))]
}

/**
 * Kaynak olduğu için listeden düşen gerçek hoparlör (ör. VB-Cable yokken Windows sesi doğrudan bu cihazdan dinleniyor):
 * Surround aynı cihazı hem dinleyip hem çalamaz. VB-Cable kurulup kaynak yapılınca listeye girer. Yoksa null.
 */
export function blockedBySource(devices: Device[], sourceDeviceId: string): Device | null {
  const d = devices.find((x) => x.id === sourceDeviceId)
  if (!d || d.flow !== 'render' || /cable|virtual/i.test(d.name)) return null
  return d
}

/** İkinci, üçüncü … stereo çift sırayla bu yerlere konur (ön, arka, yan, üst ön, üst arka). */
const PAIR_PLACES: PairPlace[] = ['front', 'back', 'side', 'top-front', 'top-back']

/**
 * Cihazlardan kitler: dışlanmayan her cihaz stereo çift olur (ilki önde, sonrakiler arkada, yanda …);
 * 2'den çok kanallı cihaz varsayılan çok kanallı rolleriyle; tek kanallı cihaz tek hoparlör (orta) olur.
 */
export function quickStartKits(devices: Device[], excluded: ReadonlySet<string> = new Set()): DeviceKit[] {
  let pairs = 0
  return devices.map((d): DeviceKit => {
    const base: DeviceKit = {
      deviceId: d.id,
      kind: 'none',
      place: 'front',
      pairType: 'flat',
      swap: false,
      role: 'center',
      roles: defaultMultiRoles(d.channels),
    }
    if (excluded.has(d.id)) return base
    if (d.channels > 2) return { ...base, kind: 'multi' }
    if (d.channels < 2) return { ...base, kind: 'single' }
    const place = PAIR_PLACES[pairs % PAIR_PLACES.length]
    pairs++
    return { ...base, kind: 'pair', place }
  })
}

export interface TapOutcome {
  plan: PlannedSpeaker[]
  /** "cihaz#kanal" → dokunulan konum. */
  positions: Record<string, Point>
}

export const tapKey = (deviceId: string, channel: number) => `${deviceId}#${channel}`

/** Dokunuş sonucunu açılara işler: açı varsa yazar, null (Atla) ise siler (hoparlör standart yerinde kalır). */
export function setTapAngle(angles: Record<string, number>, key: string, angle: number | null): Record<string, number> {
  if (angle !== null) return { ...angles, [key]: angle }
  const { [key]: _drop, ...rest } = angles
  return rest
}

/**
 * Dokunulan açıları plana işler: rol en yakın zemin rolüne döner (subwoofer ve üst hoparlörler rolünü korur),
 * konum açıdan hesaplanır. `angles[i]` null ise (atlandı) hoparlör standart yerinde kalır.
 */
export function applyTaps(plan: PlannedSpeaker[], angles: (number | null | undefined)[], room: Room): TapOutcome {
  const positions: Record<string, Point> = {}
  const next = plan.map((p, i): PlannedSpeaker => {
    const a = angles[i]
    if (a === null || a === undefined) return { ...p }
    positions[tapKey(p.deviceId, p.channel)] = angleToPosition(a, room)
    const keepRole = p.role === ROLE_SUB || !!roleDef(p.role)?.elevated
    return { ...p, role: keepRole ? p.role : nearestRole(a) }
  })
  for (const p of next) p.name = plannedName(p.role)
  numberDuplicateNames(next)
  return { plan: next, positions }
}

export interface QuickStartInput {
  devices: Device[]
  sourceDeviceId: string
  excluded?: ReadonlySet<string>
  /** Plan sırasına göre dokunulan açılar (null/eksik = atlandı). */
  angles?: (number | null | undefined)[]
  speakers: Speaker[]
  outputs: Output[]
  room: Room
}

/** Planı (ve dokunulan konumları) hoparlörlere çevirir. Gecikme/kazanç 0; ölçüm ya da oda EQ'su yok. */
export function buildQuickStart(inp: QuickStartInput): BuildResult & { plan: PlannedSpeaker[] } {
  const list = quickStartDevices(inp.devices, inp.sourceDeviceId)
  const plan0 = planSpeakers(quickStartKits(list, inp.excluded), inp.devices)
  const { plan, positions } = applyTaps(plan0, inp.angles ?? [], inp.room)
  const built = buildSpeakers(plan, inp.speakers, inp.outputs, inp.room, {
    prevPlan: previousPlan(inp.devices, inp.speakers),
    // Listede olmayan cihazlardaki hoparlörler (kulaklık, takılı olmayan cihaz) korunur; dışlanan cihazınkiler kalkar.
    keep: outsideSpeakers(inp.speakers, list),
    devices: inp.devices,
  })
  const speakers = built.speakers.map((s) => {
    const p = positions[tapKey(s.outputDeviceId, s.deviceChannel)]
    return p ? { ...s, x: p.x, y: p.y } : s
  })
  return { ...built, speakers, plan }
}
