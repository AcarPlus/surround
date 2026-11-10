import { flatEq } from '../api/types'
import { useStore } from '../store/useStore'
import { BigSlider, Button, Card, Chip, ScreenHeader, SectionTitle, Switch, cx } from '../components/ui'
import { EqEditor } from '../components/EqEditor'
import { CUSTOM_ID, CUSTOM_LABEL, SOUND_PRESETS } from '../lib/presets'
import { fmtSigned } from '../lib/format'
import { UpmixControls, UpmixStateBadge } from './SourcePanels'

/** Upmix: stereo sesten çevresel kanal üretimi (önceden Kaynak ekranındaydı). */
function SurroundCard() {
  const upmix = useStore((s) => s.upmix)
  const setUpmix = useStore((s) => s.setUpmix)
  return (
    <Card className="p-4">
      <label className="flex items-start justify-between gap-3">
        <span>
          <span className="block text-[14px] font-semibold">Stereo sesi çevresel yap (upmix)</span>
          <span className="mt-0.5 block text-xs text-muted">
            Stereo içerikten orta, sub ve arka/yan kanallar üretilir. Gerçek 5.1/7.1 ses gelince kendiliğinden yerel kanallara
            döner.
          </span>
        </span>
        <Switch checked={upmix} onChange={setUpmix} label="Upmix" />
      </label>
      <UpmixStateBadge />
      {upmix && (
        <div className="max-w-[640px]">
          <UpmixControls />
        </div>
      )}
    </Card>
  )
}

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
        sub="Çevresel ses ve tüm çıkışlara uygulanan ses işleme. Profil (üst çubuk) bunların hepsini tek tıkla değiştirir."
        right={
          <label className="flex items-center gap-2.5 text-[13px] font-medium">
            Ses işleme
            <Switch checked={p.enabled} onChange={(enabled) => setProcessing({ enabled })} label="Ses işleme" />
          </label>
        }
      />

      <SurroundCard />

      <div className={cx('mt-4 space-y-4 transition-opacity', off && 'opacity-50')}>
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
