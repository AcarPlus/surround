import type { CaptionButton, ResizeEdge, WindowState } from '../api/types'

/*
 * Ayrı başlık şeridi yok: uygulamanın üst satırı (TopBar) pencerenin en tepesindedir, boş yerleri sürükleme alanıdır
 * (app-region: drag) ve küçült / büyüt / kapat düğmeleri o satırın sağ üst köşesinde durur (Windows 11 gibi).
 */

/** Pencere düğmesi boyutu (px): Windows 11'in kendi başlık düğmeleri gibi; yükseklik C# WindowFrame.TitleBarHeight ile aynı. */
export const CAPTION_BUTTON_WIDTH = 46
export const CAPTION_BUTTON_HEIGHT = 32
/** Pencere düğmelerinin sayısı (küçült, büyüt, kapat). */
const CAPTION_BUTTON_COUNT = 3

/**
 * Üst satırın sağında pencere düğmelerine ayrılan genişlik (px). Çerçeve kaldırılmadıysa (tarayıcı / mock, yerel
 * Windows başlığı) 0: düzen eskisi gibi kalır.
 */
export function captionAreaWidth(frameless: boolean): number {
  return frameless ? CAPTION_BUTTON_WIDTH * CAPTION_BUTTON_COUNT : 0
}

/** `document.documentElement`in burada kullanılan kısmı (testte sahtesi verilir). */
export interface FramelessRoot {
  classList: { toggle(name: string, force?: boolean): boolean }
  style: { setProperty(name: string, value: string): void }
}

/**
 * Çerçevesiz pencereyi sayfaya bildirir: `html.frameless` sınıfı sürükleme alanlarını (`.app-drag`) açar,
 * `--caption-w` üst satırın sağında pencere düğmelerine yer ayırır. Çerçeve yokken ikisi de etkisiz (düzen aynen).
 */
export function syncFrameless(frameless: boolean, root: FramelessRoot = document.documentElement) {
  root.classList.toggle('frameless', frameless)
  root.style.setProperty('--caption-w', `${captionAreaWidth(frameless)}px`)
}

/**
 * Sürükleme alanı (`.app-drag`) içindeki etkileşimli öğeler: bunlara basınca pencere sürüklenmez. `.app-no-drag`
 * hem bir alanın içindeki istisnadır hem de bir alanın üstünü örten katmandır (iletişim kutusu, sihirbaz).
 */
export const NO_DRAG_SELECTOR = [
  '.app-no-drag',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'a[href]',
  '[contenteditable]',
  "[role='button']",
  "[role='slider']",
  "[role='group']",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
].join(', ')

/** Pencere sürüklemesinin başlaması için basılı imlecin gitmesi gereken yol (px); daha azı tıklama / çift tıktır. */
export const DRAG_THRESHOLD = 4

/** `Element`in burada kullanılan kısmı (testte sahtesi verilir). */
export interface CaptionNode<N> {
  closest(selector: string): N | null
  contains(other: N): boolean
}

/**
 * Basılan öğe pencerenin başlığı gibi mi davranır (sürükle, çift tıkla büyüt, sağ tıkla sistem menüsü)? En yakın
 * `.app-drag` atası varsa ve onunla öğe arasında etkileşimli / no-drag bir öğe yoksa evet. Alanı örten no-drag
 * katmanı (alanın dışındaki ata, ör. sihirbazın kökü) alanı iptal etmez.
 *
 * Neden WebView2'nin `app-region: drag` desteği değil: o destek her bölge değişiminde pencereye çocuk HWND'ler
 * kurup yıkar. Üst satırdaki sürekli animasyonlar (logo, Başlat düğmesinin parıltısı) bölgeyi her karede
 * değiştirdiği için Surround.exe'nin arayüz iş parçacığı saniyede onlarca pencere kurup yıkıyordu; WebView2'nin
 * çocuk pencereleri bu iş parçacığıyla aynı girdi kuyruğunu paylaştığından tıklama ve klavye hiç ulaşmıyordu.
 */
