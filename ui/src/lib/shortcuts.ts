/** Uygulama geneli klavye kısayolları: hangi tuşun ne yapacağına karar veren saf fonksiyon (App.tsx kullanır). */

export interface KeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  /** Odak metin kutusunda / seçim listesinde. */
  typing: boolean
}

export interface ShortcutContext {
  screen: string
  selection: string | null
  /** Seçim dinleyici mi (silinemez). */
  listenerSelected: boolean
  /** Kurulum sihirbazı ya da bir kalıcı pencere (Dialog) açık. */
  modalOpen: boolean
}

export type ShortcutAction =
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'delete' }
  | { kind: 'deselect' }
  | { kind: 'nudge'; dx: number; dy: number }

export const NUDGE_M = 0.05

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-NUDGE_M, 0],
  ArrowRight: [NUDGE_M, 0],
  ArrowUp: [0, -NUDGE_M],
  ArrowDown: [0, NUDGE_M],
}

/**
 * - Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z): metin kutusunda değilken ve kalıcı pencere açık değilken (sihirbazın ya da
 *   pencerenin altındaki durumu değiştirmesin).
 * - Delete / Esc / ok tuşları yalnızca Oda ekranında ve bir seçim varken.
 */
export function resolveShortcut(e: KeyInput, ctx: ShortcutContext): ShortcutAction | null {
  if (e.typing || ctx.modalOpen) return null
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) return { kind: 'undo' }
    if (k === 'y' || (k === 'z' && e.shiftKey)) return { kind: 'redo' }
    return null
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (ctx.screen !== 'home' || !ctx.selection) return null
  if (e.key === 'Delete') return ctx.listenerSelected ? null : { kind: 'delete' }
  if (e.key === 'Escape') return { kind: 'deselect' }
  const v = ARROWS[e.key]
  return v ? { kind: 'nudge', dx: v[0], dy: v[1] } : null
}
