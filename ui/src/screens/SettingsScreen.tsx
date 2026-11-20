import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { defaultAppSettings, type AppSettings, type Profile } from '../api/types'
import { selectProfileModified, useStore } from '../store/useStore'
import { Badge, Button, Card, ScreenHeader, SectionTitle, Switch, cx } from '../components/ui'
import { IconTrash } from '../components/icons'
import { MAX_PROFILE_NAME } from '../lib/profiles'
import { useUpdate } from '../lib/useSystem'

const ROWS: { key: keyof AppSettings; label: string; hint: string; recommended?: boolean }[] = [
  {
    key: 'switchDefaultDevice',
    label: 'Başlatınca Windows varsayılan çıkışını kaynak cihaza (VB-Cable) çevir, durdurunca geri al',
    hint: 'Önerilen. Kapalıysa Windows sesi başka bir cihaza göndermeye devam eder; Surround kapalıyken ya da sen varsayılan çıkışı elle ayarlamadıkça ses duyulmaz.',
    recommended: true,
  },
  {
    key: 'startWithWindows',
    label: 'Windows ile başlat (tepside)',
    hint: 'Bilgisayar açılınca Surround tepsi simgesi olarak çalışır.',
  },
  {
    key: 'startEngineOnLaunch',
    label: 'Açılışta sesi otomatik başlat',
    hint: 'Uygulama açılır açılmaz ses işleme motoru çalışmaya başlar.',
  },
  {
    key: 'minimizeToTray',
    label: 'Kapatınca tepsiye küçült',
    hint: 'Pencereyi kapatmak sesi durdurmaz; Surround tepside çalışmaya devam eder.',
  },
]

export function SettingsScreen() {
  const showToast = useStore((s) => s.showToast)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getAppSettings()
      .then((s) => alive && setSettings({ ...defaultAppSettings(), ...s }))
      .catch((e) => {
        if (!alive) return
        setSettings(defaultAppSettings())
        showToast(e instanceof Error ? e.message : String(e), 5000)
      })
    return () => {
      alive = false
    }
  }, [showToast])

  const toggle = (key: keyof AppSettings, value: boolean) => {
    if (!settings) return
    const prev = settings
    const next = { ...settings, [key]: value }
    setSettings(next)
    api.saveAppSettings(next).catch((e) => {
      setSettings(prev)
      showToast(e instanceof Error ? e.message : String(e), 6000)
    })
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[860px] space-y-4">
      <ScreenHeader title="Ayarlar" sub="Profiller ve Windows ile bütünleşme." />

        <ProfilesCard />

        <Card className="divide-y divide-line">
          {ROWS.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-start justify-between gap-6 p-4">
              <span>
                <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                  {r.label}
                  {r.recommended && <Badge tone="accent">Önerilen</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{r.hint}</span>
              </span>
              <Switch
                checked={settings?.[r.key] ?? false}
                disabled={!settings}
                onChange={(v) => toggle(r.key, v)}
                label={r.label}
              />
            </label>
          ))}
        </Card>

        <SetupCard />

        <AboutCard />
      </div>
    </div>
  )
}

/* ---------- Hakkında + güncelleme ---------- */

