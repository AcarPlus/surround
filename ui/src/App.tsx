import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore, LISTENER_ID } from './store/useStore'
import { TopBar } from './components/TopBar'
import { NavRail } from './components/NavRail'
import { Inspector } from './components/Inspector'
import { HomeScreen } from './screens/HomeScreen'
import { RoomScreen } from './screens/RoomScreen'
import { ConnectionScreen } from './screens/ConnectionScreen'
import { CalibrationScreen } from './screens/CalibrationScreen'
import { SoundScreen } from './screens/SoundScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SetupWizard } from './screens/SetupWizard'
import { IconX } from './components/icons'
import { ErrorBoundary } from './components/ErrorBoundary'
import { cx } from './components/ui'

const NUDGE_M = 0.05

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function App() {
  const ready = useStore((s) => s.ready)
  const screen = useStore((s) => s.screen)
  const toast = useStore((s) => s.toast)
  const dismissToast = useStore((s) => s.dismissToast)
  const wizardOpen = useStore((s) => s.wizardOpen)

  useEffect(() => {
    document.documentElement.dataset.theme = useStore.getState().theme
    void useStore.getState().init()
  }, [])

  // Windows'taki değişiklikler (7.1 yapılandırma, varsayılan cihaz, takılan cihaz) uygulamaya kendiliğinden yansısın.
  useEffect(() => {
    if (!ready) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void useStore.getState().refreshDevices()
    }
    const id = window.setInterval(refresh, 3000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', refresh)
    }
  }, [ready])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState()
      // Geri al / yinele: metin kutusunda değilken (orada tarayıcının kendi geri alması çalışır).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !isTyping(e.target)) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault()
          st.undo()
          return
        }
        if (k === 'y' || (k === 'z' && e.shiftKey)) {
          e.preventDefault()
          st.redo()
          return
        }
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || st.wizardOpen) return
      if (!st.selection) return
      if (e.key === 'Delete' && st.selection !== LISTENER_ID) {
        e.preventDefault()
        st.removeSpeaker(st.selection)
        return
      }
      if (e.key === 'Escape') {
        st.select(null)
        return
      }
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-NUDGE_M, 0],
        ArrowRight: [NUDGE_M, 0],
        ArrowUp: [0, -NUDGE_M],
        ArrowDown: [0, NUDGE_M],
      }
      const v = d[e.key]
      if (v && st.screen === 'room') {
        e.preventDefault()
        st.nudgeSelected(v[0], v[1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full min-w-[1000px] flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="min-w-0 flex-1 bg-bg">
          {!ready ? (
            <div className="flex h-full items-center justify-center text-muted">Yükleniyor…</div>
          ) : (
            // Yalnızca CSS ile giriş geçişi: çıkış animasyonu yok, böylece pencere arka plandayken
            // (requestAnimationFrame durur) ekran değişimi takılmaz.
            <ErrorBoundary resetKey={screen}>
              <div key={screen} className="screen-in h-full">
                {screen === 'home' && <HomeScreen />}
                {screen === 'room' && <RoomScreen />}
                {screen === 'sound' && <SoundScreen />}
                {screen === 'calibration' && <CalibrationScreen />}
                {screen === 'connection' && <ConnectionScreen />}
                {screen === 'settings' && <SettingsScreen />}
              </div>
            </ErrorBoundary>
          )}
        </main>
        {screen === 'room' && <Inspector />}
      </div>
      {ready && wizardOpen && <SetupWizard />}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className={cx(
              'fixed bottom-5 left-1/2 z-[60] flex max-w-[min(680px,90vw)] -translate-x-1/2 items-center gap-3 rounded-md border bg-raised py-2 pl-3.5 pr-2 text-[13px] shadow-[var(--shadow)]',
              toast.tone === 'error' ? 'border-err/60' : 'border-line-strong',
            )}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <span className={cx(toast.tone === 'error' && 'text-err')}>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action!.run()
                }}
                className="shrink-0 rounded px-2 py-0.5 font-semibold text-accent hover:bg-surface"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={dismissToast}
              aria-label="Kapat"
              className="shrink-0 rounded p-1 text-faint hover:text-fg"
            >
              <IconX width={12} height={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
