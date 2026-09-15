import { useCallback, useEffect, useState } from 'react'
import './App.css'
import Dashboard from './components/Dashboard'
import { DataMissingError, fetchDataVersion, fetchMarketData } from './api'
import type { MarketData } from './types'

/** 轮询 `/api/data-version` 的间隔：与 LiveStrip 的实时刷新同频。 */
const VERSION_POLL_MS = 30_000
/** 「数据已更新」提示的停留时间（随后淡出）。 */
const TOAST_MS = 2600

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; data: MarketData }
  | { status: 'empty'; title: string; detail: string }
  | { status: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  /**
   * `silent=true`（自动重载 / 手动重试且已有数据）时不切回 loading 态，
   * 保留当前图表直到新数据到位，避免页面闪一下、尺寸跳动。
   */
  const load = useCallback(async (signal: AbortSignal, silent = false) => {
    if (!silent) setState({ status: 'loading' })
    try {
      const data = await fetchMarketData(signal)
      if (signal.aborted) return
      if (data.rows.length === 0) {
        setState({
          status: 'empty',
          title: '数据文件为空',
          detail: '/data.json 解析成功，但 rows 数组为空。请运行数据生成脚本写入交易日数据后重试。',
        })
        return
      }
      setState({ status: 'ready', data })
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
      if (err instanceof DataMissingError) {
        setState({
          status: 'empty',
          title: '暂无数据',
          detail:
            '未找到 /data.json（HTTP 404），数据文件尚未生成。请先运行数据脚本，把结果写入 public/data.json，然后刷新页面。',
        })
        return
      }
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    // 首次加载显示 loading；之后（自动重载/重试）静默换数据
    void load(controller.signal, reloadKey > 0)
    return () => controller.abort()
  }, [load, reloadKey])

  // 数据热更新：每 30s 比对 data.json 的 mtime/size，变了就重载图表数据。
  // /api/data-version 不可用（静态部署 404 / 网络失败）时 fetchDataVersion 返回 null，静默忽略。
  useEffect(() => {
    let alive = true
    let lastKey: string | null = null

    const check = async () => {
      const version = await fetchDataVersion()
      if (!alive || !version) return
      const key = `${version.mtime}:${version.size}`
      if (lastKey === null) {
        lastKey = key // 首轮只记基线
        return
      }
      if (key === lastKey) return
      lastKey = key
      setReloadKey((k) => k + 1)
      const now = new Date()
      setToast(`数据已更新 · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
    }

    void check()
    const id = window.setInterval(() => void check(), VERSION_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  // 提示自动淡出
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(id)
  }, [toast])

  const data = state.status === 'ready' ? state.data : null

  return (
    <div className="app">
      {toast ? (
        <div className="toast num" role="status">
          {toast}
        </div>
      ) : null}

      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__dot" aria-hidden="true" />
          <h1 className="topbar__title">大盘看板</h1>
          <span className="topbar__sub">A 股市场情绪与流动性</span>
        </div>
        <div className="topbar__meta">
          <span className="topbar__meta-label">数据生成时间</span>
          <span className="topbar__meta-value num">{data ? data.generated_at : '—'}</span>
        </div>
      </header>

      <p className="topbar__sources">
        <span className="topbar__sources-label">数据来源</span>
        {data?.sources ? data.sources : '—'}
      </p>

      <main className="content">
        {state.status === 'loading' ? <LoadingView /> : null}
        {state.status === 'empty' ? (
          <EmptyView title={state.title} detail={state.detail} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : null}
        {state.status === 'error' ? (
          <ErrorView message={state.message} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : null}
        {state.status === 'ready' ? <Dashboard data={state.data} /> : null}
      </main>

      <footer className="footer">
        <span>market-dashboard · 纯前端渲染，数据全部来自运行时读取的 /data.json，页面不内置任何行情数据。</span>
        <span className="muted">单位：金额 亿元 · 收益率 % · 涨跌沿用 A 股习惯（红涨绿跌）</span>
      </footer>
    </div>
  )
}

function LoadingView() {
  return (
    <div className="state-panel card">
      <div className="spinner" aria-hidden="true" />
      <p className="state-panel__title">正在加载 /data.json …</p>
      <p className="state-panel__detail">首次加载需要解析约 250 个交易日的数据。</p>
    </div>
  )
}

function EmptyView({
  title,
  detail,
  onRetry,
}: {
  title: string
  detail: string
  onRetry: () => void
}) {
  return (
    <div className="state-panel card state-panel--notice">
      <div className="state-panel__badge">NO DATA</div>
      <p className="state-panel__title">{title}</p>
      <p className="state-panel__detail">{detail}</p>
      <div className="state-panel__hint">
        <p>期望路径：<code>public/data.json</code>（构建后即 <code>/data.json</code>）</p>
        <p>期望结构：</p>
        <pre className="state-panel__code">{`{
  "generated_at": "2026-09-15 21:30 CST",
  "sources": "数据来源说明",
  "rows": [
    { "date": "2025-09-16", "turnover_sh": 7000.1, "turnover_sz": 8000.2,
      "turnover_total": 15000.3, "us10y": 4.05, "cn10y": 1.75,
      "margin_rz": 23800.1, "margin_rq": 200.4, "margin_total": 24000.5 }
  ]
}`}</pre>
        <p className="muted">任何字段都允许为 null，图表会自动跳过且不连线。</p>
      </div>
      <button type="button" className="btn" onClick={onRetry}>
        重新加载
      </button>
    </div>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-panel card state-panel--error">
      <div className="state-panel__badge state-panel__badge--error">ERROR</div>
      <p className="state-panel__title">数据加载失败</p>
      <p className="state-panel__detail">{message}</p>
      <button type="button" className="btn" onClick={onRetry}>
        重试
      </button>
    </div>
  )
}
