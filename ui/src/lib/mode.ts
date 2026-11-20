/**
 * Arayüz kipi: Basit (yeni başlayanlar, tek ekran) ve Gelişmiş (tüm ekranlar).
 * Varsayılan Basit'tir; ayar config'te `uiMode` olarak saklanır (motor yok sayar, olduğu gibi korur).
 */
export type UiMode = 'simple' | 'advanced'

export const DEFAULT_UI_MODE: UiMode = 'simple'

/** Config'ten ya da başka kaynaktan gelen değeri kipe çevirir; eksik / bozuk değer → Basit. */
export function normalizeUiMode(v: unknown): UiMode {
  return v === 'advanced' ? 'advanced' : DEFAULT_UI_MODE
}

/**
 * Gelişmiş kip kullanılabilir mi?
 * TODO(lisans): Gelişmiş kip lisansa bağlanırsa kontrol yalnızca burada yapılır; kip geçişi (`resolveUiMode`,
 * store `setUiMode`) ve açılıştaki kip okuması bu işlevden geçer.
 */
export function canUseAdvanced(): boolean {
  return true
}

/** İstenen kipi izin verilen kipe çevirir (Gelişmiş kapalıysa Basit'e düşer). */
export function resolveUiMode(requested: UiMode): UiMode {
  return requested === 'advanced' && !canUseAdvanced() ? 'simple' : requested
}

/** İlk açılıştaki kurulum sihirbazı yalnızca Gelişmiş kipte kendiliğinden açılır (Basit kipte "Kolay kurulum" vardır). */
export function shouldAutoOpenWizard(mode: UiMode, speakerCount: number, setupDone: boolean): boolean {
  return mode === 'advanced' && speakerCount === 0 && !setupDone
}
