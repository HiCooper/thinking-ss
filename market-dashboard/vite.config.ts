import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 手工维护的最小 Vite 配置（未使用 `npm create vite`）。
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5183,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5183,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
