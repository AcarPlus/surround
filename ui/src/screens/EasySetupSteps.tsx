import { useState, type ReactNode } from 'react'
import type { CalibrationProgress, Device, PhoneLinkStatus, Speaker } from '../api/types'
import { calibrationPercent } from '../lib/calibration'
import {
  EASY_STEP_LABELS,
  describeBands,
  measureAdvice,
  sourceState,
  type EasyStep,
  type MeasureCheck,
  type MicChoice,
} from '../lib/easySetup'
import type { MatchResult } from '../lib/roomEq'
import { useStore } from '../store/useStore'
import { DeviceChecklist } from '../components/DeviceChecklist'
import { FirewallFix, PhonePanel } from '../components/PhonePanel'
import { Button, Card, Select, Switch, cx } from '../components/ui'
import { IconCheck, IconMic, IconPhone, IconWarn } from '../components/icons'
import { CableInstallCard, CableSetup } from './SourcePanels'

/** Kolay kurulumun adım parçaları; durum ve geçişler `EasySetup.tsx`'te. */

export function StepTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {sub && <p className="mt-1 text-[13px] text-muted">{sub}</p>}
    </div>
  )
}

/** Üstteki ilerleme: geniş ekranda tüm adımlar, darda "Adım 3 / 7 · Mikrofon". */
export function StepProgress({ steps, current }: { steps: EasyStep[]; current: EasyStep }) {
  const at = steps.indexOf(current)
  return (
    <div className="min-w-0 flex-1">
      <ol className="hidden items-center gap-1 min-[900px]:flex" aria-label="Kurulum adımları">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-1" aria-current={i === at ? 'step' : undefined}>
            <span
              className={cx(
                'num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                i < at ? 'border-ok bg-ok text-bg' : i === at ? 'border-accent bg-accent text-bg' : 'border-line-strong text-faint',
              )}
            >
              {i < at ? <IconCheck width={11} height={11} strokeWidth={2.4} /> : i + 1}
            </span>
            <span className={cx('text-xs', i === at ? 'font-semibold text-fg' : 'text-faint')}>{EASY_STEP_LABELS[s]}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-4 bg-line-strong" />}
          </li>
        ))}
      </ol>
      <p className="num text-xs text-muted min-[900px]:hidden">
        Adım {at + 1} / {steps.length} · <span className="font-semibold text-fg">{EASY_STEP_LABELS[current]}</span>
      </p>
    </div>
  )
}

/* ---------- 1 · Ses kaynağı ---------- */

export function SourceStep({ onSkip }: { onSkip: () => void }) {
  const devices = useStore((s) => s.devices)
  const source = useStore((s) => s.source)
  const st = sourceState(devices, source)
  const [guide, setGuide] = useState(false)
  return (
    <div>
      <StepTitle title="Ses kaynağı" sub="Windows’un sesi Surround’a nereden gelecek?" />
      {st.kind === 'ready' && (
        <Card className="flex items-center gap-3 p-4 text-[13px]">
          <IconCheck className="shrink-0 text-ok" />
          <p>
            <span className="font-semibold">VB-Cable hazır.</span>{' '}
            <span className="text-muted">Gerçek 7.1 ses alınacak; İleri’ye bas.</span>
          </p>
        </Card>
      )}
      {st.kind === 'missing' && <CableInstallCard onSkip={onSkip} />}
      {st.kind === 'needs-setup' && (
        <div className="space-y-3">
          <CableInstallCard
            reason={
              <>
                VB-Cable kurulu ama henüz hazır değil: {st.reasons.join(' ')} Tek tıkla ayarlayabilirim (7.1 yapar ve kaynak olarak
                seçer).
              </>
            }
            onSkip={onSkip}
            skipLabel="Şimdilik böyle devam et"
          />
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setGuide((v) => !v)}>
            {guide ? '▾' : '▸'} Elle yapmak istersen adımlar
          </button>
          {guide && <CableSetup />}
        </div>
      )}
    </div>
  )
}

/* ---------- 2 · Hoparlörler ---------- */

