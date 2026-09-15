import { useMemo } from 'react'
import { latestWith, marginTotalOf, pctChange, bpDiff, prevNonNull, valueLookback, valueOf } from '../calc'
import { fmtBp, fmtDateCN, fmtInt, fmtNum, fmtPct, trendClass, isNum } from '../format'
import type { MarketRow } from '../types'

interface SummaryCardsProps {
  rows: MarketRow[]
}

interface Metric {
  key: string
  label: string
  value: string
  unit: string
  hint?: string
  /** 主数值的涨跌方向（红涨绿跌） */
  trend?: number | null
  details: { label: string; text: string; trend?: number | null }[]
}

const dayChangePct = (rows: MarketRow[], key: Parameters<typeof latestWith>[1]) => {
  const cur = latestWith(rows, key)
  if (!cur) return { cur: null, diff: null as number | null }
  const prev = prevNonNull(rows, key, cur.index)
  return { cur, diff: pctChange(cur.value, prev ? prev.value : null) }
}

export default function SummaryCards({ rows }: SummaryCardsProps) {
  const metrics = useMemo<Metric[]>(() => {
    const last = rows.length > 0 ? rows[rows.length - 1] : null
    const lastDate = last ? last.date : '—'

    // —— 成交额 ——
    const turnover = dayChangePct(rows, 'turnover_total')
    const tRow = turnover.cur?.row
    const tIndex = turnover.cur?.index ?? rows.length - 1
    const tPrev = prevNonNull(rows, 'turnover_total', tIndex)

    // —— 10Y 美债 ——
    const us = latestWith(rows, 'us10y')
    const usPrev = us ? prevNonNull(rows, 'us10y', us.index) : null
    const usDiffBp = us ? bpDiff(us.value, usPrev ? usPrev.value : null) : null
    const cnAtUs = us ? valueOf(us.row, 'cn10y') : null
    const spread = isNum(us?.value) && isNum(cnAtUs) ? (us.value - cnAtUs) * 100 : null

    // —— 两融余额 ——
    const margin = latestWith(rows, 'margin_total')
    const mIndex = margin ? margin.index : rows.length - 1
    const mCur = margin ? margin.value : marginTotalOf(last ?? undefined)
    const mPrev = (() => {
      for (let i = mIndex - 1; i >= 0; i--) {
        const v = marginTotalOf(rows[i])
        if (isNum(v)) return v
      }
      return null
    })()
    const mLookbackPoint = valueLookback(rows, 'margin_total', mIndex, 20)
    const mBase20 = mLookbackPoint ? mLookbackPoint.value : null
    // 用「两融最新有效那一行」而不是最后一行：最后一行两融字段可能还是 null
    const mRow = margin ? margin.row : last
    const rz = valueOf(mRow, 'margin_rz')
    const rq = valueOf(mRow, 'margin_rq')

    return [
      {
        key: 'date',
        label: '最新交易日',
        value: lastDate === '—' ? '—' : fmtDateCN(lastDate).slice(0, 10),
        unit: lastDate === '—' ? '' : fmtDateCN(lastDate).slice(11),
        hint: `${rows.length} 个交易日`,
        details: [
          { label: '区间', text: rows.length > 1 ? `${rows[0].date} ~ ${lastDate}` : lastDate },
        ],
      },
      {
        key: 'turnover',
        label: '两市成交额',
        value: fmtInt(turnover.cur?.value),
        unit: '亿元',
        trend: turnover.diff,
        details: [
          { label: '日变动', text: fmtPct(turnover.diff), trend: turnover.diff },
          { label: '较前值', text: tPrev ? `${fmtInt(tPrev.value)} 亿元` : '—' },
          {
            label: '沪 / 深',
            text: `${fmtInt(valueOf(tRow, 'turnover_sh'))} / ${fmtInt(valueOf(tRow, 'turnover_sz'))}`,
          },
        ],
      },
      {
        key: 'us10y',
        label: '10Y 美债',
        value: fmtNum(us?.value, 2),
        unit: '%',
        trend: usDiffBp,
        hint: us ? us.row.date : undefined,
        details: [
          { label: '日变动', text: fmtBp(usDiffBp), trend: usDiffBp },
          { label: '中美利差', text: isNum(spread) ? `${fmtNum(spread, 0)}bp` : '—', trend: spread },
          { label: '10Y 中债', text: isNum(cnAtUs) ? `${fmtNum(cnAtUs, 2)}%` : '—' },
        ],
      },
      {
        key: 'margin',
        label: '两融余额',
        value: fmtInt(mCur),
        unit: '亿元',
        trend: pctChange(mCur, mPrev),
        details: [
          { label: '日变动', text: fmtPct(pctChange(mCur, mPrev)), trend: pctChange(mCur, mPrev) },
          {
            label: '20 日变动',
            text: fmtPct(pctChange(mCur, mBase20)),
            trend: pctChange(mCur, mBase20),
          },
          { label: '融资 / 融券', text: `${fmtInt(rz)} / ${fmtInt(rq)}` },
        ],
      },
    ]
  }, [rows])

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
                <dd className={`num ${trendClass(d.trend)}`}>{d.text}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  )
}
