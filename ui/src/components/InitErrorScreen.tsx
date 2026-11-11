import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { Button } from './ui'

/** Ayarlar yüklenemediğinde "Yükleniyor…"da takılmak yerine gösterilir. */
export function InitErrorScreen() {
  const err = useStore((s) => s.initError)
  const init = useStore((s) => s.init)
  const recoverWithDefaults = useStore((s) => s.recoverWithDefaults)
  const recoverFromBackup = useStore((s) => s.recoverFromBackup)
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (f: File) => {
    setBusy(true)
    try {
      setMsg(await recoverFromBackup(JSON.parse(await f.text())))
    } catch {
      setMsg('Dosya okunamadı (geçerli bir JSON değil).')
    } finally {
      setBusy(false)
    }
  }

  if (!err) return null
  return (
    <div className="flex h-full items-center justify-center p-6" role="alert">
      <div className="w-full max-w-[520px] rounded-lg border border-err/50 bg-surface p-6">
        <h1 className="text-[17px] font-semibold">Ayarlar yüklenemedi</h1>
        <p className="mt-2 text-sm text-muted">{err.message}</p>
        {err.detail && (
          <details className="mt-2 text-xs text-faint">
            <summary className="cursor-pointer">Ayrıntı</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words">{err.detail}</pre>
          </details>
        )}
        {msg && <p className="mt-3 text-sm text-err">{msg}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => file.current?.click()}>
            Yedekten yükle…
          </Button>
          <Button disabled={busy} onClick={() => void recoverWithDefaults()}>
            Varsayılana dön
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void init()}>
            Tekrar dene
          </Button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
        </div>
        <p className="mt-3 text-xs text-faint">
          Varsayılana dönmek mevcut ayar dosyasını silmez; zaman damgalı bir yedek olarak yanında saklar.
        </p>
      </div>
    </div>
  )
}
