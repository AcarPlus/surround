import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import { checkHealth } from '../lib/health'
import { SOUND_PRESETS } from '../lib/presets'
import { canUseAdvanced } from '../lib/mode'
import { RunButton } from '../components/TopBar'
import { VolumeControl } from '../components/VolumeControl'
import { Button, Card, SectionTitle, cx } from '../components/ui'
import { IconGear, IconMic, IconWand } from '../components/icons'
import { simpleStatus } from '../lib/simpleStatus'

/** Basit kipin üç büyük düğmesi → mevcut ses ön ayarları. */
const MODES: { id: string; label: string; hint: string }[] = [
  { id: 'film', label: 'Film', hint: 'Güçlü bas, geniş sahne' },
  { id: 'game', label: 'Oyun', hint: 'Ayak sesi ve yön öne çıkar' },
  { id: 'music', label: 'Müzik', hint: 'Dolgun bas, açık tizler' },
]

/** Basit kipin başlığı: uygulama adı + (isteğe bağlı) Ayarlar. */
export function SimpleHeader() {
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  const inSettings = screen === 'settings'
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="text-accent">
        <circle cx="12" cy="12" r="2.4" fill="currentColor" />
        <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M16.1 7.9a5.8 5.8 0 0 1 0 8.2M7.9 16.1a5.8 5.8 0 0 1 0-8.2" />
          <path d="M19.6 4.4a10.8 10.8 0 0 1 0 15.2M4.4 19.6a10.8 10.8 0 0 1 0-15.2" opacity="0.6" />
        </g>
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Surround</span>
      <div className="ml-auto flex items-center gap-2">
        {inSettings ? (
          <Button onClick={() => setScreen('home')}>Geri</Button>
        ) : (
          <button
            type="button"
            onClick={() => setScreen('settings')}
            aria-label="Ayarlar"
            title="Ayarlar"
            className="flex h-8 w-8 items-center justify-center rounded border border-line-strong text-muted hover:text-fg"
          >
            <IconGear width={16} height={16} />
          </button>
        )}
      </div>
    </header>
  )
}

/** Basit kip ana ekranı: başlat/durdur, ses, Film/Oyun/Müzik ve kurulum girişleri. */
export function SimpleHome() {
  const s = useStore()
  const items = useMemo(
    () =>
      checkHealth({
        devices: s.devices,
        source: s.source,
        speakers: s.speakers,
        upmix: s.upmix,
        upmixOptions: s.upmixOptions,
        processing: s.processing,
        running: s.runState === 'running',
        status: s.status,
        lowLatency: s.lowLatency,
        calibrated: !!s.lastCalibration,
        waiting: s.runState === 'waiting' ? { missing: s.waitingFor, message: s.waitMessage } : null,
      }),
    [s.devices, s.source, s.speakers, s.upmix, s.upmixOptions, s.processing, s.runState, s.status, s.lowLatency, s.lastCalibration, s.waitingFor, s.waitMessage],
  )
  const firstError = items.find((i) => i.level === 'error')
  const status = simpleStatus({
    speakerCount: s.speakers.length,
    calibrated: !!s.lastCalibration || s.speakers.some((sp) => !!sp.calibratedAt),
    runState: s.runState,
    waitingFor: s.waitingFor,
    problem: firstError?.title ?? null,
  })
  const hasSpeakers = s.speakers.length > 0

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-[560px] space-y-4 py-4">
        {!hasSpeakers ? (
          <Card className="p-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Hoparlörlerini tanıtalım</h1>
            <p className="mx-auto mb-5 mt-1.5 max-w-[420px] text-[13px] text-muted">
              Surround, bilgisayarına bağlı hoparlörlerden gerçek bir çevresel ses kurar. Başlamak için iki yoldan birini seç.
            </p>
            <SetupButtons />
          </Card>
        ) : (
          <>
            <Card className="flex flex-col items-center gap-4 p-6">
              <RunButton big />
              <p className={cx('text-center text-[13px]', status.tone === 'error' ? 'text-err' : status.tone === 'warn' ? 'text-warn' : status.tone === 'ok' ? 'text-ok' : 'text-muted')} role="status">
                {status.text}
              </p>
              {firstError?.fix && (
                <Button onClick={() => s.fixHealth(firstError.fix!.id, firstError.fix!.arg)}>{firstError.fix.label}</Button>
              )}
              <VolumeControl />
            </Card>

            <div>
              <SectionTitle>Ne dinliyorsun?</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                {MODES.map((m) => {
                  const active = s.processing.preset === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => s.applySoundPreset(m.id)}
                      title={SOUND_PRESETS.find((p) => p.id === m.id)?.hint}
                      className={cx(
                        'flex flex-col items-center gap-1 rounded-lg border px-3 py-5 text-center transition-colors',
                        active
                          ? 'border-accent bg-accent/10 text-fg'
                          : 'border-line-strong bg-surface text-muted hover:border-muted hover:text-fg',
                      )}
                    >
                      <span className={cx('text-[15px] font-semibold', active && 'text-accent')}>{m.label}</span>
                      <span className="text-[11px] leading-tight text-faint">{m.hint}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <Card className="p-4">
              <SectionTitle>Kurulum</SectionTitle>
              <p className="mb-3 text-xs text-muted">
                {s.lastCalibration
                  ? 'Hoparlörlerin ölçüldü. Yerlerini ya da odayı değiştirdiysen yeniden ölç; yeni hoparlör taktıysan Kolay kurulumu baştan yap.'
                  : 'Daha iyi ses için hoparlörlerini telefonun ya da bir mikrofonla ölç: gecikmeler, seviyeler ve oda eşitlenir.'}
              </p>
              <SetupButtons compact />
            </Card>
          </>
        )}

        {canUseAdvanced() && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => s.setUiMode('advanced')}
              className="rounded px-2 py-1 text-xs text-faint hover:bg-surface hover:text-fg"
              title="Oda planı, EQ, kalibrasyon ve diğer tüm ayarlar"
            >
              Gelişmiş mod
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SetupButtons({ compact }: { compact?: boolean }) {
  const openEasySetup = useStore((s) => s.openEasySetup)
  const openQuickStart = useStore((s) => s.openQuickStart)
  const calibrated = useStore((s) => !!s.lastCalibration || s.speakers.some((sp) => !!sp.calibratedAt))
  if (compact)
    // Hoparlörler var: ölçüm doğrudan mikrofon adımından başlar (Kolay kurulum, "Yeniden ölç").
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" className="!h-11 px-5 !text-[14px]" onClick={() => openEasySetup({ step: 'mic' })}>
          <IconMic /> {calibrated ? 'Yeniden ölç' : 'Hoparlörleri ölç'}
        </Button>
        <Button className="!h-11 px-4 !text-[14px]" onClick={() => openEasySetup()}>
          <IconWand /> Kolay kurulum
        </Button>
        <Button variant="ghost" className="!h-11 px-4 !text-[14px]" onClick={openQuickStart}>
          Ölçmeden başla
        </Button>
      </div>
    )
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button variant="primary" className="!h-11 px-5 !text-[14px]" onClick={() => openEasySetup()}>
        <IconWand /> Kolay kurulum
      </Button>
      <Button className="!h-11 px-5 !text-[14px]" onClick={openQuickStart}>
        Ölçmeden başla
      </Button>
    </div>
  )
}
