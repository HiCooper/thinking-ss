import { useMemo } from 'react'
import { fmtInt, fmtNum, fmtPct, fmtSigned, trendClass } from '../format'
import { breakevenOf } from '../holdings'
import type { HoldingCell, HoldingQuotesFile, PortfolioTotals } from '../holdings'

interface HoldingsSummaryProps {
  cells: HoldingCell[]
  totals: PortfolioTotals
  quotes: HoldingQuotesFile | null
}

interface Metric {
  key: string
  label: string
  value: string
  unit: string
  hint?: string
  trend?: number | null
  details: { label: string; text: string; trend?: number | null; title?: string }[]
}

/**
 * 持仓总览卡。沿用大盘看板的 `.summary-grid / .summary-card` 样式，保持两屏视觉一致。
 *
 * 约定：`holdings.ts` 里的比率一律是**小数**（-0.185），而 `fmtPct` 收的是**百分数**（-18.5），
 * 所以传给 fmtPct 之前统一 ×100。「距成本」的双向语义由 `breakevenOf` 统一判定。
 *
 * **这里没有「价格口径」卡**：报价时间、快照回退只数、降级原因已经在四处呈现，再占一张卡是重复——
 * 区块标题右侧的 `实时 · 时间` 标签、降级时的黄色提示条、明细表每行的快照小圆点、表格副标题说明。
 * 栅格是 4 列，4 张卡正好一行，与大盘看板一致。
 */
export default function HoldingsSummary({ cells, totals, quotes }: HoldingsSummaryProps) {
  const metrics = useMemo<Metric[]>(() => {
    const pnlPct100 = totals.pnlPct * 100
    const todayPct100 =
      totals.todayPnl !== null && totals.marketValue > 0
        ? (totals.todayPnl / totals.marketValue) * 100
        : null
    const be = breakevenOf(totals)

    return [
      {
        key: 'mv',
        label: '持仓市值',
        value: fmtInt(totals.marketValue),
        unit: '元',
        hint: `${totals.count} 只`,
        trend: totals.todayPnl,
        details: [
          {
            label: '今日盈亏',
            text: totals.todayPnl === null ? '—' : `${fmtSigned(totals.todayPnl, 0)} 元`,
            trend: totals.todayPnl,
            title: '按现价相对昨收计算，仅统计有实时报价的持仓',
          },
          { label: '较持仓成本', text: fmtPct(pnlPct100), trend: totals.pnl },
        ],
      },
      {
        key: 'cost',
        label: '持仓成本',
        value: fmtInt(totals.costValue),
        unit: '元',
        // 成本是既成事实，不随盈亏涨跌上色
        trend: null,
        details: [
          {
            label: be.kind === 'recover' ? '回本需涨' : '可回撤',
            // 亏损时带符号（+22.7% 表示还需上涨）；盈利时是「安全垫」，不加正号更自然
            text: be.kind === 'recover' ? fmtPct(be.pct * 100) : `${fmtNum(be.pct * 100, 1)}%`,
            // 中性：需涨/可跌是两个方向的「缺口」，用红绿都会被误读成当日涨跌
            trend: null,
            title:
              be.kind === 'recover'
                ? '（成本 − 市值）/ 市值：现有持仓要回到成本价所需要的涨幅'
                : '组合整体已高于成本，这是回到成本前可承受的回撤幅度',
          },
          {
            label: '亏损 / 盈利',
            text: `${totals.losers} / ${totals.winners} 只`,
          },
        ],
      },
      {
        key: 'pnl',
        label: '浮动盈亏',
        value: fmtSigned(totals.pnl, 0),
        unit: '元',
        trend: totals.pnl,
        details: [
          { label: '盈亏率', text: fmtPct(pnlPct100), trend: totals.pnl },
          {
            label: '最大亏损',
            text: totals.worst ? `${totals.worst.name} ${fmtSigned(totals.worst.pnl, 0)}` : '—',
            trend: totals.worst ? totals.worst.pnl : null,
            title: totals.worst
              ? `${totals.worst.name}（${totals.worst.code}）浮动盈亏 ${fmtInt(totals.worst.pnl)} 元`
              : '当前没有亏损中的持仓',
          },
          {
            label: '最大盈利',
            text: totals.best ? `${totals.best.name} ${fmtSigned(totals.best.pnl, 0)}` : '—',
            trend: totals.best ? totals.best.pnl : null,
            title: totals.best
              ? `${totals.best.name}（${totals.best.code}）浮动盈亏 ${fmtInt(totals.best.pnl)} 元`
              : '当前没有盈利中的持仓',
          },
        ],
      },
      {
        key: 'today',
        label: '今日盈亏',
        value: totals.todayPnl === null ? '—' : fmtSigned(totals.todayPnl, 0),
        unit: '元',
        trend: totals.todayPnl,
        hint: quotes ? quotes.session.label : undefined,
        details: [
          {
            label: '占市值',
            text: fmtPct(todayPct100),
            trend: totals.todayPnl,
          },
          {
            label: '涨 / 跌',
            text: `${cells.filter((c) => (c.chgPct ?? 0) > 0).length} / ${
              cells.filter((c) => (c.chgPct ?? 0) < 0).length
            } 只`,
          },
        ],
      },
    ]
  }, [cells, totals, quotes])

  return (
    <div className="summary-grid">
      {metrics.map((m) => (
        <article className="card summary-card" key={m.key}>
          <div className="summary-card__label">
            {m.label}
            {m.hint ? <span className="summary-card__hint">{m.hint}</span> : null}
          </div>
          <div className={`summary-card__value num ${trendClass(m.trend)}`}>
            <span className="summary-card__number">{m.value}</span>
            {m.unit ? <span className="summary-card__unit">{m.unit}</span> : null}
          </div>
          <dl className="summary-card__details">
            {m.details.map((d) => (
              <div className="summary-card__detail" key={d.label}>
                <dt>{d.label}</dt>
                <dd className={`num ${trendClass(d.trend)}`} title={d.title}>
                  {d.text}
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  )
}
