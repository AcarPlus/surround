import { useEffect, useState } from 'react'
import type { ResizeEdge, WindowState } from '../api/types'
import { api } from '../api/client'
import { useStore } from '../store/useStore'
import {
  CAPTION_BUTTON_HEIGHT,
  CAPTION_BUTTON_WIDTH,
  CLOSE_HOVER,
  EDGE_CURSOR,
  captionButtons,
  initialWindowState,
  normalizeWindowState,
  syncFrameless,
  topEdgeAt,
} from '../lib/titlebar'
import { cx } from './ui'

/** Pencerenin büyütülmüş/etkin durumu (masaüstü köprüsünden; tarayıcıda hep "çerçeveli"). */
function useWindowState(): WindowState {
  const [state, setState] = useState(initialWindowState)
  useEffect(() => {
    if (!state.frameless) return
    let alive = true
    const apply = (d: unknown) => alive && setState((prev) => normalizeWindowState(d, prev))
    const off = api.onWindowState(apply)
    api.getWindowState().then(apply, () => {})
    return () => {
      alive = false
      off()
    }
  }, [state.frameless])
  return state
}

/** Üst kenar tutamağı: Windows'un üst çerçevesi sayfanın altında kaldığı için yeniden boyutlandırmayı buradan başlatır. */
function TopGrip() {
  const [cursor, setCursor] = useState<string>('ns-resize')
  const edgeOf = (e: React.PointerEvent<HTMLDivElement>): ResizeEdge | null => {
    const r = e.currentTarget.getBoundingClientRect()
    return topEdgeAt(e.clientX - r.left, e.clientY - r.top, r.width, false)
  }
  return (
    <div
      aria-hidden
      className="app-no-drag fixed inset-x-0 top-0 z-[91] h-[5px]"
      style={{ cursor }}
      onPointerMove={(e) => {
        const edge = edgeOf(e)
        if (edge) setCursor(EDGE_CURSOR[edge])
      }}
      onPointerDown={(e) => {
        const edge = edgeOf(e)
        if (e.button !== 0 || !edge) return
        e.preventDefault()
        void api.windowCommand({ kind: 'resize', edge })
      }}
    />
  )
}

/**
 * Küçült / büyüt / kapat: ayrı başlık şeridi yok, uygulamanın üst satırının sağ üst köşesinde (Windows 11 gibi)
 * durur. Sabit konumlu ve en üstte: sihirbaz, iletişim kutuları ve kablo ekranı açıkken de erişilir. Üst satırın
 * boş yeri sürüklenir ve çift tıkla büyür (WebView2 `app-region: drag`, TopBar). Pencere etkin değilken soluk.
 */
export function WindowControls() {
  const win = useWindowState()
  const theme = useStore((s) => s.theme)

  useEffect(() => syncFrameless(win.frameless), [win.frameless])

  // Sistem menüsü ve Windows 11 kenarlığı temaya uysun.
  useEffect(() => {
    if (win.frameless) void api.windowCommand({ kind: 'theme', theme }).catch(() => {})
  }, [theme, win.frameless])

  if (!win.frameless) return null

  return (
    <>
      {!win.maximized && <TopGrip />}
      <div
        className={cx('caption-bar app-no-drag fixed right-0 top-0 z-[90] flex select-none', !win.active && 'caption-inactive')}
        style={{ height: CAPTION_BUTTON_HEIGHT }}
      >
        {captionButtons(win.maximized).map((b) => (
          <button
            key={b.button}
            type="button"
            tabIndex={-1}
            aria-label={b.label}
            title={b.label}
            className={cx('caption-btn', b.button === 'close' && 'caption-close')}
            style={{
              width: CAPTION_BUTTON_WIDTH,
              ...(b.button === 'close' ? { ['--close-hover' as string]: CLOSE_HOVER } : {}),
            }}
            onClick={() => void api.windowCommand({ kind: 'button', button: b.button }).catch(() => {})}
          >
            <span className="caption-glyph">{b.glyph}</span>
          </button>
        ))}
      </div>
    </>
  )
}
