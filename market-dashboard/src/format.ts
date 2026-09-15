/** 数字 / 日期的展示格式化。全部走「空值安全」：null → 「—」。 */

const EMPTY = '—'

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 千分位数字。 */
export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return EMPTY
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtInt(v: number | null | undefined): string {
  return fmtNum(v, 0)
}

/** 带符号数字（+1.23 / -1.23 / 0.00）。 */
export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return EMPTY
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  return sign + fmtNum(Math.abs(v), digits)
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return EMPTY
  return `${fmtSigned(v, digits)}%`
}

/** 收益率变动用 bp 表示：1 个百分点 = 100bp。 */
export function fmtBp(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return EMPTY
  return `${fmtSigned(v, digits)}bp`
}

/** 亿元坐标轴刻度：上万自动折成「万亿」，避免轴标签过长。 */
export function fmtAxisYi(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 10000) return `${(v / 10000).toFixed(2)}万亿`
  if (abs >= 1000) return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  return v.toFixed(1)
}

/** A 股习惯：红涨绿跌。 */
export type Trend = 'up' | 'down' | 'flat'

export function trendOf(v: number | null | undefined): Trend {
  if (!isNum(v) || v === 0) return 'flat'
  return v > 0 ? 'up' : 'down'
}

export function trendClass(v: number | null | undefined): string {
  return `trend-${trendOf(v)}`
}

/** 日期 → 「2025-09-16 周二」；解析失败原样返回。 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export function fmtDateCN(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return date
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return date
  return `${m[1]}-${m[2]}-${m[3]} ${WEEKDAYS[d.getUTCDay()]}`
}
