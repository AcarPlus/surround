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
import { TitleBar } from './components/TitleBar'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="flex h-full flex-col">
      {/* Windows başlığının yerine (yalnız masaüstü uygulamasında). */}
      <TitleBar />
      {/* contain: paint -> tam ekran katmanlar (sihirbaz, bildirim) başlık çubuğunun altında kalır. */}
      <div className="min-h-0 flex-1" style={{ contain: 'paint' }}>
        <App />
      </div>
    </div>
  </StrictMode>,
)
// Açılış ölçümü: ilk kare ekrana çizildikten sonra (bir sonraki kare başında).
requestAnimationFrame(() => setTimeout(() => api.startupMark('paint').catch(() => {}), 0))