function AboutCard() {
  const update = useUpdate()
  const showToast = useStore((s) => s.showToast)
  const fail = (e: unknown) => showToast(e instanceof Error ? e.message : 'İşlem başarısız.', 5000, { tone: 'error' })
  const check = async () => {
    try {
      const u = await api.checkUpdate()
      if (u.state === 'idle') showToast('Surround güncel.', 2500)
      else if (u.state === 'error') showToast(`Güncelleme denetlenemedi: ${u.message ?? 'bilinmeyen hata'}`, 5000, { tone: 'error' })
    } catch (e) {
      fail(e)
    }
  }

  let status = ''
  switch (update?.state) {
    case 'unsupported':
      status = 'Bu kopya kurulu değil (geliştirme); otomatik güncelleme kapalı.'
      break
    case 'checking':
      status = 'Güncelleme denetleniyor…'
      break
    case 'downloading':
      status = `Surround ${update.version} indiriliyor… %${update.progress}`
      break
    case 'ready':
      status = `Surround ${update.version} indirildi; yeniden başlatınca ya da bir dahaki açılışta kurulur.`
      break
    case 'error':
      status = 'Son denetim başarısız oldu (internet bağlantısı?).'
      break
    case 'idle':
      status = 'Güncellemeler kendiliğinden denetlenir ve arka planda indirilir.'
      break
  }
  const busy = update?.state === 'checking' || update?.state === 'downloading'

  return (
    <Card className="p-4">
      <SectionTitle>Hakkında</SectionTitle>
      <p className="text-[13px] font-medium">
        Surround{update?.current ? <span className="ml-1.5 font-normal text-muted">sürüm {update.current}</span> : null}
      </p>
      <p className="mt-0.5 text-xs text-muted">Çoklu hoparlör çevresel ses uygulaması.</p>
      {status && <p className="mt-3 text-xs text-muted">{status}</p>}
      {update && update.state !== 'unsupported' && (
        <div className="mt-2 flex gap-2">
          {update.state === 'ready' ? (
            <Button size="sm" variant="primary" onClick={() => void api.applyUpdate().catch(fail)}>
              Yeniden başlat ve güncelle
            </Button>
          ) : (
            <Button size="sm" onClick={() => void check()} disabled={busy}>
              Güncellemeleri denetle
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

/* ---------- Kurulum ve yedek ---------- */

function SetupCard() {
  const openWizard = useStore((s) => s.openWizard)
  const exportConfig = useStore((s) => s.exportConfig)
  const importConfig = useStore((s) => s.importConfig)
  const showToast = useStore((s) => s.showToast)
  const showError = useStore((s) => s.showError)
  const file = useRef<HTMLInputElement>(null)

  const download = () => {
    const blob = new Blob([JSON.stringify(exportConfig(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `surround-yedek-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const upload = async (f: File) => {
    try {
      const err = importConfig(JSON.parse(await f.text()))
      if (err) showToast(err, 5000, { tone: 'error' })
    } catch {
      showToast('Dosya okunamadı (geçerli bir JSON değil).', 5000, { tone: 'error' })
    }
  }

  return (
    <Card className="p-4">
      <SectionTitle>Kurulum ve yedek</SectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={openWizard}>
          Kurulum sihirbazını aç
        </Button>
        <Button onClick={download}>Yedeği indir</Button>
        <Button onClick={() => file.current?.click()}>Yedekten yükle…</Button>
        <Button
          variant="ghost"
          onClick={() => api.openLogFolder().catch((e) => showError(e))}
          title="Hata ayıklama için kayıt dosyaları (son 7 gün; ses verisi içermez)"
        >
          Kayıt klasörünü aç
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
      <p className="mt-2 text-xs text-muted">
        Yedek; hoparlörleri, odayı, kalibrasyonu, ses ayarlarını ve profilleri içerir. Yüklemek Ctrl+Z ile geri alınabilir.
      </p>
    </Card>
  )
}

/* ---------- Profiller ---------- */

function ProfilesCard() {
  const profiles = useStore((s) => s.profiles)
  const activeId = useStore((s) => s.activeProfileId)
  const modified = useStore(selectProfileModified)
  const selectProfile = useStore((s) => s.selectProfile)
  const saveCurrent = useStore((s) => s.saveCurrentAsProfile)
  const updateActive = useStore((s) => s.updateActiveProfile)
  const [name, setName] = useState('')

  const submit = () => {
    if (saveCurrent(name)) setName('')
  }

  return (
    <Card className="p-4">
      <SectionTitle>Profiller</SectionTitle>
      <p className="mb-3 text-xs text-muted">
        Profil; ses işleme, upmix modu ve seviyelerini tek tıkla değiştirir. Üst çubuktan da seçebilirsin.
      </p>

      <ul className="divide-y divide-line rounded-md border border-line">
        {profiles.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            active={p.id === activeId}
            modified={p.id === activeId && modified}
            onSelect={() => selectProfile(p.id)}
            onUpdate={updateActive}
          />
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2">
        <input
          aria-label="Yeni profil adı"
          value={name}
          maxLength={MAX_PROFILE_NAME}
          placeholder="Profil adı"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="h-8 w-[200px] rounded border border-line-strong bg-surface px-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent"
        />
        <Button variant="primary" onClick={submit} disabled={!name.trim()}>
          Mevcut ayarları profil olarak kaydet
        </Button>
      </div>
    </Card>
  )
}

function ProfileRow({
  profile,
  active,
  modified,
  onSelect,
  onUpdate,
}: {
  profile: Profile
  active: boolean
  modified: boolean
  onSelect: () => void
  onUpdate: () => void
}) {
  const renameProfile = useStore((s) => s.renameProfile)
  const deleteProfile = useStore((s) => s.deleteProfile)
  const resetBuiltin = useStore((s) => s.resetBuiltinProfile)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(profile.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const commitRename = () => {
    renameProfile(profile.id, draft)
    setEditing(false)
  }

  return (
    <li className={cx('flex items-center gap-3 px-3 py-2', active && 'bg-raised/60')}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`${profile.name} profilini uygula`}
        className={cx(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          active ? 'border-accent' : 'border-line-strong hover:border-muted',
        )}
      >
        {active && <span className="h-2 w-2 rounded-full bg-accent" />}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={input}
            aria-label="Profil adı"
            value={draft}
            maxLength={MAX_PROFILE_NAME}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraft(profile.name)
                setEditing(false)
              }
            }}
            className="h-7 w-[200px] rounded border border-accent bg-surface px-2 text-[13px] text-fg outline-none"
          />
        ) : (
          <button type="button" onClick={onSelect} className="flex max-w-full items-center gap-2 text-left text-[13px] font-medium">
            <span className="truncate">{profile.name}</span>
            {modified && <span className="text-warn" title="Profil değiştirildi">•</span>}
            {profile.builtin && <Badge>Yerleşik</Badge>}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {modified && (
          <Button size="sm" onClick={onUpdate}>
            Profili güncelle
          </Button>
        )}
        {profile.builtin ? (
          <Button size="sm" variant="ghost" onClick={() => resetBuiltin(profile.id)}>
            Varsayılana döndür
          </Button>
        ) : confirmDelete ? (
          <>
            <Button size="sm" variant="danger" onClick={() => deleteProfile(profile.id)}>
              Sil
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Vazgeç
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(profile.name)
                setEditing(true)
              }}
            >
              Yeniden adlandır
            </Button>
            <Button size="sm" variant="ghost" aria-label={`${profile.name} profilini sil`} onClick={() => setConfirmDelete(true)}>
              <IconTrash width={14} height={14} />
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
