import { Component, type ReactNode } from 'react'

/** Bir ekran çökerse tüm pencere boş kalmasın: hatayı gösterir, diğer ekranlara geçiş çalışmaya devam eder. */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; /** Verilirse küçük satır içi yedek gösterilir (TopBar, Inspector, sihirbaz). */ compact?: boolean },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.compact)
      return (
        <div role="alert" className="flex items-center gap-3 rounded border border-err/50 bg-surface px-3 py-2 text-xs">
          <span className="text-err">Bu bölüm açılamadı —</span>
          <button type="button" className="underline hover:text-fg" onClick={() => this.setState({ error: null })}>
            Yeniden dene
          </button>
        </div>
      )
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-[520px] rounded-lg border border-err/50 bg-surface p-5">
          <p className="text-[15px] font-semibold text-err">Bu ekran açılamadı</p>
          <p className="num mt-2 break-words text-xs text-muted">{this.state.error.message}</p>
          <button
            type="button"
            className="mt-4 rounded border border-line-strong px-3 py-1.5 text-[13px] hover:border-muted"
            onClick={() => this.setState({ error: null })}
          >
            Tekrar dene
          </button>
        </div>
      </div>
    )
  }
}
