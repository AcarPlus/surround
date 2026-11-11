import { useEffect, useMemo, useRef, useState } from 'react'
import { flatEq } from '../api/types'
import { useStore } from '../store/useStore'
import { BigSlider, Button, Card, Chip, ScreenHeader, SectionTitle, Switch, cx } from '../components/ui'
import { EqEditor } from '../components/EqEditor'
import { EqCurve } from '../components/EqCurve'
import { PeqEditor } from '../components/PeqEditor'
import { PresetManager } from '../components/PresetManager'
import { CUSTOM_ID, CUSTOM_LABEL, SOUND_PRESETS, userPresetKey } from '../lib/presets'
import { autoPreampDb } from '../lib/eqCurve'
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

/**
 * A/B: genel işlemeyi geçici olarak atlar. Basılı tutunca işlemesiz dinler, bırakınca döner; kısa tıklama aç/kapat yapar.
 * Ayar değişmez ve geri alma geçmişine yazılmaz (bkz. store `setAbBypass`).
 */
function AbButton() {
  const ab = useStore((s) => s.abBypass)
  const enabled = useStore((s) => s.processing.enabled)
  const setAb = useStore((s) => s.setAbBypass)
  const press = useRef<{ at: number; wasOff: boolean } | null>(null)
  return (
    <button
      type="button"
      aria-pressed={ab}
      disabled={!enabled && !ab}
      title="Basılı tut: işlemesiz (orijinal) sesi dinle. Kısa tıkla: aç / kapat."
      className={cx(
        'inline-flex h-8 select-none items-center gap-1.5 rounded border px-3 text-[13px] font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        ab ? 'border-warn bg-warn/15 text-warn' : 'border-line-strong bg-raised text-fg hover:border-muted',
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        press.current = { at: Date.now(), wasOff: !ab }
        if (!ab) setAb(true)
      }}
      onPointerUp={() => {
        const p = press.current
        press.current = null
        if (!p) return
        if (p.wasOff ? Date.now() - p.at > 450 : true) setAb(false)
      }}
      onPointerCancel={() => {
        press.current = null
        setAb(false)
      }}
      onClick={(e) => {
        // Klavye (Boşluk/Enter) tıklaması: aç/kapat. Fare/dokunma zaten pointer olaylarıyla işlendi.
        if (e.detail === 0) setAb(!ab)
      }}
    >
      A/B (işlemesiz dinle)
    </button>
  )
}

export function SoundScreen() {
  const p = useStore((s) => s.processing)
  const setProcessing = useStore((s) => s.setProcessing)
  const applySoundPreset = useStore((s) => s.applySoundPreset)
  const user = useStore((s) => s.userSoundPresets)
  const applyUser = useStore((s) => s.applyUserSoundPreset)
  const saveUser = useStore((s) => s.saveUserSoundPreset)
  const overwriteUser = useStore((s) => s.overwriteUserSoundPreset)
  const renameUser = useStore((s) => s.renameUserSoundPreset)
  const deleteUser = useStore((s) => s.deleteUserSoundPreset)
  const ab = useStore((s) => s.abBypass)
  const setAb = useStore((s) => s.setAbBypass)
  const [peqSel, setPeqSel] = useState<string | null>(null)
  const off = !p.enabled
  const active = SOUND_PRESETS.find((x) => x.id === p.preset)
  const activeUser = user.find((u) => userPresetKey(u.id) === p.preset) ?? null
  // Motor otoriterdir; bu yalnızca aynısını gösterir (lib/eqCurve.ts, C# FrequencyResponse.AutoPreampDb).
  const auto = useMemo(() => autoPreampDb(p), [p.eq, p.peq, p.bassBoostDb, p.clarityDb]) // eslint-disable-line react-hooks/exhaustive-deps
  const preamp = p.autoPreamp ? auto : p.preampDb
  // Ekrandan çıkınca A/B açık kalmasın.
  useEffect(() => () => setAb(false), [setAb])

  return (
    <div className="h-full overflow-y-auto p-5">
      <ScreenHeader
        title="Ses"
        sub="Çevresel ses ve tüm çıkışlara uygulanan ses işleme. Profil (üst çubuk) bunların hepsini tek tıkla değiştirir."
        right={
          <div className="flex items-center gap-4">
            <AbButton />
            <label className="flex items-center gap-2.5 text-[13px] font-medium">
              Ses işleme
              <Switch checked={p.enabled} onChange={(enabled) => setProcessing({ enabled })} label="Ses işleme" />
            </label>
          </div>
        }
      />
      {ab && (
        <div role="status" className="mb-3 rounded border border-warn/60 bg-warn/10 px-3 py-2 text-[13px] text-warn">
          A/B açık: şu an <b>işlemesiz</b> (orijinal) ses çalıyor. Ayarların değişmedi; bırak ya da tekrar tıkla.
        </div>
      )}

      <SurroundCard />

      <div className={cx('mt-4 space-y-4 transition-opacity', off && 'opacity-50')}>
        <Card className="p-4">
          <SectionTitle
            right={
              <span className="text-xs text-muted">
                {active ? active.hint : activeUser ? `Kendi ön ayarın: ${activeUser.name}` : p.preset === CUSTOM_ID ? 'Elle ayarlandı.' : ''}
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
            {user.map((u) => (
              <Chip key={u.id} active={p.preset === userPresetKey(u.id)} onClick={() => applyUser(u.id)}>
                {u.name}
              </Chip>
            ))}
            <Chip active={!active && !activeUser} disabled>
              {CUSTOM_LABEL}
            </Chip>
          </div>
          <PresetManager
            count={user.length}
            active={activeUser}
            onSave={saveUser}
            onOverwrite={overwriteUser}
            onRename={renameUser}
            onDelete={deleteUser}
          />
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
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-[13px] font-medium">Otomatik ön kazanç</span>
              <span className="mt-0.5 block text-xs text-muted">
                EQ, bas, netlik ve parametrik bantların toplam tepesi 0 dB’yi aşmayacak şekilde ön kazanç kendiliğinden düşer
                (bozulma ve limiter vurması azalır).
              </span>
            </span>
            <Switch checked={p.autoPreamp} onChange={(autoPreamp) => setProcessing({ autoPreamp })} label="Otomatik ön kazanç" />
          </label>
          {p.autoPreamp ? (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-medium">Ön kazanç (otomatik)</span>
              <span className="num text-[13px] text-fg" aria-label="Hesaplanan ön kazanç">
                {fmtSigned(Math.round(auto * 10) / 10, 1).replace('-0.0', '0.0')} dB
              </span>
            </div>
          ) : (
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
          )}
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
          <EqCurve
            eq={p.eq}
            onEqChange={(eq) => setProcessing({ eq })}
            peq={p.peq}
            onPeqChange={(peq) => setProcessing({ peq })}
            bassBoostDb={p.bassBoostDb}
            clarityDb={p.clarityDb}
            preampDb={preamp}
            selectedId={peqSel}
            onSelect={setPeqSel}
            className="mb-3"
          />
          <EqEditor value={p.eq} onChange={(eq) => setProcessing({ eq })} />
          <p className="mt-2 text-xs text-faint">
            Eğri, gerçek birleşik yanıttır (10 bant + bas + netlik + parametrik + ön kazanç). Beyaz noktaları dikey sürükle;
            çift tıklayınca sıfırlanır. Ok tuşları da çalışır.
          </p>
          <div className="mt-3">
            <PeqEditor bands={p.peq} onChange={(peq) => setProcessing({ peq })} selectedId={peqSel} onSelect={setPeqSel} />
          </div>
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
