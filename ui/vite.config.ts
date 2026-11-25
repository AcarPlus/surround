import { searchForWorkspaceRoot } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Göreli yol: uygulama yerel diskten sanal ana makine adıyla (https://app.surround/) servis edilir.
  base: './',
  plugins: [react()],
  // Başlık çubuğu uygulamanın gerçek simgesini (src/Surround.App/Assets/surround.ico) kullanır.
  server: { port: 5173, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../src/Surround.App/Assets'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
