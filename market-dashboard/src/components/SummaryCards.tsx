import { useMemo } from 'react'
import { column, latestWith, marginTotalOf, pctChange, bpDiff, prevNonNull, valueLookback, valueOf } from '../calc'
import { fmtBp, fmtDateCN, fmtInt, fmtNum, fmtPct, fmtSigned, trendClass, isNum } from '../format'
import { PERCENTILE_WINDOW, percentileInfo } from '../stats'
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
  /** 近 N 个交易日的百分位排名（0~100）；样本不足时 null */
  pctRank?: number | null
  /** 主数值的涨跌方向（红涨绿跌） */
  trend?: number | null
  details: { label: string; text: string; trend?: number | null; title?: string }[]
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
    // 日变动用**金额（亿元）**表达，并给「放量 / 缩量」措辞
    // —— 「−168.4 亿」比「−1.03%」直观：一眼看出量级，百分比会随基数漂移
    const tChangeAmt = (() => {
      const cur = turnover.cur?.value
      return isNum(cur) && isNum(tPrev?.value) ? cur - tPrev.value : null
    })()
    const tChangeText = (() => {
      if (!isNum(tChangeAmt)) return '—'
      if (Math.abs(tChangeAmt) < 0.5) return '持平'
      return `${tChangeAmt > 0 ? '放量' : '缩量'} ${fmtSigned(tChangeAmt, 1)}亿`
    })()

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
        trend: tChangeAmt,
        pctRank: percentileInfo(column(rows, 'turnover_total'), turnover.cur?.value ?? null)?.rank ?? null,
        details: [
          { label: '日变动', text: tChangeText, trend: tChangeAmt, title: '与上一交易日全天成交额之差（交易所官方口径）' },
          {
            label: '较前值',
            text: tPrev ? `${fmtInt(tPrev.value)} 亿元（${fmtPct(turnover.diff)}）` : '—',
          },
          {
            label: '沪 / 深',
            text: `${fmtInt(valueOf(tRow, 'turnover_sh'))} / ${fmtInt(valueOf(tRow, 'turnover_sz'))}`,
          },
        ],
      },
      {
        key: 'margin',
        label: '两融余额',
        value: fmtInt(mCur),
        unit: '亿元',
        trend: pctChange(mCur, mPrev),
        pctRank: percentileInfo(column(rows, 'margin_total'), mCur)?.rank ?? null,
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
      {
        key: 'us10y',
        label: '10Y 美债',
        value: fmtNum(us?.value, 2),
        unit: '%',
        trend: usDiffBp,
        hint: us ? us.row.date : undefined,
        pctRank: percentileInfo(column(rows, 'us10y'), us?.value ?? null)?.rank ?? null,
        details: [
          { label: '日变动', text: fmtBp(usDiffBp), trend: usDiffBp },
          { label: '中美利差', text: isNum(spread) ? `${fmtNum(spread, 0)}bp` : '—', trend: spread },
          { label: '10Y 中债', text: isNum(cnAtUs) ? `${fmtNum(cnAtUs, 2)}%` : '—' },
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
            <span className="summary-card__label-right">
              {typeof m.pctRank === 'number' ? (
                <span
                  className="summary-card__pct"
                  title={`近 ${PERCENTILE_WINDOW} 个交易日的百分位排名：历史上有 ${m.pctRank.toFixed(0)}% 的交易日读数不高于它`}
                >
                  {m.pctRank.toFixed(0)}% 分位
                </span>
              ) : null}
              {m.hint ? <span className="summary-card__hint">{m.hint}</span> : null}
            </span>
          </div>
          <div className={`summary-card__value num ${trendClass(m.trend)}`}>
            <span className="summary-card__number">{m.value}</span>
            {m.unit ? <span className="summary-card__unit">{m.unit}</span> : null}
          </div>
          <dl className="summary-card__details">
            {m.details.map((d) => (
              <div className="summary-card__detail" key={d.label}>
                <dt>{d.label}</dt>
                <dd className={`num ${trendClass(d.trend)}`} title={d.title}>{d.text}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  )
}