export function SpeakersStep({
  list,
  excluded,
  onToggle,
  blocked,
  hasSpeakers,
}: {
  list: Device[]
  excluded: ReadonlySet<string>
  onToggle: (id: string) => void
  /** Kaynak olduğu için listeye giremeyen hoparlör (VB-Cable yok). */
  blocked: Device | null
  hasSpeakers: boolean
}) {
  const blockedText = blocked && (
    <>
      <b>{blocked.name}</b> şu an Windows sesinin geldiği yer; Surround aynı cihazı hem dinleyip hem çalamaz. Ücretsiz VB-Cable
      kurulunca Windows sesi ona gider ve bu hoparlör de kullanılabilir.
    </>
  )
  return (
    <div>
      <StepTitle
        title="Hoparlörlerini buldum"
        sub="Bağlı her ses çıkışı bir hoparlör çifti sayılır (çok kanallı sistemler kendi kanallarıyla). Kullanmak istemediklerinin işaretini kaldır."
      />
      {list.length === 0 ? (
        blocked ? (
          <CableInstallCard reason={blockedText} />
        ) : (
          <Card className="p-4 text-[13px] text-muted">
            Kullanılabilir hoparlör çıkışı bulunamadı. Hoparlörlerini (USB, jak, HDMI ya da Bluetooth) bağlayıp birkaç saniye bekle;
            liste kendiliğinden yenilenir. Kulaklıklar listelenmez.
          </Card>
        )
      ) : (
        <>
          <DeviceChecklist list={list} excluded={excluded} onToggle={onToggle} />
          {blocked && <p className="mt-3 text-xs text-muted">{blockedText}</p>}
        </>
      )}
      {hasSpeakers && list.length > 0 && (
        <p className="mt-3 text-xs text-warn">Mevcut hoparlör ayarların güncellenecek; vazgeçersen hepsi eski haline döner.</p>
      )}
    </div>
  )
}

/* ---------- 3 · Mikrofon ---------- */

function ChoiceCard({
  active,
  disabled,
  icon,
  title,
  line,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  icon: ReactNode
  title: string
  line: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex flex-1 basis-[220px] items-start gap-3 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-accent bg-accent/10' : 'border-line-strong bg-surface hover:border-muted',
      )}
    >
      <span
        className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', active ? 'bg-accent text-bg' : 'bg-raised text-muted')}
      >
        {icon}
      </span>
      <span>
        <span className={cx('block text-[14px] font-semibold', active && 'text-accent')}>{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{line}</span>
      </span>
    </button>
  )
}

/** Telefon tarayıcısının sertifika uyarısı: iki küçük çizim + tek satır. */
function CertWarningHint() {
  const Badge = ({ n }: { n: number }) => (
    <span className="num absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-bg">
      {n}
    </span>
  )
  return (
    <div className="rounded-md border border-line p-3">
      <p className="text-[13px] font-semibold">Telefonda “Bağlantınız gizli değil” uyarısı çıkarsa</p>
      <p className="mt-0.5 text-xs text-muted">
        Normaldir: sayfa internetten değil bu bilgisayardan geliyor. Şöyle geç:
      </p>
      <div className="mt-3 flex flex-wrap gap-4" aria-hidden>
        <div className="relative w-[150px] rounded-md border border-line-strong bg-bg p-2.5">
          <Badge n={1} />
          <div className="mb-1 flex h-4 w-4 items-center justify-center rounded-full bg-err/80 text-[10px] font-bold text-bg">!</div>
          <p className="text-[10px] font-semibold leading-tight">Bağlantınız gizli değil</p>
          <div className="mt-1 h-1 w-full rounded bg-line" />
          <div className="mt-0.5 h-1 w-3/4 rounded bg-line" />
          <div className="mt-2 flex justify-between gap-1">
            <span className="rounded border-2 border-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent">Gelişmiş</span>
            <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-faint">Geri dön</span>
          </div>
        </div>
        <div className="relative w-[150px] rounded-md border border-line-strong bg-bg p-2.5">
          <Badge n={2} />
          <div className="h-1 w-full rounded bg-line" />
          <div className="mt-0.5 h-1 w-5/6 rounded bg-line" />
          <div className="mt-0.5 h-1 w-2/3 rounded bg-line" />
          <p className="mt-2 rounded border-2 border-accent px-1 py-0.5 text-[10px] font-semibold leading-tight text-accent">
            Devam et (güvenli değil)
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        <b className="text-fg">Gelişmiş</b> → <b className="text-fg">Devam et</b> (tarayıcıya göre “siteye ilerle” de yazabilir). Sonra sayfada{' '}
        <b className="text-fg">Mikrofonu aç</b>’a dokun ve izin ver.
      </p>
    </div>
  )
}

