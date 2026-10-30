import type { Device } from '../api/types'

export const DEVICE_PALETTE_SIZE = 6

/** Cihaza sabit renk: çıkış (render) cihaz listesindeki sıraya göre. CSS değişkeni döner. */
export function deviceColorVar(deviceId: string, devices: Device[]): string {
  const renders = devices.filter((d) => d.flow === 'render')
  const i = renders.findIndex((d) => d.id === deviceId)
  return `rgb(var(--dev-${(i < 0 ? 0 : i) % DEVICE_PALETTE_SIZE}))`
}
