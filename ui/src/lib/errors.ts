/**
 * Backend/motor hata metinlerini anlaşılır Türkçe cümlelere çevirir. Teknik metin silinmez:
 * `detail` olarak (arayüzde katlanabilir "Ayrıntı" içinde) kalır.
 */
export interface ExplainedError {
  message: string
  /** Özgün teknik metin; çevrilmediyse (zaten anlaşılırsa) boş. */
  detail?: string
}

const RULES: Array<[RegExp, string]> = [
  [/Object reference|NullReference|null\b.*referans/i, 'Beklenmeyen bir hata oluştu (ayar dosyasında eksik bir değer olabilir). Ayarlar > Kurulum ve yedek bölümünden yedeğinizi yükleyebilirsiniz.'],
  [/outputs\[\d+\]\.bufferMs|bufferMs/i, 'Bir çıkışın tampon süresi 10 ile 500 ms arasında olmalı.'],
  [/outputs\[\d+\]\.latencyMs|latencyMs/i, 'Bir çıkışın gecikme telafisi 0 ile 1000 ms arasında olmalı.'],
  [/delayMs/i, 'Bir hoparlörün gecikmesi 0 ile 1000 ms arasında olmalı.'],
  [/gainDb/i, 'Bir hoparlörün ses seviyesi -60 ile +24 dB arasında olmalı.'],
  [/outputDeviceId.*(listesinde yok|not in)/i, 'Bir hoparlör, listede olmayan bir çıkış cihazına bağlı. Hoparlörün çıkış cihazını yeniden seçin.'],
  [/deviceChannel/i, 'Bir hoparlörün cihaz kanalı numarası geçersiz (1 ya da daha büyük olmalı).'],
  [/geri besleme|loopback kaynak cihazı/i, 'Ses kaynağı olan cihaz aynı anda hoparlör çıkışı olamaz (ses kendi kendine geri beslenir). Hoparlörü başka bir cihaza taşıyın.'],
  [/Tüm hoparlörler kaynak cihazda/i, 'Tüm hoparlörler kaynak cihazda. En az bir hoparlörü başka bir cihaza taşıyın.'],
  [/En az bir hoparlör/i, 'En az bir hoparlör ekleyin.'],
  [/aynı cihaz birden fazla kez/i, 'Aynı çıkış cihazı birden fazla kez tanımlanmış.'],
  [/highPassHz/i, 'Bas kesme frekansı kapalı (0) ya da 40–250 Hz arasında olmalı.'],
  [/bassReceiver/i, 'Bir hoparlör hem bası kesilen hem bas alıcısı olamaz.'],
  [/Yapılandırma okunamadı|JsonException|JSON|could not be converted/i, 'Ayar dosyası okunamadı ya da bozuk.'],
  [/AUDCLNT_E_DEVICE_IN_USE|0x8889000a|exclusive/i, 'Ses cihazı başka bir uygulama tarafından özel modda kullanılıyor.'],
  [/AUDCLNT_E_UNSUPPORTED_FORMAT|0x88890008|E_INVALIDARG|desteklenm/i, 'Ses cihazı bu biçimi desteklemiyor. Cihazın Windows ses biçimini (Hz / kanal) kontrol edin.'],
  [/DEVICE_INVALIDATED|0x88890004|cihaz.*(yok|bulunamadı|kaldırıldı)/i, 'Ses cihazı kullanılamıyor (çıkarılmış ya da devre dışı olabilir).'],
  [/Kalibrasyon iptal/i, 'Kalibrasyon iptal edildi.'],
]

/** Tek bir ham metni çevirir; bilinmiyorsa olduğu gibi döner. */
export function friendlyMessage(raw: string): { message: string; translated: boolean } {
  for (const [re, text] of RULES) if (re.test(raw)) return { message: text, translated: true }
  return { message: raw, translated: false }
}

export function explainError(e: unknown): ExplainedError {
  const errors = (e as { errors?: unknown })?.errors
  const raws: string[] =
    Array.isArray(errors) && errors.length > 0
      ? errors.map(String)
      : [e instanceof Error ? e.message : String(e)]
  const first = friendlyMessage(raws[0])
  const more = raws.length > 1 ? ` (+${raws.length - 1} sorun daha)` : ''
  const anyTranslated = first.translated || raws.some((r) => friendlyMessage(r).translated)
  return {
    message: first.message + more,
    detail: anyTranslated || raws.length > 1 ? raws.join('\n') : undefined,
  }
}

const MIC_DENIED = /E_ACCESSDENIED|0x80070005|UnauthorizedAccess|access (is )?denied|erişim.*(reddedildi|engellendi)/i

/** Mikrofon yakalamada Windows erişimi reddettiyse (gizlilik ayarı) yönlendiren Türkçe ipucu; değilse null. */
export const MIC_PRIVACY_HINT =
  'Windows mikrofon erişimini engelliyor. Ayarlar > Gizlilik ve güvenlik > Mikrofon bölümünde "Mikrofon erişimi" ve "Masaüstü uygulamalarının mikrofona erişmesine izin ver" seçeneklerini aç, sonra tekrar dene.'

export function micPrivacyHint(e: unknown): string | null {
  const errors = (e as { errors?: unknown })?.errors
  const raws = Array.isArray(errors) && errors.length > 0 ? errors.map(String) : [e instanceof Error ? e.message : String(e)]
  return raws.some((r) => MIC_DENIED.test(r)) ? MIC_PRIVACY_HINT : null
}
