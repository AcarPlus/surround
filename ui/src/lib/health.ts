import type { Device, LogicalChannel, Processing, SinkStatus, Source, Speaker, UpmixOptions } from '../api/types'
import { ROLE_SUB, effectiveRole } from './roles'

/**
 * Sistem kontrolü: yapılandırmadaki sorunları kullanıcının dilinde listeler.
 * Saf fonksiyon; düzeltme eylemlerini çağıran ekran bağlar (`fix` kimliği).
 */

export type HealthLevel = 'error' | 'warn' | 'info'

export type FixId =
  | 'open-setup'
  | 'select-cable'
  | 'open-sound-panel'
  | 'add-bass-receiver'
  | 'select-speaker'
  | 'open-calibration'
  | 'raise-buffer'
  | 'unmute-all'
  | 'enable-upmix'

export interface HealthItem {
  id: string
  level: HealthLevel
  title: string
  detail: string
  fix?: { id: FixId; label: string; arg?: string }
}

export interface HealthInput {
  devices: Device[]
  source: Source
  speakers: Speaker[]
  upmix: boolean
  upmixOptions: UpmixOptions
  processing: Processing
  running: boolean
  status: SinkStatus[]
  lowLatency: boolean
  /** Hiç kalibrasyon yapılmadıysa öneri gösterilir. */
  calibrated: boolean
}

const has = (sp: Speaker, ch: LogicalChannel) => (sp.source[ch] ?? 0) > 0
const anyOn = (speakers: Speaker[], ...chs: LogicalChannel[]) =>
  speakers.some((s) => !s.mute && chs.some((c) => has(s, c)))

export function findCable(devices: Device[]): Device | undefined {
  const renders = devices.filter((d) => d.flow === 'render' && /cable/i.test(d.name))
  return renders.find((d) => !/16ch/i.test(d.name)) ?? renders[0]
}

