/**
 * 每日复盘的**骨架**（纯前端，零新增取数）。
 *
 * 分工要说清楚：这个文件只产出「机械可复现」的那部分 —— 档位、判定依据、
 * 支撑读数、企稳条件、观察线。它**不做判断**，也绝不生成任何形容词。
 * 主观的「所以呢」由每日收盘流程里的 agent 写进 `public/review-notes.json`，
 * 前端只在 `as_of` 与这里的 `date` 完全相等时才渲染那一行（见 DailyReviewCard）。
 *
 * 为什么这么切：`data.json` 每天自己更新，文字却要人或模型额外跑一次。
 * 两者一旦错位，页面会出现「今天的数字配昨天的结论」——看起来一切正常，
 * 这是这张卡最坏的失败模式，所以对齐检查放在渲染层，不指望写入端自觉。
 *
 * 三条企稳条件与观察线全部由 data.json 现算，**阈值不硬编码**：
 *   ① 收盘 ≥ 当日 MA20；
 *   ② 两市成交额 ≥ 成交额序列的 250 日 P20（量能回到「不算地量」的下沿）；
 *   ③ 融资余额环比上一有效值转正（去杠杆走完）。
 *   观察线 = 近 20 个有效收盘（不含复盘日）的最低点。
 */
import { column, latestWith, pctChange, prevNonNull } from './calc'
import { fmtNum, isNum } from './format'
import { PERCENTILE_WINDOW, percentileInfo } from './stats'
import { trendStateOf } from './trend'
import type { TrendRead } from './trend'
import type { MarketRow } from './types'

/** 观察线回看的收盘根数（不含复盘日当天）。 */
const WATCH_WINDOW = 20

export interface ReviewCondition {
  /** 带真实阈值的完整句子，卡片直接显示，不再拼数字 */
  text: string
  /** null = 该条件所需读数缺失，不下结论（不计入进度分子） */
  met: boolean | null
  title: string
}

export interface ReviewRead {
  /** 复盘所属交易日 = 沪深300 均线判定成立的那一天（盘中未定稿时即上一交易日） */
  date: string | null
  trend: TrendRead
  /** 两市成交额（亿元）：最新值、250 日 P20、百分位排名、与上一有效值之差 */
  turnover: { value: number | null; p20: number | null; rank: number | null; diff: number | null }
  /** 全市场涨 / 跌家数（快照口径，历史短，缺就是 null） */
  adv: number | null
  dec: number | null
  /** 创 20 日新高 / 新低家数 */
  high20: number | null
  low20: number | null
  /** 杠杆率（融资余额 / 流通市值，%）及其分位 */
  leverage: { value: number | null; rank: number | null }
  /** 融资余额：最新值、环比变动（亿元）、所属交易日（两融 T+1，可能落后复盘日一天） */
  marginRz: { value: number | null; diff: number | null; date: string | null }
  conditions: ReviewCondition[]
  /** 已满足 / 可判定，如 '1/3'；分母排除读数缺失的条件 */
  progress: string
  watch: { text: string; level: number | null; date: string | null; distPct: number | null }
  /** 三要素与成交额齐不齐：不齐则整卡只报「等待定稿」，不摆半条结论 */
  ready: boolean
  /** data.json 里存在比复盘日更晚的行 —— 即今日在盘中，当日 K 线被刻意置空。
   *  此时卡的日期是**上一个定稿日**，必须显式标出来，不能让人以为是今天的复盘。 */
  pending: boolean
  latestDate: string | null
}

/** 尾部 window 个有效值里的最小值及其交易日。 */
function trailingMin(rows: MarketRow[], index: number, window: number): { value: number; date: string } | null {
  let best: { value: number; date: string } | null = null
  let seen = 0
  for (let i = index - 1; i >= 0 && seen < window; i--) {
    const v = rows[i].hs300
    if (!isNum(v)) continue
    seen++
    if (!best || v < best.value) best = { value: v, date: rows[i].date }
  }
  return best
}