export function isCaptionTarget<N extends CaptionNode<N>>(target: N | null): boolean {
  const area = target?.closest('.app-drag')
  if (!target || !area) return false
  const blocker = target.closest(NO_DRAG_SELECTOR)
  return !blocker || blocker === area || !area.contains(blocker)
}

/**
 * Pencere etkin değil mi (başka uygulama önde)? `html.window-idle` süs animasyonlarını durdurur (index.css). Yalnız
 * masaüstü uygulamasında bilinir; tarayıcıda hep etkin sayılır.
 */
export function windowIdle(state: WindowState): boolean {
  return state.frameless && !state.active
}

export function syncWindowIdle(idle: boolean, root: Pick<FramelessRoot, 'classList'> = document.documentElement) {
  root.classList.toggle('window-idle', idle)
}

/** Üst kenardan yeniden boyutlandırma şeridi (px); büyütülmüşken yok. */
export const RESIZE_GRIP = 5
/** Köşe tutamağının genişliği (px). */
export const CORNER_GRIP = 12

/** Kapat düğmesi üzerine gelince: Windows'un kendi kırmızısı, beyaz glif. */
export const CLOSE_HOVER = '#c42b1c'

/** Segoe Fluent Icons / Segoe MDL2 Assets glifleri (Windows'un kendi başlık düğmeleri). */
const GLYPH = { minimize: '', maximize: '', restore: '', close: '' } as const

export interface CaptionButtonSpec {
  button: CaptionButton
  /** Windows'un Türkçe ipuçları. */
  label: string
  glyph: string
}

/** Küçült / büyüt (büyütülmüşken "önceki boyut" glifi) / kapat, soldan sağa. */
export function captionButtons(maximized: boolean): CaptionButtonSpec[] {
  return [
    { button: 'minimize', label: 'Simge durumuna küçült', glyph: GLYPH.minimize },
    maximized
      ? { button: 'maximize', label: 'Önceki boyutuna getir', glyph: GLYPH.restore }
      : { button: 'maximize', label: 'Ekranı kapla', glyph: GLYPH.maximize },
    { button: 'close', label: 'Kapat', glyph: GLYPH.close },
  ]
}

/**
 * Üst kenardaki tutamak: imleç (x, y) pencerenin üst şeridindeyse hangi kenar/köşe. Büyütülmüş pencere
 * yeniden boyutlandırılmaz. Sol/sağ/alt kenarlar Windows'un kendi (görünmez) çerçevesidir.
 */
export function topEdgeAt(x: number, y: number, width: number, maximized: boolean): ResizeEdge | null {
  if (maximized || y < 0 || y >= RESIZE_GRIP || x < 0 || x >= width) return null
  if (x < CORNER_GRIP) return 'topleft'
  if (x >= width - CORNER_GRIP) return 'topright'
  return 'top'
}

export const EDGE_CURSOR: Record<ResizeEdge, string> = { top: 'ns-resize', topleft: 'nwse-resize', topright: 'nesw-resize' }

/** Köprüden gelen durumu doğrular; eksik alanlar öncekinden kalır. */
export function normalizeWindowState(d: unknown, prev: WindowState): WindowState {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  const flag = (k: keyof WindowState) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : prev[k])
  return { frameless: flag('frameless'), maximized: flag('maximized'), active: flag('active') }
}

/** Açılış durumu: masaüstü uygulaması belge oluşturulurken `__SURROUND_FRAMELESS__` koyar (sayfa kayması olmasın). */
export function initialWindowState(w: unknown = typeof window !== 'undefined' ? window : undefined): WindowState {
  const frameless = !!(w && (w as { __SURROUND_FRAMELESS__?: unknown }).__SURROUND_FRAMELESS__ === true)
  return { frameless, maximized: false, active: true }
}