export function checkHealth(h: HealthInput): HealthItem[] {
  const items: HealthItem[] = []
  const { devices, speakers } = h
  const active = speakers.filter((s) => !s.mute)

  if (speakers.length === 0) {
    items.push({
      id: 'no-speakers',
      level: 'error',
      title: 'Hoparlör tanımlı değil',
      detail: 'Kurulum sihirbazı hangi cihaza ne bağlı olduğunu sorar ve hoparlörleri senin yerine oluşturur.',
      fix: { id: 'open-setup', label: 'Sihirbazı başlat' },
    })
    return items
  }

  // Kaynak
  const cable = findCable(devices)
  const src = devices.find((d) => d.id === h.source.deviceId)
  if (!src) {
    items.push({
      id: 'source-missing',
      level: 'error',
      title: 'Kaynak cihaz bulunamadı',
      detail: 'Seçili kaynak cihaz bağlı değil veya devre dışı.',
      fix: cable ? { id: 'select-cable', label: 'VB-Cable’ı seç' } : undefined,
    })
  } else if (!cable) {
    items.push({
      id: 'no-cable',
      level: 'warn',
      title: 'VB-Cable kurulu değil',
      detail: 'Oyunlar ve filmler gerçek 5.1/7.1 sesi ancak sanal bir 8 kanallı cihaza gönderebilir. Şimdilik stereo ses upmix ile dağıtılır.',
    })
  } else if (h.source.mode === 'loopback' && h.source.deviceId !== cable.id) {
    items.push({
      id: 'source-not-cable',
      level: 'warn',
      title: 'Kaynak VB-Cable değil',
      detail: `Ses “${src.name}” üzerinden alınıyor. Tüm hoparlörlerin Surround’dan geçmesi için kaynak CABLE Input olmalı.`,
      fix: { id: 'select-cable', label: 'VB-Cable’ı kaynak yap' },
    })
  } else if (cable.channels < 6 && h.source.deviceId === cable.id) {
    items.push({
      id: 'cable-2ch',
      level: 'warn',
      title: 'VB-Cable stereo ayarlı',
      detail: 'Windows ses panelinde CABLE Input → Yapılandır → 7.1 seçilmeli; yoksa yalnızca 2 kanal gelir.',
      fix: { id: 'open-sound-panel', label: 'Ses panelini aç' },
    })
  }

  // Cihazlar ve kanallar
  for (const s of speakers) {
    const d = devices.find((v) => v.id === s.outputDeviceId)
    if (!d) {
      items.push({
        id: `dev-missing-${s.id}`,
        level: 'error',
        title: `${s.name}: cihaz bağlı değil`,
        detail: 'Hoparlörün çıkış cihazı bulunamadı (çıkarılmış veya devre dışı). Başlat bu durumda hata verir.',
        fix: { id: 'select-speaker', label: 'Hoparlörü aç', arg: s.id },
      })
    } else if (s.deviceChannel > d.channels) {
      items.push({
        id: `ch-range-${s.id}`,
        level: 'error',
        title: `${s.name}: kanal yok`,
        detail: `“${d.name}” ${d.channels} kanallı; hoparlör ${s.deviceChannel}. kanala atanmış.`,
        fix: { id: 'select-speaker', label: 'Hoparlörü aç', arg: s.id },
      })
    } else if (h.source.mode === 'loopback' && d.id === h.source.deviceId) {
      items.push({
        id: `feedback-${s.id}`,
        level: 'error',
        title: `${s.name}: kaynak cihaza çıkıyor`,
        detail: 'Kaynakla aynı cihaza çıkış geri beslemeye yol açar.',
        fix: { id: 'select-speaker', label: 'Hoparlörü aç', arg: s.id },
      })
    }
    if (h.lowLatency && d?.kind === 'network') {
      items.push({
        id: `lowlat-${s.id}`,
        level: 'info',
        title: `${s.name} devre dışı`,
        detail: 'Düşük gecikme modunda ağ cihazları çalmaz.',
      })
    }
  }
  const seen = new Map<string, Speaker>()
  for (const s of speakers) {
    const k = `${s.outputDeviceId}#${s.deviceChannel}`
    const o = seen.get(k)
    if (o) {
      items.push({
        id: `clash-${s.id}`,
        level: 'warn',
        title: 'Aynı kanala iki hoparlör atanmış',
        detail: `“${o.name}” ve “${s.name}” aynı cihaz kanalını kullanıyor; sesleri karışır.`,
        fix: { id: 'select-speaker', label: 'Düzelt', arg: s.id },
      })
    } else seen.set(k, s)
  }

  // Bas yönetimi
  const cut = active.filter((s) => (s.highPassHz ?? 0) > 0)
  const receivers = active.filter((s) => s.bassReceiver)
  if (cut.length > 0 && receivers.length === 0) {
    items.push({
      id: 'bass-lost',
      level: 'warn',
      title: 'Kesilen bas kayboluyor',
      detail: `${cut.map((s) => s.name).join(', ')} hoparlörlerinin basları kesiliyor ama bası alacak hoparlör (subwoofer ya da 2.1 set) yok.`,
      fix: { id: 'add-bass-receiver', label: 'Önleri bas alıcısı yap' },
    })
  }
  const lfe = h.upmix && h.upmixOptions.lfeEnabled
  if (lfe && !anyOn(speakers, 'LFE') && receivers.length === 0) {
    items.push({
      id: 'lfe-nowhere',
      level: 'info',
      title: 'LFE kanalı duyulmuyor',
      detail: 'Subwoofer veya bas alıcısı yok; filmlerdeki ayrı bas efektleri (LFE) çalınmıyor.',
    })
  }

  // Surround dengesi — "yankılı" şikâyetinin kaynağı: bir tarafta arka/yan yoksa o tarafın ortam sesi önde kalır.
  const left = anyOn(speakers, 'BL', 'SL')
  const right = anyOn(speakers, 'BR', 'SR')
  if (left !== right) {
    const missing = left ? 'sağ' : 'sol'
    items.push({
      id: 'surround-unbalanced',
      level: 'warn',
      title: `Arka/yan ${missing} hoparlör yok`,
      detail: `Surround yalnızca bir tarafta. ${missing === 'sol' ? 'Sol' : 'Sağ'} ortam sesi ön hoparlörden çalar; sahne bir yana kayar.`,
      fix: { id: 'open-setup', label: 'Sihirbazda düzelt' },
    })
  }
  if (!left && !right && active.length >= 2) {
    items.push({
      id: 'no-surround',
      level: 'info',
      title: 'Arka veya yan hoparlör yok',
      detail: 'Şu an yalnızca önden ses geliyor. Arkaya bir çift eklemek için sihirbazı kullan.',
      fix: { id: 'open-setup', label: 'Sihirbazı aç' },
    })
  }
  const front = anyOn(speakers, 'FL') && anyOn(speakers, 'FR')
  if (!front) {
    items.push({
      id: 'no-front',
      level: 'warn',
      title: 'Ön sol/sağ eksik',
      detail: 'Müzik ve oyun seslerinin çoğu ön sol/sağ kanalda; bir ön çift tanımla.',
      fix: { id: 'open-setup', label: 'Sihirbazı aç' },
    })
  }
  if (!h.upmix && (left || right) && src && src.channels <= 2) {
    items.push({
      id: 'upmix-off',
      level: 'warn',
      title: 'Upmix kapalı, kaynak stereo',
      detail: 'Stereo kaynakta upmix kapalıyken arka hoparlörler sessiz kalır.',
      fix: { id: 'enable-upmix', label: 'Upmix’i aç' },
    })
  }

  const muted = speakers.filter((s) => s.mute)
  if (muted.length > 0) {
    items.push({
      id: 'muted',
      level: 'info',
      title: `${muted.length} hoparlör sessizde`,
      detail: muted.map((s) => s.name).join(', '),
      fix: { id: 'unmute-all', label: 'Hepsini aç' },
    })
  }

  // Çalışırken kesinti
  if (h.running) {
    for (const st of h.status) {
      if (st.underruns > 3) {
        const d = devices.find((v) => v.id === st.deviceId)
        items.push({
          id: `underrun-${st.deviceId}`,
          level: 'warn',
          title: `${d?.name ?? 'Bir cihaz'}: ses kesiliyor`,
          detail: `${st.underruns} kesinti. Tamponu büyütmek kesintileri azaltır (biraz gecikme ekler).`,
          fix: { id: 'raise-buffer', label: 'Tamponu büyüt', arg: st.deviceId },
        })
      }
    }
  }

  if (!h.calibrated && speakers.some((s) => effectiveRole(s) !== ROLE_SUB) && speakers.length >= 2) {
    items.push({
      id: 'not-calibrated',
      level: 'info',
      title: 'Kalibrasyon yapılmadı',
      detail: 'Gecikme ve seviyeler mesafeden tahmin ediliyor. Mikrofonla ölçüm cihazların kendi gecikmelerini de düzeltir.',
      fix: { id: 'open-calibration', label: 'Kalibre et' },
    })
  }

  const order: Record<HealthLevel, number> = { error: 0, warn: 1, info: 2 }
  return items.sort((a, b) => order[a.level] - order[b.level])
}
