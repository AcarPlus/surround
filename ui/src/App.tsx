import { useEffect } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useStore, LISTENER_ID } from './store/useStore'
import { TopBar } from './components/TopBar'
import { CableGate, cableMissing } from './components/CableGate'
import { NavRail } from './components/NavRail'
import { HomeScreen } from './screens/HomeScreen'
import { CalibrationScreen } from './screens/CalibrationScreen'
import { SoundScreen } from './screens/SoundScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SetupWizard } from './screens/SetupWizard'
import { IconX } from './components/icons'
import { AuroraSky } from './components/aurora'
import { ErrorBoundary } from './components/ErrorBoundary'
import { InitErrorScreen } from './components/InitErrorScreen'
import { cx } from './components/ui'
import { frameEnergy, useLevels } from './lib/useLevels'
import { resolveShortcut } from './lib/shortcuts'

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** Sihirbaz ya da bir Dialog açık mı (ikisi de role="dialog" aria-modal="true" taşır). */
const modalOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]')

export function App() {
  const ready = useStore((s) => s.ready)
  const screen = useStore((s) => s.screen)
  const toast = useStore((s) => s.toast)
  const dismissToast = useStore((s) => s.dismissToast)
  const wizardOpen = useStore((s) => s.wizardOpen)
  const initError = useStore((s) => s.initError)
  const devices = useStore((s) => s.devices)
  const runState = useStore((s) => s.runState)
  const energy = frameEnergy(useLevels(runState === 'running'))
  const gate = cableMissing(devices)

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
      const action = resolveShortcut(
        { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, typing: isTyping(e.target) },
        {
          screen: st.screen,
          selection: st.selection,
          listenerSelected: st.selection === LISTENER_ID,
          modalOpen: st.wizardOpen || modalOpen(),
        },
      )
      if (!action) return
      switch (action.kind) {
        case 'undo':
          e.preventDefault()
          st.undo()
          break
        case 'redo':
          e.preventDefault()
          st.redo()
          break
        case 'delete':
          e.preventDefault()
          if (st.selection) st.removeSpeaker(st.selection)
          break
        case 'deselect':
          st.select(null)
          break
        case 'nudge':
          e.preventDefault()
          st.nudgeSelected(action.dx, action.dy)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const loading = !ready ? (
    initError ? (
      <InitErrorScreen />
    ) : (
      <div className="flex h-full items-center justify-center text-muted">Yükleniyor…</div>
    )
  ) : null

  // VB-Cable hazır değilse uygulamanın tek ekranı kurulum kapısıdır.
  if (ready && gate) {
    return (
      <div className="h-full min-w-[1000px]">
        {/* Üst satır yok: pencereyi tepedeki boş şeritten sürükle (görünmez, yalnız çerçevesiz pencerede etkin). */}
        <div aria-hidden className="frameless-only app-drag fixed inset-x-0 top-0 h-8" />
        <ErrorBoundary compact>
          <CableGate devices={devices} />
        </ErrorBoundary>
      </div>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
    <div className="relative isolate flex h-full min-w-[1000px] flex-col bg-bg" style={{ ['--energy' as string]: energy.toFixed(3) }}>
      {/* Aurora göğü: akan renk perdeleri ve yıldızlar; motor çalışırken sesle parlar. Cam paneller bunun üstünde durur. */}
      <AuroraSky live={runState === 'running'} />
      <ErrorBoundary compact>
        <TopBar />
      </ErrorBoundary>
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="min-w-0 flex-1">
          {loading ?? (
            // Yalnızca CSS ile giriş geçişi: çıkış animasyonu yok, böylece pencere arka plandayken
            // (requestAnimationFrame durur) ekran değişimi takılmaz.
            <ErrorBoundary resetKey={screen}>
              <div key={screen} className="screen-in h-full">
                {screen === 'home' && <HomeScreen />}
                {screen === 'sound' && <SoundScreen />}
                {screen === 'calibration' && <CalibrationScreen />}
                {screen === 'settings' && <SettingsScreen />}
              </div>
            </ErrorBoundary>
          )}
        </main>
      </div>
      {ready && wizardOpen && (
        <ErrorBoundary compact>
          <SetupWizard />
        </ErrorBoundary>
      )}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 18, scale: 0.94, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 10, scale: 0.97, filter: 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            style={{ x: '-50%' }}
            className={cx(
              'glass-card fixed bottom-5 left-1/2 z-[60] flex max-w-[min(680px,90vw)] items-center gap-3 rounded-2xl py-2.5 pl-4 pr-2 text-[13px] shadow-[var(--shadow)]',
              toast.tone === 'error' ? 'border-err/60' : 'border-line-strong',
            )}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <span className="min-w-0">
              <span className={cx(toast.tone === 'error' && 'text-err')}>{toast.message}</span>
              {toast.detail && (
                <details className="mt-1 text-xs text-faint">
                  <summary className="cursor-pointer">Ayrıntı</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{toast.detail}</pre>
                </details>
              )}
            </span>
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
    </MotionConfig>
  )
}
