/** Cihaz beklemesi bu kadar sürünce "eksik cihaz olmadan başlat" ve "cihaz seç" önerilir. */
export const WAIT_ACTION_MS = 30_000

export function waitedLongEnough(since: number | null, now: number, afterMs = WAIT_ACTION_MS): boolean {
  return since !== null && now - since >= afterMs
}

/** Eksik cihaz(lar) geri gelip motora eklenince gösterilen bildirim. */
export function rejoinMessage(names: string[]): string {
  const list = names.join(', ')
  return `${list} geri geldi, eklendi`
}
