/**
 * 账户级日收益记录（`holdings-history.json`）的解析与取数。
 *
 * 三个数据文件的分工：
 *   - `holdings.md`          —— 份额/成本，**人工维护**（本地，不入库）
 *   - `holdings.json`        —— 上者导出的看板输入（本地，不入库）
 *   - `holdings-history.json`—— **每天收盘后**由 `scripts/record_holdings_snapshot.py`
 *                              追加一笔**账户汇总**（本地，不入库）
 *
 * 关键设计：这份序列**只记录、不回填**。账户真实盈亏无法从当前持仓反推
 * （份额是分批买入的，用今天的份额套过去的价格只会得到一条不存在的曲线），
 * 所以它从「开始记录那天」起才有值。文件不存在是**正常状态**，不是错误。
 */

/** 一个交易日的账户汇总。全部是账户级数字，不含逐只明细。 */
export interface PnlDay {
  date: string
  /** 当日收盘市值（Σ 份额 × 收盘价） */
  market_value: number
  /** 持仓成本（Σ 份额 × 成本价） */
  cost: number
  /** 浮动盈亏 = market_value − cost */
  pnl: number
  /** 浮动盈亏率（小数，−0.18 = −18%） */
  pnl_pct: number
  /** 当日盈亏（相对各自前一根收盘价）；缺前值时 null */
  day_pnl: number | null
  /** 当日盈亏率（小数，相对前一日市值） */
  day_pnl_pct: number | null
  /** 用于计算当日盈亏的前一交易日 */
  prev_date: string | null
}

export interface HoldingsHistory {
  generated_at: string
  source: string
  note: string
  days: PnlDay[]
}

function objOf(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v !== '' ? v : fallback
}

function parseDay(raw: unknown): PnlDay | null {
  const o = objOf(raw)
  if (!o) return null
  const date = str(o.date)
  const marketValue = num(o.market_value)
  const cost = num(o.cost)
  // 日期与市值是硬要求；其余可缺，缺了图表跳过但不报错
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || marketValue === null || cost === null) return null
  const pnl = num(o.pnl) ?? marketValue - cost
  return {
    date,
    market_value: marketValue,
    cost,
    pnl,
    pnl_pct: num(o.pnl_pct) ?? (cost > 0 ? pnl / cost : 0),
    day_pnl: num(o.day_pnl),
    day_pnl_pct: num(o.day_pnl_pct),
    prev_date: typeof o.prev_date === 'string' ? o.prev_date : null,
  }
}

export function parseHoldingsHistory(raw: unknown): HoldingsHistory {
  const o = objOf(raw) ?? {}
  const days = (Array.isArray(o.days) ? o.days : [])
    .map(parseDay)
    .filter((d): d is PnlDay => d !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  return {
    generated_at: str(o.generated_at, '—'),
    source: str(o.source, '—'),
    note: str(o.note, ''),
    days,
  }
}

/**
 * 读取日收益记录。**返回 `null` 表示「还没有历史」**（文件不存在 / 静态部署下 404 /
 * Vite dev 回退到 index.html / 内容不合法），由调用方渲染「开始累积」的引导，
 * 而不是当成错误。
 */
export async function fetchHoldingsHistory(signal?: AbortSignal): Promise<HoldingsHistory | null> {
  let res: Response
  try {
    res = await fetch('holdings-history.json', { signal, cache: 'no-store' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return null
  }
  if (!res.ok) return null

  // 与 fetchHoldings 同样的坑：Vite dev/preview 对不存在的路径会回退 index.html 并返回 200，
  // 于是「文件不存在」伪装成「JSON 解析失败」。按 content-type 识别。
  if (!(res.headers.get('content-type') ?? '').includes('json')) return null

  try {
    return parseHoldingsHistory(await res.json())
  } catch {
    return null
  }
}

/**
 * 能看出「趋势」所需的最少天数。
 *
 * 注意这**不是**画图门槛：1 个点也会照画（画出来是一个点），
 * 只是那时谈不上趋势，图下会补一句说明。0 个点才渲染引导。
 */
export const TREND_MEANINGFUL_DAYS = 2
