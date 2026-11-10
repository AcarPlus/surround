import { describe, expect, it } from 'vitest'
import { NUDGE_M, resolveShortcut, type KeyInput, type ShortcutContext } from './shortcuts'

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  typing: false,
  ...extra,
})
const ctx = (extra: Partial<ShortcutContext> = {}): ShortcutContext => ({
  screen: 'room',
  selection: 'spk-1',
  listenerSelected: false,
  modalOpen: false,
  ...extra,
})

describe('resolveShortcut', () => {
  it('Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z her ekranda çalışır', () => {
    expect(resolveShortcut(key('z', { ctrlKey: true }), ctx({ screen: 'home' }))).toEqual({ kind: 'undo' })
    expect(resolveShortcut(key('y', { ctrlKey: true }), ctx({ screen: 'sound' }))).toEqual({ kind: 'redo' })
    expect(resolveShortcut(key('Z', { ctrlKey: true, shiftKey: true }), ctx())).toEqual({ kind: 'redo' })
  })

  it('sihirbaz ya da pencere açıkken ve metin kutusundayken hiçbir kısayol çalışmaz', () => {
    expect(resolveShortcut(key('z', { ctrlKey: true }), ctx({ modalOpen: true }))).toBeNull()
    expect(resolveShortcut(key('Delete'), ctx({ modalOpen: true }))).toBeNull()
    expect(resolveShortcut(key('z', { ctrlKey: true, typing: true }), ctx())).toBeNull()
  })

  it('Delete / Esc / oklar yalnızca Oda ekranında', () => {
    expect(resolveShortcut(key('Delete'), ctx({ screen: 'home' }))).toBeNull()
    expect(resolveShortcut(key('Escape'), ctx({ screen: 'settings' }))).toBeNull()
    expect(resolveShortcut(key('ArrowLeft'), ctx({ screen: 'home' }))).toBeNull()
    expect(resolveShortcut(key('Delete'), ctx())).toEqual({ kind: 'delete' })
    expect(resolveShortcut(key('Escape'), ctx())).toEqual({ kind: 'deselect' })
    expect(resolveShortcut(key('ArrowUp'), ctx())).toEqual({ kind: 'nudge', dx: 0, dy: -NUDGE_M })
  })

  it('dinleyici silinmez, seçim yoksa bir şey olmaz', () => {
    expect(resolveShortcut(key('Delete'), ctx({ selection: 'listener', listenerSelected: true }))).toBeNull()
    expect(resolveShortcut(key('Delete'), ctx({ selection: null }))).toBeNull()
  })
})
