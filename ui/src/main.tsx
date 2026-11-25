import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/600.css'
import './index.css'
import { App } from './App'
import { api } from './api/client'
import { WindowControls } from './components/WindowControls'
import { initialWindowState, syncFrameless } from './lib/titlebar'

// İlk çizimden önce: çerçevesiz pencerede üst satır düğmelere yer ayırır ve sürüklenir (sayfa kayması olmasın).
syncFrameless(initialWindowState().frameless)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Ayrı başlık şeridi yok: pencere düğmeleri uygulamanın üst satırının sağ üst köşesinde (yalnız masaüstünde). */}
    <WindowControls />
  </StrictMode>,
)
// Açılış ölçümü: ilk kare ekrana çizildikten sonra (bir sonraki kare başında).
requestAnimationFrame(() => setTimeout(() => api.startupMark('paint').catch(() => {}), 0))
