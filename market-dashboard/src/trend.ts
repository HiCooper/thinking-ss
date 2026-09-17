/**
 * 指数趋势判定（纯前端，零新增取数）。
 *
 * 这是「环境识别」在页面上的落点：把价格与 MA20/MA60 的相对位置、均线的斜率
 * 归纳成一个三态结论（多头 / 震荡 / 空头）。**摘要卡与图 1 共用这一份逻辑**，
 * 卡上的结论和图上画的线永远一致，不会出现两处口径漂移。
 *
 * 判定规则（刻意保持简单可解释，规则本身属于 ARK「环境识别」的 UI 层，不是策略层）：
 *   多头 = 收盘站上 MA20，且 MA20 在 MA60 上方，且 MA20 斜率向上；
 *   空头 = 三个条件全部反向；
 *   其余 = 震荡（包括「站上 MA20 但均线未多头排列」这类过渡形态）。
 */
import { column, movingAverage, pctChange } from './calc'
import { isNum } from './format'
import type { MarketRow } from './types'

export type TrendState = '多头' | '震荡' | '空头'

export interface TrendRead {
  /** 最新收盘价 */
  close: number | null
  ma20: number | null
  ma60: number | null
  /** 收盘相对均线的偏离（%，正 = 在均线上方） */
  dev20: number | null
  dev60: number | null
  /** MA20 的 20 日斜率（%）—— 均线自身的方向 */
  slope: number | null
  /** 收盘价 20 日涨跌幅（%）—— 动量读数 */
  chg20: number | null
  /** 三态结论；三要素任一缺失时为 null（样本不足不下结论） */
  state: TrendState | null
  /** state 的数值化：多头 +1 / 震荡 0 / 空头 −1，供 trendClass 上色 */
  trend: 1 | 0 | -1 | null
  /** 判定依据（一句话，tooltip 用） */
  basis: string
  /** 判定所用收盘价的交易日 */
  date: string | null
}

/** 从 i 往回找 ma 序列最近的一个非空值，最多回看 `maxBack` 个交易日。 */
function maAt(ma: (number | null)[], i: number, maxBack = 10): number | null {
  for (let k = i; k >= 0 && k >= i - maxBack; k--) {
    const v = ma[k]
    if (isNum(v)) return v
  }
  return null
}

export function trendStateOf(rows: MarketRow[]): TrendRead {
  const closes = column(rows, 'hs300')
  const ma20 = movingAverage(closes, 20)
  const ma60 = movingAverage(closes, 60)

  // 取「收盘 + 两条均线都有效」的最近一行 —— 少任何一个都不构成完整判定
  let idx = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isNum(closes[i]) && isNum(ma20[i]) && isNum(ma60[i])) {
      idx = i
      break
    }
  }

  const empty: TrendRead = {
    close: null, ma20: null, ma60: null, dev20: null, dev60: null,
    slope: null, chg20: null, state: null, trend: null,
    basis: '沪深300 数据不足 60 个交易日，均线尚未成型，暂不下结论',
    date: null,
  }
  if (idx < 0) return empty

  const close = closes[idx] as number
  const m20 = ma20[idx] as number
  const m60 = ma60[idx] as number
  const date = rows[idx].date

  const dev = (ma: number | null): number | null =>
    isNum(ma) && ma !== 0 ? (close - ma) / ma * 100 : null

  // 斜率：MA20 与 20 个交易日前比。均线值理论上逐日连续，直接按索引偏移取；
  // 万一取到 null（数据缺口），回看最多 10 天兜底。
  const m20Past = maAt(ma20, idx - 20)
  const slope = isNum(m20Past) ? pctChange(m20, m20Past) : null

  const chg20 = pctChange(close, maAt(closes, idx - 20, 10))

  const above20 = close >= m20
  const stacked = m20 >= m60
  const slopeUp = isNum(slope) ? slope > 0 : null

  let state: TrendState | null = '震荡'
  let trend: 1 | 0 | -1 | null = 0
  if (slopeUp === null) {
    // 均线斜率算不出来（历史太短）—— 只能比较位置，不给方向性结论
    state = null
    trend = null
  } else if (above20 && stacked && slopeUp) {
    state = '多头'
    trend = 1
  } else if (!above20 && !stacked && !slopeUp) {
    state = '空头'
    trend = -1
  }

  const fmt = (v: number | null) => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '—')
  const basis =
    `收盘${above20 ? '站上' : '跌破'} MA20（${fmt(dev(m20))}）；` +
    `MA20 ${stacked ? '在 MA60 上方' : '在 MA60 下方'}；` +
    `MA20 斜率 20 日 ${fmt(slope)}` +
    (state ? ` → ${state}` : '（斜率缺失，仅列位置）')

  return {
    close, ma20: m20, ma60: m60,
    dev20: dev(m20), dev60: dev(m60),
    slope, chg20, state, trend, basis, date,
  }
}
