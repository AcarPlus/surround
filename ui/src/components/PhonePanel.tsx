import { useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { api } from '../api/client'
import type { PhoneLinkStatus } from '../api/types'
import { describeError } from '../store/useStore'
import { Badge, Button } from './ui'
import { IconWarn } from './icons'

/** QR kodu: modül başına bir kare, tek bir path (keskin, her ölçekte). */
export function QrCode({ text, size = 200 }: { text: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
    return { d, n: n + 8 }
  }, [text])
  return (
    <svg
      role="img"
      aria-label="Telefonla okutulacak QR kod"
      width={size}
      height={size}
      viewBox={`0 0 ${path.n} ${path.n}`}
      shapeRendering="crispEdges"
      className="rounded-md"
    >
      <rect width={path.n} height={path.n} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  )
}

/** Telefon bağlantı durumu; panel görünürken bağlantıyı açar. */
export function usePhoneLink(active: boolean) {
  const [status, setStatus] = useState<PhoneLinkStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => api.onPhoneLink(setStatus), [])
  useEffect(() => {
    if (!active) return
    let gone = false
    api
      .phoneLinkStart()
      .then((s) => !gone && (setStatus(s), setError(null)))
      .catch((e) => !gone && setError(describeError(e)))
    return () => {
      gone = true
    }
  }, [active])
  return { status, error }
}

export function PhonePanel({ status, error }: { status: PhoneLinkStatus | null; error: string | null }) {
  const [showAll, setShowAll] = useState(false)
  if (error)
    return (
      <p className="flex items-start gap-2 text-[13px] text-warn">
        <IconWarn className="mt-0.5 shrink-0" /> {error}
      </p>
    )
  if (!status?.url) return <p className="text-[13px] text-muted">Telefon bağlantısı açılıyor…</p>
  return (
    <div className="flex flex-wrap items-start gap-4">
      <QrCode text={status.url} size={176} />
      <div className="min-w-[220px] flex-1 space-y-2 text-[13px]">
        <div className="flex items-center gap-2">
          {status.connected ? <Badge tone="ok">Telefon bağlı</Badge> : <Badge tone="warn">Telefon bekleniyor</Badge>}
          {status.connected && status.device && <span className="truncate text-xs text-faint">{shortDevice(status.device)}</span>}
        </div>
        <ol className="list-decimal space-y-1 pl-4 text-muted">
          <li>Telefon bu bilgisayarla <b className="text-fg">aynı Wi-Fi</b>’da olsun; kamerayla QR’ı okut.</li>
          <li>
            “Bağlantınız gizli değil” uyarısı çıkar (sertifika bu bilgisayarın kendisi):{' '}
            <b className="text-fg">Gelişmiş → yine de devam et</b>.
          </li>
          <li>Sayfada “Mikrofonu aç”a dokun, izin ver; telefonu dinleme noktasına götür.</li>
          <li>Ölçümü buradan ya da telefondaki düğmeden başlat.</li>
        </ol>
        {status.note && (
          <p className="flex items-start gap-1.5 text-xs text-warn">
            <IconWarn className="mt-0.5 shrink-0" /> {status.note}
          </p>
        )}
        <button type="button" className="text-xs text-faint hover:text-muted" onClick={() => setShowAll((v) => !v)}>
          {showAll ? '▾' : '▸'} Adres ve sorun giderme
        </button>
        {showAll && (
          <div className="space-y-1 text-xs text-faint">
            {status.urls.map((u) => (
              <div key={u} className="num select-all break-all">
                {u}
              </div>
            ))}
            <p>
              Sayfa açılmıyorsa: Windows Güvenlik Duvarı ilk seferde izin sorar (“Özel ağlar”a izin ver); telefon misafir
              ağdaysa bilgisayarı göremez. Birden çok adres varsa telefonun ağındakini elle yaz.
            </p>
            <Button size="sm" variant="ghost" onClick={() => void api.phoneLinkStop()}>
              Bağlantıyı kapat
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function shortDevice(ua: string): string {
  const m = /Android [\d.]+; ([^;)]+)/.exec(ua)
  return m ? m[1].trim() : ua.slice(0, 40)
}
