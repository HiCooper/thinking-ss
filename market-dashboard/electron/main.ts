/**
 * Electron 主进程：桌面版宿主。
 *
 * 职责（与 Web 版 `npm start` 的 Vite server 一一对应）：
 *   1. 自起一个只绑 127.0.0.1 的 http server（随机端口，避免与 Vite/Web 版冲突）：
 *      - /api/*        → server/apiCore.ts 的中间件（与 Web 版同一份代码）
 *      - /data.json    → userData 缓存优先，退回包内 dist/data.json（基线）
 *      - 其余路径       → dist/ 静态文件（index.html 兜底）
 *   2. 启动时（以及每 6 小时）尝试在线拉最新 data.json 写入 userData 缓存；
 *      拉不到（断网/被墙）就用包内基线，**永不白屏**。
 *      镜像顺序：jsdelivr（国内可达性好）→ raw.githubusercontent。
 *   3. BrowserWindow 加载本地 server。
 *
 * 持仓文件候选（阶段2的导入向导会往第一个路径写）：
 *   userData/holdings.json → 包内 dist/holdings.json（打包时通常不存在，返回 404，
 *   前端据此显示「未导入持仓」的引导态）。
 */
import { app, BrowserWindow, shell } from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { promises as fsp, existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createApiMiddleware } from '../server/apiCore.ts'

const APP_ROOT = path.join(__dirname, '..')
/** 前端构建产物（electron-builder 的 files 里包含 dist/**）。 */
const DIST_DIR = path.join(APP_ROOT, 'dist')
/** 在线数据缓存与持仓文件的存放处（用户目录，随 App 存续，卸载重装不丢持仓）。 */
const USER_DATA = app.getPath('userData')
const DATA_CACHE = path.join(USER_DATA, 'data-cache', 'data.json')
const HOLDINGS_LOCAL = path.join(USER_DATA, 'holdings.json')

/** data.json 在线更新源（按顺序尝试，前者国内可达性更好）。 */
const DATA_URLS = [
  'https://cdn.jsdelivr.net/gh/HiCooper/thinking-ss@main/market-dashboard/public/data.json',
  'https://raw.githubusercontent.com/HiCooper/thinking-ss/main/market-dashboard/public/data.json',
]

/* ------------------------------ data.json 在线更新 ------------------------------ */

const DATA_MIN_BYTES = 10_000

/**
 * 依次尝试镜像，成功且体量合理 → 写入 userData 缓存。
 * 任何一步失败都静默返回 false（启动日志打一行即可），包内基线永远可用。
 */
async function refreshDataCache(): Promise<boolean> {
  for (const url of DATA_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < DATA_MIN_BYTES) continue
      // 简单合法性校验：必须是能 parse 的 JSON 且带生成日期字段
      const parsed = JSON.parse(buf.toString('utf-8')) as { generated_at?: string }
      if (!parsed.generated_at) continue
      await fsp.mkdir(path.dirname(DATA_CACHE), { recursive: true })
      await fsp.writeFile(DATA_CACHE, buf)
      console.log(`[data] 已更新本地缓存（${buf.length} 字节，generated_at=${parsed.generated_at}）`)
      return true
    } catch {
      // 换下一个镜像
    }
  }
  console.log('[data] 在线更新失败，使用包内基线数据')
  return false
}

/* ------------------------------ http server ------------------------------ */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** 静态文件：路径穿越防护 + index.html 兜底。 */
function serveStatic(res: ServerResponse, pathname: string): void {
  const rel = pathname.replace(/^\/+/, '') || 'index.html'
  const file = path.normalize(path.join(DIST_DIR, rel))
  const target = file.startsWith(DIST_DIR) && existsSync(file) && statSync(file).isFile()
    ? file
    : path.join(DIST_DIR, 'index.html') // SPA 兜底
  try {
    const body = readFileSync(target)
    res.statusCode = 200
    res.setHeader('Content-Type', MIME[path.extname(target)] ?? 'application/octet-stream')
    res.end(body)
  } catch {
    res.statusCode = 404
    res.end('not found')
  }
}

/**
 * /data.json 覆盖：userData 缓存（在线更新的最新版）优先，退回包内 dist/data.json。
 * 缓存版本号也反映在 /api/data-version 里（中间件的候选列表顺序一致）。
 */
function serveDataJson(res: ServerResponse): void {
  const source = existsSync(DATA_CACHE) ? DATA_CACHE : path.join(DIST_DIR, 'data.json')
  try {
    const body = readFileSync(source)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store, max-age=0')
    res.end(body)
  } catch {
    res.statusCode = 404
    res.end('data.json not found')
  }
}

function startServer(): Promise<number> {
  const api = createApiMiddleware(
    [DATA_CACHE, path.join(DIST_DIR, 'data.json')],
    [HOLDINGS_LOCAL, path.join(DIST_DIR, 'holdings.json')],
  )
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const pathname = (req.url ?? '').split('?')[0]
      if (pathname === '/data.json') {
        serveDataJson(res)
        return
      }
      if (pathname.startsWith('/api/')) {
        api(req, res, () => {
          res.statusCode = 404
          res.end('not found')
        })
        return
      }
      serveStatic(res, pathname)
    })
    server.on('error', reject)
    // 只绑回环地址 + 随机端口：不与 Web 版 5183 冲突，也不暴露到局域网
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
}

/* ------------------------------ 窗口与生命周期 ------------------------------ */

async function createWindow(): Promise<void> {
  const port = await startServer()
  console.log(`[server] http://127.0.0.1:${port}`)

  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'A股看板',
    backgroundColor: '#f7f7f5',
    autoHideMenuBar: true,
    webPreferences: {
      // 本地渲染无远程内容；暂不需要 preload（阶段2导入向导再加 IPC）
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 页面内链接（如快讯里的原文链接）交给系统浏览器，而不是在窗口里跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.DESKTOP_DEV_URL
  if (devUrl) {
    // 联调模式：desktop:run + 另开的 vite dev server
    await win.loadURL(devUrl)
  } else {
    await win.loadURL(`http://127.0.0.1:${port}/`).catch((err: unknown) => {
      // 加载失败（如无 GPU 环境渲染进程起不来）不该让主进程崩掉：
      // server 还活着，用户重开窗口即可
      console.error('[window] 加载失败：', err)
    })
  }

  void refreshDataCache()
  // 每 6 小时静默刷新一次历史数据缓存（长开的看板场景）
  setInterval(() => void refreshDataCache(), 6 * 3600 * 1000).unref?.()
}

app.whenReady().then(() => {
  void createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

// 看板工具：关窗即退出（不做 macOS 常驻），简单直观
app.on('window-all-closed', () => {
  app.quit()
})