export function MicStep({
  choice,
  onChoice,
  mics,
  phone,
}: {
  choice: MicChoice | null
  onChoice: (c: MicChoice) => void
  mics: Device[]
  phone: { status: PhoneLinkStatus | null; error: string | null }
}) {
  const [trouble, setTrouble] = useState(false)
  const pickDevice = () => {
    const d = mics.find((m) => m.isDefault) ?? mics[0]
    if (d) onChoice({ kind: 'device', deviceId: d.id })
  }
  return (
    <div>
      <StepTitle title="Hangi mikrofonla ölçelim?" sub="Ölçüm, her hoparlörün sesinin sana ne zaman ve ne kadar yüksek ulaştığını dinler." />
      <div className="flex flex-wrap gap-3">
        <ChoiceCard
          active={choice?.kind === 'phone'}
          icon={<IconPhone width={22} height={22} />}
          title="Telefonum"
          line="QR kodu okut, telefon mikrofon olsun. Ek bir şey gerekmez."
          onClick={() => onChoice({ kind: 'phone' })}
        />
        <ChoiceCard
          active={choice?.kind === 'device'}
          disabled={mics.length === 0}
          icon={<IconMic width={22} height={22} />}
          title="Bilgisayar mikrofonu / kulaklık mikrofonu"
          line={mics.length === 0 ? 'Bilgisayarda mikrofon bulunamadı.' : 'Mikrofonu oturduğun yere, kulak hizasına koy.'}
          onClick={pickDevice}
        />
      </div>

      {choice?.kind === 'phone' && (
        <div className="mt-4 space-y-3">
          <Card className="p-4">
            <PhonePanel status={phone.status} error={phone.error} />
          </Card>
          {!phone.status?.connected && <CertWarningHint />}
          {!phone.status?.connected && (
            <div>
              <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setTrouble((v) => !v)}>
                {trouble ? '▾' : '▸'} Telefon sayfayı açamıyor mu?
              </button>
              {trouble && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-muted">
                    Telefon bu bilgisayarla aynı Wi-Fi’da olmalı (misafir ağı olmaz). Sayfa “yanıt vermesi çok uzun sürdü” diyorsa
                    büyük olasılıkla Windows Güvenlik Duvarı engelliyordur:
                  </p>
                  <FirewallFix />
                </div>
              )}
            </div>
          )}
          {phone.status?.connected && (
            <p className="flex items-center gap-2 text-[13px] text-ok">
              <IconCheck /> Telefon bağlı. Telefonu oturduğun yere, kulak hizasında tut (ekran yukarı) ve İleri’ye bas.
            </p>
          )}
        </div>
      )}

      {choice?.kind === 'device' && (
        <Card className="mt-4 space-y-3 p-4">
          {mics.length > 1 && (
            <Select ariaLabel="Mikrofon" value={choice.deviceId} onChange={(id) => onChoice({ kind: 'device', deviceId: id })}>
              {mics.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isDefault ? ' · varsayılan' : ''}
                </option>
              ))}
            </Select>
          )}
          <ul className="space-y-1.5 text-[13px] text-muted">
            <li>• Mikrofonu dinleme noktasına (oturduğun yer), kulak hizasına koy; ölçüm boyunca kıpırdatma.</li>
            <li>• Kulaklık mikrofonu kullanıyorsan kulaklığı tak ve otur; ölçüm sırasında kıpırdama.</li>
          </ul>
        </Card>
      )}
    </div>
  )
}

/* ---------- 5 · Ölçüm ---------- */

