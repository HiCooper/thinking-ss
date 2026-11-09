import type { IntradaySeries } from './types'

/**
 * 盘中分时的共享横轴：09:30–11:30、13:00–15:00（各 121 个分钟点）。
 * 不按已到达的点数伸缩，否则盘中每过一分钟整条线就重新铺满一次宽度，读不出「走了多少」。
 *
 * 价格栏与成交额栏是同一个 ECharts 实例的两个 grid，但都按这份刻度铺数据，
 * 保证同一分钟落在同一个像素上。
 */
export const SESSION_MINUTES: string[] = (() => {
  const out: string[] = []
  const push = (from: number, to: number): void => {
    for (let m = from; m <= to; m++) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0')
      const mm = String(m % 60).padStart(2, '0')
      out.push(`${hh}:${mm}`)
    }
  }
  push(9 * 60 + 30, 11 * 60 + 30)
  push(13 * 60, 15 * 60)
  return out
})()

/** 只给这几个整点边界打刻度，242 个分钟标签会糊成一片。 */
export const LABEL_TIMES = new Set(['09:30', '10:30', '11:30', '14:00', '15:00'])

/** 取「1 / 2 / 2.5 / 5 × 10ⁿ」中不小于 raw 的最小步长 —— 刻度落在整点上，不出现 4 位小数。 */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const exp = Math.floor(Math.log10(raw))
  const pow = 10 ** exp
  const f = raw / pow
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * pow
}

/** 成交额展示单位：元 → 亿元。日累计量级在千亿，用元会多出 4 位无效数字。 */
export const YI = 1e8

export interface TurnoverSummary {
  /** 当日最后一点的累计成交额（亿元） */
  now: number | null
  /** 上一交易日同时刻的累计成交额（亿元） */
  prev: number | null
  /** 同比（%） */
  yoy: number | null
  /** 「11-03 同期」——基准日不一定是昨天，所以带上日期 */
  prevLabel: string
}

/** 分时卡片上的成交额读数（与图内成交额栏同一套截断口径：都截到当日最后一点）。 */
export function turnoverSummary(series: IntradaySeries): TurnoverSummary {
  let last: { t: string; amt: number } | null = null
  for (const p of series.points) {
    if (p.amt !== null) last = { t: p.t, amt: p.amt }
  }
  const prevSame = last ? (series.prev_amt.find((p) => p.t === last!.t)?.v ?? null) : null
  const yoy = last !== null && prevSame !== null && prevSame > 0 ? (last.amt / prevSame - 1) * 100 : null
  return {
    now: last === null ? null : last.amt / YI,
    prev: prevSame === null ? null : prevSame / YI,
    yoy,
    prevLabel: series.prev_amt_date ? `${series.prev_amt_date.slice(5)} 同期` : '上日同期',
  }
}
