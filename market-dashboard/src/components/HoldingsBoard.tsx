import { useCallback, useEffect, useMemo, useState } from 'react'
import ChartCard from './ChartCard'
import HoldingsSummary from './HoldingsSummary'
import HoldingsStructureChart from './HoldingsStructureChart'
import HoldingsPnlChart from './HoldingsPnlChart'
import HoldingsTable from './HoldingsTable'
import {
  HoldingsMissingError,
  breakevenOf,
  buildCells,
  fetchHoldingQuotes,
  fetchHoldings,
  groupStats,
  portfolioTotals,
} from '../holdings'
import type { HoldingQuotesFile, HoldingsFile } from '../holdings'
import { fmtInt, fmtNum, fmtPct, fmtSigned, trendClass } from '../format'

/** 实时报价轮询间隔：与 LiveStrip / data-version 保持一致。 */
const QUOTES_POLL_MS = 30_000

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; file: HoldingsFile }
  | { status: 'missing'; message: string }
  | { status: 'error'; message: string }

/**
 * 我的持仓看板。
 *
 * 数据分两层，互不阻塞：
 *   - `holdings.json`（静态）：份额与成本，决定整个页面的骨架，加载失败才是致命错误；
 *   - `/api/holdings`（本地实时）：现价，拿不到就回退快照价并标注，**不算错误**。
 */
