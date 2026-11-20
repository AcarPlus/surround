import { describe, expect, it } from 'vitest'
import { DEFAULT_UI_MODE, canUseAdvanced, normalizeUiMode, resolveUiMode, shouldAutoOpenWizard } from './mode'

describe('arayüz kipi', () => {
  it('varsayılan Basit; eksik ya da bozuk değer Basit olur', () => {
    expect(DEFAULT_UI_MODE).toBe('simple')
    expect(normalizeUiMode(undefined)).toBe('simple')
    expect(normalizeUiMode(null)).toBe('simple')
    expect(normalizeUiMode('foo')).toBe('simple')
    expect(normalizeUiMode('simple')).toBe('simple')
    expect(normalizeUiMode('advanced')).toBe('advanced')
  })

  it('Gelişmiş şimdilik serbest; istenen kip korunur', () => {
    expect(canUseAdvanced()).toBe(true)
    expect(resolveUiMode('advanced')).toBe('advanced')
    expect(resolveUiMode('simple')).toBe('simple')
  })

  it('sihirbaz yalnızca Gelişmiş kipte, boş ve kurulmamış yapılandırmada kendiliğinden açılır', () => {
    expect(shouldAutoOpenWizard('advanced', 0, false)).toBe(true)
    expect(shouldAutoOpenWizard('simple', 0, false)).toBe(false)
    expect(shouldAutoOpenWizard('advanced', 2, false)).toBe(false)
    expect(shouldAutoOpenWizard('advanced', 0, true)).toBe(false)
  })
})
