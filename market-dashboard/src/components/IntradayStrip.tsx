import { useEffect, useState } from 'react'
import { fetchIntraday } from '../api'
import { fmtNum, fmtPct, trendClass } from '../format'
import { turnoverSummary } from '../intraday'
import IndexIntradayChart from './IndexIntradayChart'
import type { IntradayData, IntradaySeries } from '../types'

/** 交易时段 5 秒一轮；盘前 / 午休 / 收盘后 30 秒足够（分时不会动）。 */
const LIVE_MS = 5_000
const IDLE_MS = 30_000

type Status = 'loading' | 'ready' | 'unavailable'

/**
 * 盘中分时：沪深300 / 科创50 两张走势图。
 *
 * 数据走 `/api/intraday`（腾讯分钟线）。腾讯的**最后一个点就是当前分钟**、随请求更新，
 * 所以 5 秒轮询看到的不是「等下一根分钟 K」，而是最后一个点在连续移动。
 * 静态部署没有该接口 → 显示一条浅色提示，不白屏。
 */
export default function IntradayStrip() {
  const [data, setData] = useState<IntradayData | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [note, setNote] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    let timer: number | undefined

    // 递归 setTimeout 而不是 setInterval：上一次响应没回来就不发下一次，避免请求堆积
    const tick = (): void => {
      fetchIntraday(controller.signal)
        .then((d) => {
          if (!alive) return
          // 盘前 / 非交易日：接口正常但还没有当日点 → 仍算 ready，图内提示「尚未开始」；
          // 有报错且一个点都没拿到 → 才算接口不可用，避免把「还没开盘」误报成故障。
          const hasAny = d.indices.some((s) => s.points.length > 0)
          if (hasAny || d.errors.length === 0) {
            setData(d)
            setStatus('ready')
            setNote(d.errors.join('；'))
          } else {
            setStatus((prev) => (prev === 'ready' ? prev : 'unavailable'))
            setNote(d.errors.join('；'))
          }
          timer = window.setTimeout(tick, d.session.state === 'open' ? LIVE_MS : IDLE_MS)
        })
        .catch((err: unknown) => {
          if (!alive) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          setStatus((prev) => (prev === 'ready' ? prev : 'unavailable'))
          setNote(err instanceof Error ? err.message : String(err))
          timer = window.setTimeout(tick, IDLE_MS)
        })
    }

    tick()
    return () => {
      alive = false
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [reloadKey])

  const session = data?.session

  return (
    <section className="card live-strip intraday-strip">
      <header className="live-strip__head">
        <div className="live-strip__title-wrap">
          <h2 className="live-strip__title">
            <span className="live-strip__dot" aria-hidden="true" />
            实时分时
            {session ? (
              <span className={`live-strip__session live-strip__session--${session.state}`}>
                {session.label}
              </span>
            ) : null}
          </h2>
          <p className="live-strip__sub">
            沪深300 / 科创50 · 腾讯分钟线（末点为当前分钟）· 交易时段每 5 秒刷新 ·
            上栏价格走势（灰虚线为昨收），下栏累计成交额对比上一交易日同时刻，两栏共用一条时间轴
          </p>
        </div>

        <div className="live-strip__controls">
          <span className="live-strip__ts num">{data?.ts ?? '—'}</span>
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
          <p className="live-strip__notice">实时分时接口不可用（需通过 npm run dev / npm run preview 访问）</p>
          {note ? <p className="live-strip__notice-detail muted">{note}</p> : null}
        </div>
      ) : status === 'loading' && !data ? (
        <p className="live-strip__notice">正在读取 /api/intraday …</p>
      ) : (
        <>
          <div className="intraday-grid">
            {data?.indices.map((s) => (
              <IntradayTile key={s.code} series={s} />
            ))}
          </div>
          {note ? <p className="live-strip__errors muted">部分子项抓取失败：{note}</p> : null}
        </>
      )}
    </section>
  )
}

function IntradayTile({ series }: { series: IntradaySeries }) {
  const last = series.points.length > 0 ? series.points[series.points.length - 1] : null
  const base = series.prev_close
  const chg = last && base !== null && base > 0 ? (last.v / base - 1) * 100 : null
  const amt = turnoverSummary(series)

  return (
    <div className="intraday-tile">
      <div className="intraday-tile__head">
        <span className="intraday-tile__name">{series.name}</span>
        <span className="intraday-tile__price num">{last ? fmtNum(last.v, 2) : '—'}</span>
        <span className={`intraday-tile__chg num ${trendClass(chg)}`}>{fmtPct(chg)}</span>
        <span className="intraday-tile__time num">{last?.t ?? '—'}</span>
      </div>
      <div className="intraday-tile__amt">
        <span>累计成交额</span>
        <span className="intraday-tile__amt-now num">
          {amt.now === null ? '—' : `${fmtNum(amt.now, 0)} 亿`}
        </span>
        <span className="num">
          {amt.prevLabel} {amt.prev === null ? '—' : `${fmtNum(amt.prev, 0)} 亿`}
        </span>
        <span className={`intraday-tile__amt-yoy num ${trendClass(amt.yoy)}`}>
          {fmtPct(amt.yoy)}
        </span>
      </div>
      <IndexIntradayChart series={series} />
    </div>
  )
}
