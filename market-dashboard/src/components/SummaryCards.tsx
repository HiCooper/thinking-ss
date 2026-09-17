import { useMemo } from 'react'
import {
  bpDiff,
  column,
  latestWith,
  marginTotalOf,
  movingAverage,
  pctChange,
  prevNonNull,
  valueLookback,
  valueOf,
} from '../calc'
import { fmtBp, fmtInt, fmtNum, fmtPct, fmtSigned, trendClass, isNum } from '../format'
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

    // —— 科创50：指数自身的位置 ——
    // 另外三张卡（成交额 / 两融 / 10Y 美债）全是「环境读数」：量够不够、杠杆在不在加、
    // 海外利率压不压估值。没有一张回答「指数现在站在哪里」—— 而「追还是等」恰恰取决于位置。
    // 底部那条固定指数条只给当日快照，不给历史位置，所以这个位置感只能由摘要卡补。
    const star = latestWith(rows, 'star50')
    const starCol = column(rows, 'star50')
    const starPrev = star ? prevNonNull(rows, 'star50', star.index) : null
    const starChg = star ? pctChange(star.value, starPrev ? starPrev.value : null) : null
    // MA20 用整列算（movingAverage 自带窗口首部补 null），取最新有效那一行的值
    const starMa20 = star ? movingAverage(starCol, 20)[star.index] : null
    const starVsMa = isNum(star?.value) && isNum(starMa20) ? (star.value / starMa20 - 1) * 100 : null
    // 区间高/低只统计到「最新有效那一行」为止 —— 末行可能是 null（当日未定稿）
    const starWindow = star ? starCol.slice(0, star.index + 1).filter((v): v is number => isNum(v)) : []
    const starHi = starWindow.length > 0 ? Math.max(...starWindow) : null
    const starLo = starWindow.length > 0 ? Math.min(...starWindow) : null
    const starVsHi = isNum(star?.value) && isNum(starHi) ? (star.value / starHi - 1) * 100 : null
    const starVsLo = isNum(star?.value) && isNum(starLo) ? (star.value / starLo - 1) * 100 : null

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
        // 「最新交易日」原来占第一格，但它和小字说明 / 板块标题里的日期完全重复，已撤掉：
        // 日期改由各卡自己的 hint 承担（KOSPI/科创50 的末行可能是 null，hint 才真正必要）。
        key: 'star50',
        label: '科创50',
        value: fmtNum(star?.value, 2),
        unit: '点',
        trend: starChg,
        hint: star ? star.row.date : undefined,
        pctRank: percentileInfo(starCol, star?.value ?? null)?.rank ?? null,
        details: [
          { label: '日变动', text: fmtPct(starChg), trend: starChg },
          {
            label: '较 20 日均线',
            text: isNum(starVsMa) ? `${fmtPct(starVsMa)}（MA20 ${fmtNum(starMa20, 2)}）` : '—',
            trend: starVsMa,
            title: '指数自身的技术位：站上/跌破 20 日均线是短期趋势最常用的一条分界',
          },
          {
            label: '距区间高 / 低',
            text: `${fmtPct(starVsHi)} / ${fmtPct(starVsLo)}`,
            title:
              isNum(starHi) && isNum(starLo)
                ? `窗口内近 ${starWindow.length} 个交易日收盘区间 ${fmtNum(starLo, 2)} ~ ${fmtNum(starHi, 2)}`
                : '窗口内区间不可用',
          },
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
