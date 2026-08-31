import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  root: 'client',
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  server: {
    port: 3000,
    proxy: { '/v1': 'http://localhost:8787' },
  },
  build: { outDir: '../dist/client', emptyOutDir: true },
})
