import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Göreli yol: uygulama yerel diskten sanal ana makine adıyla (https://app.surround/) servis edilir.
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
