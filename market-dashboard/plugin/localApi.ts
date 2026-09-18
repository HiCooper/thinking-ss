/**
 * Vite 插件封装：把 server/apiCore.ts 的框架无关中间件挂到 Vite dev / preview server 上。
 *
 * 所有抓取与解析逻辑都在 server/apiCore.ts（桌面版 Electron 主进程复用同一份），
 * 本文件只负责挑选宿主环境下的数据文件候选路径：
 *   - dev：页面读的是 public/data.json
 *   - preview：页面读的是构建产物 outDir/data.json；它不存在时退回 public/data.json
 */
import type { Connect, Plugin } from 'vite'
import { createApiMiddleware, dataFile } from '../server/apiCore.ts'

export function localApi(): Plugin {
  return {
    name: 'market-dashboard:local-api',
    configureServer(server) {
      const { root, publicDir } = server.config
      const pub = publicDir || 'public'
      server.middlewares.use(
        createApiMiddleware(
          [dataFile(root, pub)],
          [dataFile(root, pub, 'holdings.json')],
        ) as unknown as Connect.NextHandleFunction,
      )
    },
    configurePreviewServer(server) {
      const { root, publicDir, build } = server.config
      const out = build.outDir || 'dist'
      const pub = publicDir || 'public'
      server.middlewares.use(
        createApiMiddleware(
          [dataFile(root, out), dataFile(root, pub)],
          [dataFile(root, out, 'holdings.json'), dataFile(root, pub, 'holdings.json')],
        ) as unknown as Connect.NextHandleFunction,
      )
    },
  }
}

// 类型全部源自 apiCore（NewsItem 等被 src 直接引用）
export * from '../server/apiCore.ts'