export function MeasureStep({
  running,
  progress,
  count,
  done,
  micLabel,
  seconds,
  error,
  stopped,
  check,
  phone,
  onRetry,
  onContinue,
  onChangeMic,
  onCancel,
}: {
  running: boolean
  progress: CalibrationProgress | null
  /** Ölçülecek hoparlör sayısı. */
  count: number
  /** Son ölçüm sorunsuz bitti. */
  done: boolean
  micLabel: string
  seconds: number
  error: string | null
  stopped: boolean
  check: MeasureCheck | null
  phone: boolean
  onRetry: () => void
  onContinue: () => void
  onChangeMic: () => void
  onCancel: () => void
}) {
  if (running)
    return (
      <div>
        <StepTitle title="Ölçülüyor…" sub="Hoparlörler sırayla kısa bir ses çıkaracak. Ortam sessiz olsun, mikrofonu oynatma." />
        <Card className="p-5">
          <p className="text-[15px] font-semibold" aria-live="polite">
            {progress?.message ?? 'Hazırlanıyor…'}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${calibrationPercent(progress)}%` }} />
          </div>
          <p className="num mt-2 text-xs text-muted">
            {progress?.phase === 'measuring' ? `${progress.index} / ${progress.total} hoparlör` : progress?.phase === 'analyzing' ? 'Sonuçlar hesaplanıyor…' : ''}
          </p>
          <Button className="mt-4" variant="danger" onClick={onCancel}>
            Ölçümü durdur
          </Button>
        </Card>
      </div>
    )

  if (check && check.status !== 'ok') {
    const advice = measureAdvice(check, phone)
    const fail = check.status === 'fail'
    return (
      <div>
        <StepTitle
          title={fail ? 'Mikrofon hoparlörleri duyamadı' : 'Ölçüm bitti, ama birkaç şeye bakalım'}
          sub={fail ? 'Bu ölçümle düzeltme yapılamaz.' : 'Sorunlu ölçümler uygulanmaz; istersen tekrar ölç ya da onlar olmadan devam et.'}
        />
        <Card className="space-y-3 border-warn/60 p-4 text-[13px]">
          {check.weak.length > 0 && !fail && (
            <p className="flex items-start gap-2">
              <IconWarn className="mt-0.5 shrink-0 text-warn" />
              <span>
                Çok zayıf duyuldu: <b>{check.weak.map((w) => w.name).join(', ')}</b>. Bunların ayarı değiştirilmeyecek.
              </span>
            </p>
          )}
          {check.clipped && (
            <p className="flex items-start gap-2">
              <IconWarn className="mt-0.5 shrink-0 text-warn" /> Mikrofon fazla yüksek ses duydu (kırpıldı).
            </p>
          )}
          {advice.length > 0 && (
            <ul className="space-y-1 text-muted">
              {advice.map((a) => (
                <li key={a}>• {a}</li>
              ))}
            </ul>
          )}
        </Card>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onRetry}>
            Tekrar ölç
          </Button>
          {!fail && <Button onClick={onContinue}>Bunlar olmadan devam et</Button>}
          <Button variant="ghost" onClick={onChangeMic}>
            Mikrofonu değiştir
          </Button>
        </div>
      </div>
    )
  }

  if (done)
    return (
      <div>
        <StepTitle title="Ölçüm tamam" sub="Tüm hoparlörler net duyuldu. İleri’ye bas ya da istersen tekrar ölç." />
      </div>
    )

  return (
    <div>
      <StepTitle title="Ölçüme hazır mısın?" sub="Hoparlörler sırayla kısa bir ses çıkaracak; ortam sessiz olsun." />
      <Card className="space-y-2 p-4 text-[13px]">
        <p>
          <span className="text-muted">Mikrofon:</span> <b>{micLabel}</b>
        </p>
        <p>
          <span className="text-muted">Ölçülecek:</span> <b>{count} hoparlör</b>{' '}
          <span className="text-faint">(yaklaşık {seconds} sn)</span>
        </p>
        <p className="text-xs text-muted">
          {phone
            ? 'Telefonu oturduğun yere, kulak hizasında tut. Ölçümü buradan ya da telefondaki düğmeden başlatabilirsin.'
            : 'Mikrofon oturduğun yerde, kulak hizasında dursun.'}{' '}
          Ses motoru ölçüm sırasında kısa bir süre durur.
        </p>
      </Card>
      {stopped && <p className="mt-3 text-[13px] text-muted">Ölçüm durduruldu. Hazır olunca yeniden başlat.</p>}
      {error && (
        <Card className="mt-3 border-warn/60 p-4 text-[13px]">
          <p className="flex items-start gap-2 text-warn">
            <IconWarn className="mt-0.5 shrink-0" /> {error}
          </p>
          <p className="mt-1 text-xs text-muted">
            {phone
              ? 'Telefonun bağlı olduğundan ve ölçüm sayfasının açık kaldığından emin ol, sonra tekrar dene.'
              : 'Mikrofonun takılı olduğundan emin ol, sonra tekrar dene.'}
          </p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={onChangeMic}>
            Mikrofonu değiştir
          </Button>
        </Card>
      )}
    </div>
  )
}

/* ---------- 6 · Oda düzeltmesi ---------- */

export function EqStep({
  available,
  matches,
  speakers,
  enabled,
  onEnabled,
  skipped,
}: {
  /** Bu ölçümde frekans yanıtı geldi mi. */
  available: boolean
  matches: MatchResult[]
  speakers: Speaker[]
  enabled: boolean
  onEnabled: (v: boolean) => void
  skipped: number
}) {
  const name = (id: string) => speakers.find((s) => s.id === id)?.name ?? id
  const needed = matches.some((m) => m.bands.length > 0)
  return (
    <div>
      <StepTitle
        title="Oda düzeltmesi"
        sub="Odalar bazı sesleri fazla güçlendirir (uğultu, çınlama). Yumuşak düzeltme bu yerleri hafifçe kısar; hiçbir yeri yükseltmez."
      />
      <Card className="mb-3 flex items-center gap-3 p-4 text-[13px]">
        <IconCheck className="shrink-0 text-ok" />
        <span>
          Ses gecikmeleri ve seviyeler ölçüldü; uygulanınca tüm hoparlörlerin sesi sana aynı anda ve aynı yükseklikte ulaşır.
          {skipped > 0 && <span className="text-muted"> ({skipped} hoparlör ölçülemediği için ayarı değişmeyecek.)</span>}
        </span>
      </Card>
      {!available ? (
        <Card className="p-4 text-[13px] text-muted">Bu ölçümde oda düzeltmesi hesaplanamadı; yalnızca gecikme ve seviye eşitlenecek.</Card>
      ) : (
        <Card className="p-4">
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span>
              <span className="font-semibold">Yumuşak oda düzeltmesi</span>
              <span className="block text-xs text-muted">
                {needed ? 'Önerilir. İstemezsen kapatabilirsin; sonra tekrar ölçerek açabilirsin.' : 'Hoparlörlerin zaten dengeli; düzeltme gerekmedi.'}
              </span>
            </span>
            <Switch checked={enabled} onChange={onEnabled} label="Yumuşak oda düzeltmesi" disabled={!needed} />
          </label>
          {needed && (
            <ul className={cx('mt-3 divide-y divide-line border-t border-line text-[13px]', !enabled && 'opacity-50')}>
              {matches.map((m) => (
                <li key={m.speakerId} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate">{name(m.speakerId)}</span>
                  <span className="text-xs text-muted">{describeBands(m.bands)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

/* ---------- 7 · Bitti ---------- */

export function DoneStep({ lines }: { lines: string[] }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-ok/15 text-ok">
        <IconCheck width={28} height={28} strokeWidth={2.2} />
      </div>
      <StepTitle title="Hazır!" sub="Surround çalışıyor. İyi dinlemeler." />
      <Card className="mx-auto max-w-[420px] p-4 text-left">
        <ul className="space-y-1.5 text-[13px]">
          {lines.map((l) => (
            <li key={l} className="flex items-start gap-2">
              <IconCheck className="mt-0.5 shrink-0 text-ok" width={14} height={14} /> {l}
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-4 text-xs text-faint">Hoparlörlerin yerini değiştirirsen ana sayfadaki “Yeniden ölç” ile tekrar ölçebilirsin.</p>
    </div>
  )
}
