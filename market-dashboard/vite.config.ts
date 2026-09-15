import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localApi } from './plugin/localApi'

// 手工维护的最小 Vite 配置（未使用 `npm create vite`）。
// 端口：默认 5183，可用环境变量覆盖（换机器时 5183 可能被占）：PORT=5190 npm start
const PORT = Number(process.env.PORT || 5183)

export default defineConfig({
  // localApi：内联本地接口 /api/spot（dev + preview 都挂载），见 plugin/localApi.ts
  plugins: [react(), localApi()],
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
