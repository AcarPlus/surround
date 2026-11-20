import type { Device } from '../api/types'
import { findCable } from '../lib/health'
import { useCableAutoSetup } from '../screens/SourcePanels'

/** VB-Cable yoksa ya da Windows'ta 7.1 değilse true: uygulama ancak kablo hazır olunca açılır. */
export function cableMissing(devices: Device[]): boolean {
  const cable = findCable(devices)
  return !cable || cable.channels <= 2
}

/**
 * Uygulamanın kapısı: Surround sesi VB-Cable'dan alır, o olmadan çalışamaz. Tek tıkla resmi siteden indirir, imzasını
 * doğrular, kurar, 7.1 yapar, kaynak ve Windows varsayılan çıkışı olarak ayarlar (backend `cableSetup`). Kurulmadıkça
 * uygulamanın geri kalanı açılmaz; atlama yolu yoktur.
 */
export function CableGate({ devices }: { devices: Device[] }) {
  const cable = findCable(devices)
  const auto = useCableAutoSetup()
  const label = auto.busy
    ? cable
      ? 'Ayarlanıyor…'
      : 'Kuruluyor… (1 dakika sürebilir)'
    : auto.reboot
      ? 'Yeniden başlattıktan sonra tekrar dene'
      : cable
        ? 'VB-Cable’ı ayarla'
        : 'VB-Cable’ı kur ve ayarla'

  return (
    <div className="stage-bg flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="screen-in w-full max-w-[560px] text-center">
        <span className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgb(var(--accent)),rgb(var(--dev-3)))] text-accent-fg shadow-[0_10px_40px_rgb(var(--accent)/0.4)]">
          <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="2.4" fill="currentColor" />
            <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16.1 7.9a5.8 5.8 0 0 1 0 8.2M7.9 16.1a5.8 5.8 0 0 1 0-8.2" />
              <path d="M19.6 4.4a10.8 10.8 0 0 1 0 15.2M4.4 19.6a10.8 10.8 0 0 1 0-15.2" opacity="0.6" />
            </g>
          </svg>
        </span>
        <h1 className="text-[26px] font-semibold tracking-tight">
          {cable ? 'VB-Cable’ı 7.1 yapalım' : 'Önce VB-Cable’ı kuralım'}
        </h1>
        <p className="mx-auto mt-3 max-w-[480px] text-[14px] leading-6 text-muted">
          {cable
            ? 'VB-Cable kurulu ama Windows’ta 2 kanal olarak ayarlı. Filmlerin ve oyunların 7.1 sesini alabilmek için tek tıkla 7.1 yapılır.'
            : 'Surround, Windows’un sesini VB-Cable adlı ücretsiz sanal ses kartından alıp hoparlörlerine dağıtır; o olmadan çalışamaz. Tek tıkla kurulur, 7.1 yapılır ve gereken tüm ayarlar kendiliğinden yapılır.'}
        </p>

        <button
          type="button"
          disabled={auto.busy || auto.reboot}
          onClick={() => void auto.run()}
          className="mx-auto mt-8 flex h-12 min-w-[260px] items-center justify-center rounded-2xl bg-accent px-8 text-[15px] font-semibold text-accent-fg shadow-[0_10px_34px_rgb(var(--accent)/0.35)] transition-all hover:brightness-110 disabled:opacity-60"
        >
          {label}
        </button>

        {auto.busy && !cable && (
          <p className="mt-4 text-[13px] text-muted">
            Windows “Bu uygulamanın cihazınızda değişiklik yapmasına izin vermek istiyor musunuz?” diye sorarsa{' '}
            <b className="text-fg">Evet</b>’e bas.
          </p>
        )}
        {auto.reboot && <p className="mt-4 text-[13px] text-fg">{auto.msg}</p>}
        {auto.err && (
          <div className="mx-auto mt-4 max-w-[460px] rounded-xl border border-err/40 bg-err/10 p-3 text-[13px]">
            <p className="text-err">Olmadı: {auto.msg}</p>
            <p className="mt-1 text-muted">
              Windows’un onay penceresinde “Hayır” dendiyse ya da internet yoksa kurulum yapılamaz. İnterneti kontrol edip tekrar
              dene; onay penceresinde “Evet”i seç.
            </p>
          </div>
        )}

        <ul className="mx-auto mt-10 grid max-w-[480px] gap-2 text-left text-xs text-muted">
          <li>· Resmi VB-Audio sitesinden indirilir; imzası doğrulanmadan çalıştırılmaz.</li>
          <li>· Windows bir kez yönetici onayı ister.</li>
          <li>· Surround çalışırken Windows sesi VB-Cable’a gider, durdurunca eski hoparlörüne geri döner.</li>
        </ul>
        {!cable && (
          <p className="mt-6 text-[11px] text-faint">
            VB-Cable, VB-Audio’nun bağışla desteklenen ücretsiz sürücüsüdür; kurarak lisansını kabul etmiş olursun.
          </p>
        )}
      </div>
    </div>
  )
}
