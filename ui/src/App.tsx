import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore, LISTENER_ID } from './store/useStore'
import { TopBar } from './components/TopBar'
import { NavRail } from './components/NavRail'
import { Inspector } from './components/Inspector'
import { RoomScreen } from './screens/RoomScreen'
import { DevicesScreen } from './screens/DevicesScreen'
import { SourceScreen } from './screens/SourceScreen'
import { CalibrationScreen } from './screens/CalibrationScreen'
import { SoundScreen } from './screens/SoundScreen'
import { SettingsScreen } from './screens/SettingsScreen'

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
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const st = useStore.getState()
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
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={screen}
                className="h-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                {screen === 'room' && <RoomScreen />}
                {screen === 'devices' && <DevicesScreen />}
                {screen === 'source' && <SourceScreen />}
                {screen === 'sound' && <SoundScreen />}
                {screen === 'calibration' && <CalibrationScreen />}
                {screen === 'settings' && <SettingsScreen />}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
        <Inspector />
      </div>
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none fixed bottom-5 left-1/2 z-50 max-w-[min(640px,90vw)] -translate-x-1/2 rounded-md border border-line-strong bg-raised px-3.5 py-2 text-[13px] shadow-[var(--shadow)]"
            role="status"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
