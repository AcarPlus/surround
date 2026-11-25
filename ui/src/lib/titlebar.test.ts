import { describe, expect, it } from 'vitest'
import {
  CORNER_GRIP,
  RESIZE_GRIP,
  captionButtons,
  initialWindowState,
  normalizeWindowState,
  topEdgeAt,
} from './titlebar'

describe('başlık çubuğu', () => {
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

  it('başlık çubuğu yalnız masaüstü uygulaması çerçeveyi kaldırdıysa çizilir', () => {
    expect(initialWindowState({}).frameless).toBe(false)
    expect(initialWindowState(undefined).frameless).toBe(false)
    expect(initialWindowState({ __SURROUND_FRAMELESS__: true }).frameless).toBe(true)
    expect(initialWindowState({ __SURROUND_FRAMELESS__: 'true' }).frameless).toBe(false)
  })
})