export default function HoldingsBoard() {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [quotes, setQuotes] = useState<HoldingQuotesFile | null>(null)
  const [quotesLoaded, setQuotesLoaded] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // 静态快照：份额与成本
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchHoldings(controller.signal)
      .then((file) => {
        if (!controller.signal.aborted) setState({ status: 'ready', file })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        const message = err instanceof Error ? err.message : String(err)
        setState(
          err instanceof HoldingsMissingError
            ? { status: 'missing', message }
            : { status: 'error', message },
        )
      })
    return () => controller.abort()
  }, [reloadKey])

  // 实时报价：轮询；接口不可用（静态部署）时静默保持 null
  const loadQuotes = useCallback(async (signal: AbortSignal) => {
    const data = await fetchHoldingQuotes(signal)
    if (signal.aborted) return
    setQuotes(data)
    setQuotesLoaded(true)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    const tick = () => {
      void loadQuotes(controller.signal).catch(() => {
        if (alive) setQuotesLoaded(true)
      })
    }
    tick()
    const id = window.setInterval(tick, QUOTES_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
      controller.abort()
    }
  }, [loadQuotes])

  const file = state.status === 'ready' ? state.file : null

  const cells = useMemo(() => (file ? buildCells(file, quotes) : []), [file, quotes])
  const totals = useMemo(() => portfolioTotals(cells), [cells])
  /** 「距成本」的双向语义（亏损＝回本需涨 / 盈利＝可回撤），与表格、总览卡共用同一判定 */
  const be = breakevenOf(totals)
  const groups = useMemo(() => (file ? groupStats(cells, file.groups) : []), [cells, file])

  if (state.status === 'loading') {
    return (
      <div className="state-panel card">
        <div className="spinner" aria-hidden="true" />
        <p className="state-panel__title">正在加载 /holdings.json …</p>
        <p className="state-panel__detail">持仓明细来自仓库根目录的 holdings.md，由脚本导出为静态 JSON。</p>
      </div>
    )
  }

  if (state.status === 'missing' || state.status === 'error') {
    const missing = state.status === 'missing'
    return (
      <div className={`state-panel card state-panel--${missing ? 'notice' : 'error'}`}>
        <div className={`state-panel__badge${missing ? '' : ' state-panel__badge--error'}`}>
          {missing ? 'NO DATA' : 'ERROR'}
        </div>
        <p className="state-panel__title">{missing ? '暂无持仓数据' : '持仓数据加载失败'}</p>
        <p className="state-panel__detail">{state.message}</p>
        {missing ? (
          <div className="state-panel__hint">
            <p>
              持仓是<b>本地隐私文件</b>，不随仓库分发（处理方式同 <code>.env</code>），
              所以刚 clone 下来的仓库里没有持仓数据 —— 这是预期状态，不是故障。
            </p>
            <p>首次使用，在仓库根目录执行：</p>
            <pre className="state-panel__code">{`cp holdings.example.md holdings.md    # 然后填入自己的持仓
cd market-dashboard && npm run holdings:export`}</pre>
            <p>
              期望产物：<code>public/holdings.json</code>（构建后即 <code>/holdings.json</code>）
            </p>
            <p className="muted">
              字段口径与校验规则见 <code>holdings.example.md</code> 的「如何填」与{' '}
              <code>AGENTS.md</code> §B5。
            </p>
          </div>
        ) : null}
        <button type="button" className="btn" onClick={() => setReloadKey((k) => k + 1)}>
          重新加载
        </button>
      </div>
    )
  }

  const isLive = quotes !== null && totals.liveCount > 0
  const allLive = totals.liveCount === totals.count

  return (
    <>
      {/* 板块标题：与大盘看板的 section-head 同款语言 */}
      <section className="section-head">
        <div className="section-head__wrap">
          <h2 className="section-head__title">
            <span className={`section-head__dot${isLive ? ' section-head__dot--live' : ''}`} aria-hidden="true" />
            我的持仓
          </h2>
          <p className="section-head__sub">
            共 {totals.count} 只 · 快照 {state.file.as_of} · {state.file.account}；
            份额与成本来自 <code>holdings.md</code>，现价
            {isLive ? '每 30 秒从新浪实时刷新' : '因无实时接口而降级为快照价'}
          </p>
        </div>
        <div className="section-head__meta">
          {isLive ? (
            <span className="tag">实时 · {quotes?.ts}</span>
          ) : (
            <span className="tag tag--ghost">静态快照 · 无实时接口</span>
          )}
          <span className="tag tag--ghost">单位：元</span>
        </div>
      </section>

      {!quotesLoaded ? (
        <p className="holdings-notice muted">正在读取 /api/holdings …</p>
      ) : null}

      {quotesLoaded && !isLive ? (
        <p className="holdings-notice holdings-notice--warn">
          实时接口 <code>/api/holdings</code> 不可用：页面显示的是 <b>{state.file.as_of}</b> 的快照价，
          浮动盈亏为当时的数值。请通过 <code>npm start</code>（dev / preview）访问以获得实时报价。
        </p>
      ) : null}

      {!allLive && isLive ? (
        <p className="holdings-notice holdings-notice--warn">
          有 {totals.count - totals.liveCount} 只未取到实时报价，已回退为快照价（表格中带
          <em className="holdings-snap-dot holdings-snap-dot--inline" /> 标记）。
        </p>
      ) : null}

      {quotes && quotes.errors.length > 0 ? (
        <p className="holdings-notice muted">部分持仓取价失败：{quotes.errors.join('；')}</p>
      ) : null}

      <HoldingsSummary cells={cells} totals={totals} quotes={quotes} />

      <div className="chart-grid">
        <ChartCard
          index="图 1"
          title="分组结构：市值占比 vs 盈亏贡献"
          subtitle="两根条越不成比例，说明这组对总盈亏的影响远超它的仓位占比——亏损组向左、盈利组向右，0 处为参考线"
          className="chart-card--wide"
          meta={
            <>
              <span className="tag">单位：%</span>
              <span className="tag tag--ghost">贡献 = 该组净盈亏 / 全部持仓盈亏绝对额之和</span>
            </>
          }
        >
          <HoldingsStructureChart groups={groups} />
        </ChartCard>

        <ChartCard
          index="图 2"
          title="个股盈亏排行"
          subtitle="按盈亏金额排序（最惨在最上，盈利的在下方），颜色深浅表示盈亏幅度；金额与幅度不一致时以金额看痛点"
          className="chart-card--wide"
          meta={
            <>
              <span className="tag">单位：元</span>
              <span className="tag tag--ghost">{cells.length} 只</span>
            </>
          }
        >
          <HoldingsPnlChart cells={cells} />
        </ChartCard>
      </div>

      <HoldingsTable cells={cells} groups={groups} />

      <p className="footnote">
        合计：市值 {fmtInt(totals.marketValue)} 元　·　成本 {fmtInt(totals.costValue)} 元　·　浮动盈亏{' '}
        <span className={trendClass(totals.pnl)}>{fmtSigned(totals.pnl, 0)} 元</span>
        （{fmtPct(totals.pnlPct * 100)}）　·　{be.kind === 'recover' ? '回本需涨 ' : '可回撤 '}
        {be.kind === 'recover' ? fmtPct(be.pct * 100, 1) : `${fmtNum(be.pct * 100, 1)}%`}　·　亏损 / 盈利{' '}
        {totals.losers} / {totals.winners} 只
        {totals.todayPnl !== null ? (
          <>
            　·　今日 <span className={trendClass(totals.todayPnl)}>{fmtSigned(totals.todayPnl, 0)} 元</span>
          </>
        ) : null}
      </p>
    </>
  )
}
