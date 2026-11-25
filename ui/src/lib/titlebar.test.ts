import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CAPTION_BUTTON_WIDTH,
  CORNER_GRIP,
  RESIZE_GRIP,
  captionAreaWidth,
  captionButtons,
  initialWindowState,
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

  it('sürükleme alanı yalnız çerçevesiz pencerede; etkileşimli öğeler sürüklemez', () => {
    const css = source('../index.css')
    expect(css).not.toMatch(/\.titlebar\b/)
    expect(css).toMatch(/\.frameless \.app-drag \{\s*app-region: drag;/)
    expect(css).toMatch(/\.frameless \.app-drag :where\(button, input, select/)
    expect(css).not.toMatch(/^\.app-drag \{/m)
  })
})
