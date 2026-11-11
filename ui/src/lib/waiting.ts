/** Cihaz beklemesi bu kadar sürünce "eksik cihaz olmadan başlat" ve "cihaz seç" önerilir. */
export const WAIT_ACTION_MS = 30_000

export function waitedLongEnough(since: number | null, now: number, afterMs = WAIT_ACTION_MS): boolean {
  return since !== null && now - since >= afterMs
}
