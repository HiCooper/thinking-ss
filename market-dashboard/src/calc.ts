import { isNum } from './format'
import type { MarketRow, NumericKey } from './types'

/** 取某行某字段的数值，非有限值一律视为 null。 */
export function valueOf(row: MarketRow | undefined | null, key: NumericKey): number | null {
  if (!row) return null
  const v = row[key]
  return isNum(v) ? v : null
}

/** 抽取某字段的整列（保留 null 占位，保证与日期一一对应）。 */
export function column(rows: MarketRow[], key: NumericKey): (number | null)[] {
  return rows.map((r) => valueOf(r, key))
}

/**
 * 滑动平均。null 直接跳过（不参与求和、也不占窗口），
 * 只有当已累积到 `window` 个有效值时才输出结果，之前的点位为 null
 * —— 与行情终端里「20 日均线从第 20 个有效交易日起画」的惯例一致。
 */
export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (window <= 0) return out

  const buf: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (isNum(v)) buf.push(v)
    if (buf.length >= window) {
      let sum = 0
      for (let k = buf.length - window; k < buf.length; k++) sum += buf[k]
      out[i] = sum / window
    }
  }
  return out
}

export interface Point {
  index: number
  row: MarketRow
  value: number
}

/** 最后一个非空值（摘要卡取数用）。 */
export function latestWith(rows: MarketRow[], key: NumericKey): Point | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = valueOf(rows[i], key)
    if (isNum(value)) return { index: i, row: rows[i], value }
  }
  return null
}

/** index 之前（不含 index）最近的一个非空值。 */
export function prevNonNull(rows: MarketRow[], key: NumericKey, index: number): Point | null {
  for (let i = Math.min(index, rows.length) - 1; i >= 0; i--) {
    const value = valueOf(rows[i], key)
    if (isNum(value)) return { index: i, row: rows[i], value }
  }
  return null
}

/**
 * 从 index - lookback 处往回找最近的非空值，用于「20 日变动」这类区间比较。
 * 样本不足时返回 null（卡片上显示「—」而不是算出一个错误数字）。
 */
export function valueLookback(
  rows: MarketRow[],
  key: NumericKey,
  index: number,
  lookback: number,
): Point | null {
  const start = index - lookback
  if (start < 0) return null
  return prevNonNull(rows, key, start + 1)
}

/** 环比百分比变动。基准值缺失或为 0 时返回 null。 */
export function pctChange(cur: number | null, base: number | null): number | null {
  if (!isNum(cur) || !isNum(base) || base === 0) return null
  return ((cur - base) / Math.abs(base)) * 100
}

/** 收益率差值：% → bp。 */
export function bpDiff(cur: number | null, base: number | null): number | null {
  if (!isNum(cur) || !isNum(base)) return null
  return (cur - base) * 100
}

/** 美中利差（bp）= (美10Y - 中10Y) × 100。 */
export function spreadBp(us10y: number | null, cn10y: number | null): number | null {
  return bpDiff(us10y, cn10y)
}

/** 两融余额：优先用后端给的合计，缺失时用融资 + 融券兜底。 */
export function marginTotalOf(row: MarketRow | undefined): number | null {
  if (!row) return null
  const total = valueOf(row, 'margin_total')
  if (isNum(total)) return total
  const rz = valueOf(row, 'margin_rz')
  const rq = valueOf(row, 'margin_rq')
  if (!isNum(rz) && !isNum(rq)) return null
  return (isNum(rz) ? rz : 0) + (isNum(rq) ? rq : 0)
}
