import { useEffect, useState } from 'react'
import type { ResizeEdge, WindowState } from '../api/types'
import { api } from '../api/client'
import { useStore } from '../store/useStore'
import appIcon from '../../../src/Surround.App/Assets/surround.ico'
import {
  CLOSE_HOVER,
  EDGE_CURSOR,
  TITLEBAR_HEIGHT,
  captionButtons,
  initialWindowState,
  normalizeWindowState,
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
function TopGrip({ maximized }: { maximized: boolean }) {
  const [cursor, setCursor] = useState<string>('ns-resize')
  if (maximized) return null
  const edgeOf = (e: React.PointerEvent<HTMLDivElement>): ResizeEdge | null => {
    const r = e.currentTarget.getBoundingClientRect()
    return topEdgeAt(e.clientX - r.left, e.clientY - r.top, r.width, false)
  }
  return (
    <div
      aria-hidden
      className="app-no-drag absolute inset-x-0 top-0 z-10 h-[5px]"
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
 * Uygulamanın kendi başlık çubuğu (Windows başlığının yerine, C# WindowFrame). Boş yeri sürüklenir ve çift tıkla
 * büyür (WebView2 `app-region: drag`; Aero Snap, sağ tık sistem menüsü dahil). Simge: sistem menüsü. Düğmeler
 * yerel küçült/büyüt/kapat komutlarını gönderir (animasyonlar ve tepsiye gizleme aynen). Pencere etkin değilken soluk.
 */
export function TitleBar() {
  const win = useWindowState()
  const theme = useStore((s) => s.theme)

  // Sistem menüsü ve Windows 11 kenarlığı temaya uysun.
  useEffect(() => {
    if (win.frameless) void api.windowCommand({ kind: 'theme', theme }).catch(() => {})
  }, [theme, win.frameless])

  if (!win.frameless) return null
  const dim = !win.active

  return (
    <div
      className={cx('titlebar app-drag relative z-[70] flex shrink-0 select-none items-stretch', dim && 'titlebar-inactive')}
      style={{ height: TITLEBAR_HEIGHT }}
    >
      <TopGrip maximized={win.maximized} />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Pencere menüsü"
        className="app-no-drag flex w-10 shrink-0 items-center justify-center"
        onClick={() => void api.windowCommand({ kind: 'menu' }).catch(() => {})}
        onDoubleClick={() => void api.windowCommand({ kind: 'button', button: 'close' }).catch(() => {})}
      >
        <img src={appIcon} alt="" width={16} height={16} draggable={false} className="titlebar-fade h-4 w-4" />
      </button>
      <span className="titlebar-fade flex items-center text-xs font-medium tracking-wide text-fg/80">Surround</span>
      <div className="flex-1" />
      <div className="app-no-drag flex">
        {captionButtons(win.maximized).map((b) => (
          <button
            key={b.button}
            type="button"
            tabIndex={-1}
            aria-label={b.label}
            title={b.label}
            className={cx('caption-btn', b.button === 'close' && 'caption-close')}
            style={b.button === 'close' ? ({ ['--close-hover' as string]: CLOSE_HOVER } as React.CSSProperties) : undefined}
            onClick={() => void api.windowCommand({ kind: 'button', button: b.button }).catch(() => {})}
          >
            <span className="caption-glyph titlebar-fade">{b.glyph}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
