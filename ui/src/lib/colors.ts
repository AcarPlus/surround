import type { Device } from '../api/types'

export const DEVICE_PALETTE_SIZE = 6

function paletteIndex(deviceId: string, devices: Device[]): number {
  const renders = devices.filter((d) => d.flow === 'render')
  const i = renders.findIndex((d) => d.id === deviceId)
  return (i < 0 ? 0 : i) % DEVICE_PALETTE_SIZE
}

/** Cihaza sabit renk: çıkış (render) cihaz listesindeki sıraya göre. CSS değişkeni döner. */
export function deviceColorVar(deviceId: string, devices: Device[]): string {
  return `rgb(var(--dev-${paletteIndex(deviceId, devices)}))`
}

/** Aynı renk, saydamlıkla (`a` 0..1): parıltı ve ışın çizgileri için. */
export function deviceColorAlpha(deviceId: string, devices: Device[], a: number): string {
  return `rgb(var(--dev-${paletteIndex(deviceId, devices)}) / ${Math.max(0, Math.min(1, a)).toFixed(3)})`
}