export function reviewOf(rows: MarketRow[]): ReviewRead {
  const trend = trendStateOf(rows)

  // 复盘日锚在均线判定成立的那一天；判定不成则退到成交额最新日，仍拿不到就整卡待生成
  const tPoint = latestWith(rows, 'turnover_total')
  const date = trend.date ?? tPoint?.row.date ?? null
  const anchor = date ? rows.findIndex((r) => r.date === date) : -1

  const lev = latestWith(rows, 'margin_rz_ratio')
  const rz = latestWith(rows, 'margin_rz')
  const levInfo = percentileInfo(column(rows, 'margin_rz_ratio'), lev?.value ?? null)
  const tInfo = percentileInfo(column(rows, 'turnover_total'), tPoint?.value ?? null)
  const tPrev = tPoint ? prevNonNull(rows, 'turnover_total', tPoint.index) : null

  const turnover = {
    value: tPoint?.value ?? null,
    p20: tInfo ? tInfo.p20 : null,
    rank: tInfo ? tInfo.rank : null,
    diff: tPoint && tPrev ? tPoint.value - tPrev.value : null,
  }
  const rzPrev = rz ? prevNonNull(rows, 'margin_rz', rz.index) : null
  const marginRz = {
    value: rz?.value ?? null,
    diff: rz && rzPrev ? rz.value - rzPrev.value : null,
    date: rz?.row.date ?? null,
  }

  const conditions: ReviewCondition[] = [
    {
      text: `收盘站上 MA20 ${fmtNum(trend.ma20)}`,
      met: isNum(trend.close) && isNum(trend.ma20) ? trend.close >= trend.ma20 : null,
      title: '与均线的位置关系。注意 MA20 自身在下行，光看这一条会「等着被均线贴上来」，' +
        '所以要和成交额那条同时成立。',
    },
    {
      text: `成交额 ≥ ${PERCENTILE_WINDOW} 日 P20 ${fmtNum(turnover.p20, 1)} 亿`,
      met: isNum(turnover.value) && isNum(turnover.p20) ? turnover.value >= turnover.p20 : null,
      title: `P20 取成交额序列尾部样本的第 20 百分位（随窗口滚动每天重算，不是常量）。` +
        `地量站上均线不算承接。`,
    },
    {
      text: '融资余额环比转正',
      met: isNum(marginRz.diff) ? marginRz.diff > 0 : null,
      title: `去杠杆走完的信号。融资余额 T+1 公布，最新一笔在 ${marginRz.date ?? '—'}，` +
        `可能落后复盘日一个交易日。`,
    },
  ]
  const judged = conditions.filter((c) => c.met !== null)
  const metCount = judged.filter((c) => c.met).length
  const progress = `${metCount}/${judged.length || 0}`

  const low = anchor >= 0 ? trailingMin(rows, anchor, WATCH_WINDOW) : null
  const watch = {
    text: `收盘跌破前低 ${fmtNum(low ? low.value : null)}`,
    level: low ? low.value : null,
    date: low ? low.date : null,
    distPct: isNum(trend.close) && low ? pctChange(low.value, trend.close) : null,
  }

  return {
    date,
    trend,
    turnover,
    adv: latestWith(rows, 'adv_count')?.value ?? null,
    dec: latestWith(rows, 'dec_count')?.value ?? null,
    high20: latestWith(rows, 'breadth_high20')?.value ?? null,
    low20: latestWith(rows, 'breadth_low20')?.value ?? null,
    leverage: { value: lev?.value ?? null, rank: levInfo ? levInfo.rank : null },
    marginRz,
    conditions,
    progress,
    watch,
    ready: trend.state !== null && isNum(turnover.value),
    pending: anchor >= 0 && anchor < rows.length - 1,
    latestDate: rows.length > 0 ? rows[rows.length - 1].date : null,
  }
}
