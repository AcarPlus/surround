import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CAPTION_BUTTON_WIDTH,
  CORNER_GRIP,
  DRAG_THRESHOLD,
  NO_DRAG_SELECTOR,
  RESIZE_GRIP,
  captionAreaWidth,
  captionButtons,
  initialWindowState,
  isCaptionTarget,
  normalizeWindowState,
  syncFrameless,
  topEdgeAt,
} from './titlebar'

const source = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('pencere düğmeleri (üst satırda, ayrı başlık şeridi yok)', () => {
  it('düğmeler küçült, büyüt, kapat sırasında; büyütülünce glif ve ipucu "önceki boyut" olur', () => {
    const normal = captionButtons(false)
    expect(normal.map((b) => b.button)).toEqual(['minimize', 'maximize', 'close'])
    const max = captionButtons(true)
    expect(max[1].button).toBe('maximize')
    expect(max[1].glyph).not.toBe(normal[1].glyph)
    expect(max[1].label).toBe('Önceki boyutuna getir')
    expect(normal[1].label).toBe('Ekranı kapla')
  })

  it('üst şerit kenar/köşe tutamağıdır; büyütülmüşken ve şeridin altında yoktur', () => {
    const w = 1000
    expect(topEdgeAt(500, 0, w, false)).toBe('top')
    expect(topEdgeAt(0, 2, w, false)).toBe('topleft')
    expect(topEdgeAt(CORNER_GRIP - 1, 0, w, false)).toBe('topleft')
    expect(topEdgeAt(w - 1, 0, w, false)).toBe('topright')
    expect(topEdgeAt(500, RESIZE_GRIP, w, false)).toBeNull()
    expect(topEdgeAt(500, 0, w, true)).toBeNull()
    expect(topEdgeAt(-1, 0, w, false)).toBeNull()
  })

  it('köprü durumu doğrulanır; eksik/bozuk alanlar öncekinden kalır', () => {
    const prev = { frameless: true, maximized: false, active: true }
    expect(normalizeWindowState({ maximized: true, active: false }, prev)).toEqual({ frameless: true, maximized: true, active: false })
    expect(normalizeWindowState({ maximized: 'evet' }, prev)).toEqual(prev)
    expect(normalizeWindowState(null, prev)).toEqual(prev)
  })

  it('düğmeler yalnız masaüstü uygulaması çerçeveyi kaldırdıysa çizilir', () => {
    expect(initialWindowState({}).frameless).toBe(false)
    expect(initialWindowState(undefined).frameless).toBe(false)
    expect(initialWindowState({ __SURROUND_FRAMELESS__: true }).frameless).toBe(true)
    expect(initialWindowState({ __SURROUND_FRAMELESS__: 'true' }).frameless).toBe(false)
  })

  it('üst satır sağda üç düğmeye yer ayırır; çerçeve yokken (tarayıcı, yerel başlık) hiç ayırmaz', () => {
    expect(captionAreaWidth(true)).toBe(3 * CAPTION_BUTTON_WIDTH)
    expect(captionAreaWidth(false)).toBe(0)
  })

  it('çerçevesiz pencere html sınıfı ve --caption-w ile bildirilir; geri alınabilir', () => {
    const classes = new Set<string>()
    const vars = new Map<string, string>()
    const root = {
      classList: { toggle: (n: string, on?: boolean) => (on ? classes.add(n) : classes.delete(n), !!on) },
      style: { setProperty: (n: string, v: string) => void vars.set(n, v) },
    }
    syncFrameless(true, root)
    expect(classes.has('frameless')).toBe(true)
    expect(vars.get('--caption-w')).toBe(`${3 * CAPTION_BUTTON_WIDTH}px`)
    syncFrameless(false, root)
    expect(classes.has('frameless')).toBe(false)
    expect(vars.get('--caption-w')).toBe('0px')
  })

  it('ayrı başlık şeridi yok: uygulamanın üst satırı sürükleme alanıdır, düğmelere yer ayırır', () => {
    const main = source('../main.tsx')
    expect(main).not.toMatch(/TitleBar/)
    expect(main).toMatch(/<WindowControls \/>/)
    const header = source('../components/TopBar.tsx').match(/<header className="([^"]+)"/)?.[1] ?? ''
    expect(header.split(' ')).toEqual(expect.arrayContaining(['app-drag', 'caption-pad-right']))
  })

  it('CSS app-region yok: WebView2 bölge pencereleri animasyonlu üst satırda girdiyi kilitliyordu', () => {
    const css = source('../index.css')
    expect(css).not.toMatch(/\.titlebar\b/)
    expect(css).not.toMatch(/^\s*(-webkit-)?app-region\s*:/m)
    expect(source('../../../src/Surround.App/MainWindow.cs')).toMatch(/IsNonClientRegionSupportEnabled = false;/)
    expect(source('../components/WindowControls.tsx')).toMatch(/useCaptionDrag\(win\.frameless\)/)
  })
})

/** Sahte DOM düğümü: `closest` seçiciye göre atalarda arar (yalnız testte kullanılan seçiciler). */
class Node_ {
  constructor(
    readonly matches: (sel: string) => boolean,
    readonly parent: Node_ | null = null,
  ) {}
  closest(sel: string): Node_ | null {
    const parts = sel.split(',').map((s) => s.trim())
    for (let n: Node_ | null = this; n; n = n.parent) if (parts.some((p) => n!.matches(p))) return n
    return null
  }
  contains(other: Node_): boolean {
    for (let n: Node_ | null = other; n; n = n.parent) if (n === this) return true
    return false
  }
}
const el = (kinds: string[], parent: Node_ | null = null) => new Node_((s) => kinds.includes(s), parent)

describe('başlık gibi davranan boş yer (isCaptionTarget)', () => {
  const body = el([])
  const header = el(['.app-drag'], body)
  const logo = el([], header)

  it('üst satırın boş yeri ve içindeki yazı / simge başlıktır', () => {
    expect(isCaptionTarget(header)).toBe(true)
    expect(isCaptionTarget(logo)).toBe(true)
  })

  it('düğme, kaydırıcı ve no-drag kutunun içi başlık değildir', () => {
    const button = el(['button'], header)
    const glyph = el([], button)
    const volume = el(['.app-no-drag'], header)
    const slider = el(['input'], volume)
    expect(isCaptionTarget(button)).toBe(false)
    expect(isCaptionTarget(glyph)).toBe(false)
    expect(isCaptionTarget(volume)).toBe(false)
    expect(isCaptionTarget(slider)).toBe(false)
  })

  it('sürükleme alanı dışı başlık değildir; alanı örten no-drag ata (sihirbazın kökü) alanı iptal etmez', () => {
    expect(isCaptionTarget(el([], body))).toBe(false)
    expect(isCaptionTarget(null)).toBe(false)
    const wizard = el(['.app-no-drag', "[role='dialog']"], body)
    const wizardHeader = el(['.app-drag'], wizard)
    expect(isCaptionTarget(el([], wizardHeader))).toBe(true)
  })

  it('sürükleme birkaç piksel sonra başlar (tıklama ve çift tık sayfada kalır)', () => {
    expect(DRAG_THRESHOLD).toBeGreaterThanOrEqual(3)
    expect(NO_DRAG_SELECTOR).toContain('button')
    expect(NO_DRAG_SELECTOR).toContain('.app-no-drag')
  })
})
