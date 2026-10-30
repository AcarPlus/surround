import type { ReactNode } from 'react'
import { flatEq } from '../api/types'
import { useStore } from '../store/useStore'
import { Button, Card, ScreenHeader, SectionTitle, Switch, cx } from '../components/ui'
import { EqEditor } from '../components/EqEditor'
import { CUSTOM_ID, CUSTOM_LABEL, SOUND_PRESETS } from '../lib/presets'
import { fmtSigned } from '../lib/format'

export function SoundScreen() {
  const p = useStore((s) => s.processing)
  const setProcessing = useStore((s) => s.setProcessing)
  const applySoundPreset = useStore((s) => s.applySoundPreset)
  const off = !p.enabled
  const active = SOUND_PRESETS.find((x) => x.id === p.preset)

  return (
    <div className="h-full overflow-y-auto p-5">
      <ScreenHeader
        title="Ses"
        sub="Tüm çıkışlara uygulanan ses işleme: ön ayar seç, istersen ince ayar yap."
        right={
          <label className="flex items-center gap-2.5 text-[13px] font-medium">
            Ses işleme
            <Switch checked={p.enabled} onChange={(enabled) => setProcessing({ enabled })} label="Ses işleme" />
          </label>
        }
      />

      <div className={cx('space-y-4 transition-opacity', off && 'opacity-50')}>
        <Card className="p-4">
          <SectionTitle
            right={
              <span className="text-xs text-muted">
                {active ? active.hint : p.preset === CUSTOM_ID ? 'Elle ayarlandı.' : ''}
              </span>
            }
          >
            Ön ayar
          </SectionTitle>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Ses ön ayarları">
            {SOUND_PRESETS.map((s) => (
              <Chip key={s.id} active={p.preset === s.id} onClick={() => applySoundPreset(s.id)}>
                {s.label}
              </Chip>
            ))}
            <Chip active={!active} disabled>
              {CUSTOM_LABEL}
            </Chip>
          </div>
        </Card>

        <Card className="space-y-5 p-4">
          <SectionTitle>Ses karakteri</SectionTitle>
          <BigSlider
            label="Bas güçlendirme"
            hint="Derin sesleri öne çıkarır."
            value={p.bassBoostDb}
            min={0}
            max={12}
            step={0.5}
            display={`${fmtSigned(p.bassBoostDb, 1)} dB`}
            onChange={(bassBoostDb) => setProcessing({ bassBoostDb })}
          />
          <BigSlider
            label="Netlik"
            hint="Konuşma ve ince ayrıntıları belirginleştirir."
            value={p.clarityDb}
            min={0}
            max={12}
            step={0.5}
            display={`${fmtSigned(p.clarityDb, 1)} dB`}
            onChange={(clarityDb) => setProcessing({ clarityDb })}
          />
          <BigSlider
            label="Dinamik güçlendirme"
            hint="Sessiz sesleri yükseltir, gürültülüleri dengeler. Gece dinlemek için ideal."
            value={p.dynamicBoost}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(p.dynamicBoost * 100)}%`}
            onChange={(dynamicBoost) => setProcessing({ dynamicBoost })}
          />
          <BigSlider
            label="Ortam / genişlik"
            hint="Sahneyi genişletir; ön, arka ve yan çiftlerde etki eder."
            value={p.ambience}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(p.ambience * 100)}%`}
            onChange={(ambience) => setProcessing({ ambience })}
          />
          <BigSlider
            label="Ön kazanç"
            hint="Güçlendirme yaparken payı korumak için eksiye çekilir."
            value={p.preampDb}
            min={-24}
            max={12}
            step={0.5}
            display={`${fmtSigned(p.preampDb, 1)} dB`}
            onChange={(preampDb) => setProcessing({ preampDb })}
          />
        </Card>

        <Card className="p-4">
          <SectionTitle
            right={
              <Button size="sm" variant="ghost" onClick={() => setProcessing({ eq: flatEq() })}>
                Sıfırla
              </Button>
            }
          >
            10 bant ekolayzır
          </SectionTitle>
          <EqEditor value={p.eq} onChange={(eq) => setProcessing({ eq })} />
          <p className="mt-2 text-xs text-faint">Bandı sürükle; çift tıklayınca o bant sıfırlanır. Hz cinsinden merkez frekanslar.</p>
        </Card>
      </div>

      {/* Limiter, ses işleme kapalıyken de çalışır; bu yüzden soluklaştırılan bölümün dışında. */}
      <Card className="mt-4 flex items-center justify-between gap-4 p-4">
        <div>
          <span className="block text-[13px] font-medium">Limiter</span>
          <span className="mt-0.5 block text-xs text-muted">
            Cızırtıyı önler: her çıkışta tepe sesleri −1 dBFS’te sınırlar. Ses işleme kapalıyken de çalışır.
          </span>
        </div>
        <Switch checked={p.limiter} onChange={(limiter) => setProcessing({ limiter })} label="Limiter" />
      </Card>
    </div>
  )
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cx(
        'h-8 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
        active
          ? 'border-accent bg-accent text-accent-fg'
          : 'border-line-strong bg-raised text-muted hover:border-muted hover:text-fg disabled:hover:border-line-strong disabled:hover:text-muted',
        disabled && !active && 'opacity-50',
        disabled && 'cursor-default',
      )}
    >
      {children}
    </button>
  )
}

function BigSlider(props: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
}) {
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium">{props.label}</span>
        <span className="num text-[13px] text-fg">{props.display}</span>
      </div>
      <input
        type="range"
        className="big-range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <p className="mt-0.5 text-xs text-faint">{props.hint}</p>
    </div>
  )
}
