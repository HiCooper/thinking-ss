import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchSpot } from '../api'
import { fmtNum, fmtPct, trendClass } from '../format'
import Sparkline from './Sparkline'
import type { SparkSeries, SpotData } from '../types'

/** 自动刷新间隔（毫秒）。 */
const REFRESH_MS = 30_000

type Status = 'loading' | 'ready' | 'unavailable'

/** 指数信息条的挂载点（index.html 里的 #ticker-root，配合 fixed 固定在屏幕底部）。 */
const tickerHost = (): HTMLElement | null =>
  typeof document === 'undefined' ? null : document.getElementById('ticker-root')

/**
 * 实时面板：挂在摘要卡上方，展示两市成交额 / A50 / KOSPI / KOSDAQ。
 *
 * 数据来自本地接口 `/api/spot`（Vite 服务端代理新浪 hq.sinajs.cn）。
 * 静态部署下该接口不存在 → 只显示一条浅色提示并隐藏数值，不白屏、不抛错。
 */
export default function LiveStrip() {
  const [data, setData] = useState<SpotData | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [note, setNote] = useState('')
  const [auto, setAuto] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // 取数：reloadKey 变化即重新请求（首次挂载、定时器、手动刷新都会改它）
  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    // 已有数据时刷新不闪 loading，静默换成新值
    setStatus((prev) => (prev === 'ready' ? prev : 'loading'))

    fetchSpot(controller.signal)
      .then((d) => {
        if (!alive) return
        setData(d)
        setStatus('ready')
        setNote('')
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setData(null)
        setStatus('unavailable')
        setNote(err instanceof Error ? err.message : String(err))
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [reloadKey])

  // 自动刷新：默认 30s，可暂停
  useEffect(() => {
    if (!auto) return
    const id = window.setInterval(() => setReloadKey((k) => k + 1), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [auto])

  const cn = data?.cn ?? null
  const a50 = data?.a50 ?? null
  const nq = data?.nq ?? null
  const kospi = data?.korea?.kospi ?? null
  const session = data?.session

  // 指数信息条：portal 到 #ticker-root（fixed 钉在屏幕底部）。容器缺失时退化为原地渲染，
  // 这样即使 index.html 的挂载点被改动，功能也不会丢。
  const host = tickerHost()
  const indexBar =
    cn && cn.indices.length > 0 ? (
      <ul className="live-indices">
        {cn.indices.map((ix) => (
          <li className="live-index" key={ix.code}>
            <span className="live-index__name">{ix.name}</span>
            <span className="live-index__price num">{fmtNum(ix.price, 2)}</span>
            <span className={`live-index__chg num ${trendClass(ix.chg_pct)}`}>
              {fmtPct(ix.chg_pct)}
            </span>
          </li>
        ))}
      </ul>
    ) : null
  const ticker = indexBar && host ? createPortal(indexBar, host) : indexBar

  return (
    <section className="card live-strip">
      <header className="live-strip__head">
        <div className="live-strip__title-wrap">
          <h2 className="live-strip__title">
            <span className="live-strip__dot" aria-hidden="true" />
            实时行情
            {session ? (
              <span className={`live-strip__session live-strip__session--${session.state}`}>
                {session.label}
              </span>
            ) : null}
          </h2>
          <p className="live-strip__sub">
            数据来源：新浪财经实时（hq.sinajs.cn）· 经本地服务端代理 <code>/api/spot</code> · 金额单位 亿元
          </p>
        </div>

        <div className="live-strip__controls">
          <span className="live-strip__ts num">{data ? data.ts : '—'}</span>
          <button
            type="button"
            className={`btn btn--mini ${auto ? '' : 'btn--mini-off'}`}
            onClick={() => setAuto((v) => !v)}
            aria-pressed={auto}
          >
            {auto ? `暂停自动刷新（${REFRESH_MS / 1000}s）` : '继续自动刷新'}
          </button>
          <button
            type="button"
            className="btn btn--mini btn--mini-primary"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? '刷新中…' : '立即刷新'}
          </button>
        </div>
      </header>

      {status === 'unavailable' ? (
        <div className="live-strip__fallback">
          <p className="live-strip__notice">实时接口不可用（需通过 npm run dev / npm run preview 访问）</p>
          {note ? <p className="live-strip__notice-detail muted">{note}</p> : null}
        </div>
      ) : status === 'loading' && !data ? (
        <p className="live-strip__notice">正在读取 /api/spot …</p>
      ) : (
        <>
          {/* 指数信息条：不在面板内渲染 —— portal 到 #ticker-root（body 直属），
              由 position:fixed;bottom:0 固定在屏幕底部、铺满 100% 宽；窄屏降为 3/2 列。
              面板内不再占位，故这里只渲染三张跨市场卡。 */}
          {ticker}

          <div className="live-grid">
            <QuoteTile
              label="富时中国 A50（期货）"
              price={a50?.price ?? null}
              chg={a50?.chg_pct ?? null}
              time={a50?.time ?? null}
              name="A50"
              spark={data?.spark.a50 ?? null}
            />
            <QuoteTile
              label={kospi?.name || 'KOSPI'}
              price={kospi?.price ?? null}
              chg={kospi?.chg_pct ?? null}
              time={kospi?.time ?? null}
              name="KOSPI"
              spark={data?.spark.kospi ?? null}
            />
            {/* KOSDAQ 快照与分时仍保留在 /api/spot 的 payload 里（korea.kosdaq / spark.kosdaq），
                这里换成纳指期货：全球科技风险偏好的锚，且近乎 24 小时连续交易 */}
            <QuoteTile
              label="纳指期货（NQ）"
              price={nq?.price ?? null}
              chg={nq?.chg_pct ?? null}
              time={nq?.time ?? null}
              name="NQ"
              spark={data?.spark.nq ?? null}
            />
          </div>

          {data && data.errors.length > 0 ? (
            <p className="live-strip__errors muted">部分子项抓取失败：{data.errors.join('；')}</p>
          ) : null}
        </>
      )}
    </section>
  )
}

function QuoteTile({
  label,
  price,
  chg,
  time,
  name,
  spark,
}: {
  label: string
  price: number | null
  chg: number | null
  time: string | null
  /** 迷你图口径名（tooltip 前缀），不传则不渲染迷你图 */
  name?: string
  spark?: SparkSeries | null
}) {
  // 点数为 0/1 时不渲染迷你图（卡片其余照常，尺寸也不变）
  const usable = name && spark && spark.points.length >= 2 ? spark : null
  return (
    <div className="live-tile">
      <div className="live-tile__label">
        {label}
        <span className="live-tile__time num">{time ?? '—'}</span>
      </div>
      {/* 数值行：第一行「数值 + 涨跌幅」同行（涨跌幅紧跟数值），第二行迷你图。
          把涨跌幅并入数值行省掉一整行，正好抵消迷你图占用的高度 → 卡片尺寸不变。 */}
      <div className="live-tile__value-row">
        <div className="live-tile__figure">
          <span className="live-tile__value num">{fmtNum(price, 2)}</span>
          <span className={`live-tile__chg num ${trendClass(chg)}`}>{fmtPct(chg)}</span>
        </div>
        {usable && name ? <Sparkline series={usable} name={name} /> : null}
      </div>
    </div>
  )
}
