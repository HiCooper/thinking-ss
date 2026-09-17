/**
 * 持仓看板的数据层。
 *
 * 两个数据来源，职责分离：
 *   1. `holdings.json`（静态，由 scripts/export_holdings.py 从 holdings.md 生成）
 *      —— 权威的**份额与成本**，永远可用（静态托管也有）。
 *   2. `/api/holdings`（本地实时接口，Vite 插件代理新浪行情）
 *      —— **现价**，只在 dev / preview 下存在；不可用时整块降级为快照价。
 *
 * 因此本看板在静态托管下依然完整可读，只是价格标注为「快照」而非「实时」。
 */
import { isNum } from './format'

/* ------------------------------ 静态快照契约 ------------------------------ */

export interface HoldingRow {
  name: string
  code: string
  group: string
  shares: number
  cost: number
  /** 快照时点现价：仅在拿不到实时报价时用于降级渲染 */
  snapshot_price: number
}

export interface HoldingGroupMeta {
  id: string
  name: string
  count: number
  market_value: number
  pnl: number
  weight: number
  pnl_share: number
}

export interface HoldingsTotals {
  count: number
  market_value: number
  cost: number
  pnl: number
  pnl_pct: number
}

export interface HoldingsFile {
  generated_at: string
  as_of: string
  account: string
  source: string
  note: string
  totals: HoldingsTotals
  groups: HoldingGroupMeta[]
  rows: HoldingRow[]
}

/** `holdings.json` 不存在（404）时抛出，与「真的出错了」区分开。 */
export class HoldingsMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HoldingsMissingError'
  }
}

/* ------------------------------ 实时报价契约 ------------------------------ */

export interface HoldingQuote {
  code: string
  symbol: string
  name: string | null
  price: number | null
  prev_close: number | null
  open: number | null
  high: number | null
  low: number | null
  chg_pct: number | null
  amount: number | null
  /** 行情自带的最近交易日（YYYY-MM-DD）；非交易日停在上一个交易日 */
  quote_date: string | null
}

export interface HoldingQuotesFile {
  ts: string
  session: { state: string; label: string }
  quotes: HoldingQuote[]
  errors: string[]
}

/* ------------------------------ 解析（外部输入一律当不可信） ------------------------------ */

function objOf(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v !== '' ? v : fallback
}

/** 宽松取数：字符串数字也接受（JSON 里偶有引号包裹）。非有限数一律 null。 */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parseRow(raw: unknown): HoldingRow | null {
  const o = objOf(raw)
  if (!o) return null
  const code = str(o.code)
  if (!/^\d{6}$/.test(code)) return null
  const shares = toNum(o.shares)
  const cost = toNum(o.cost)
  if (!isNum(shares) || shares <= 0 || !isNum(cost) || cost <= 0) return null
  return {
    name: str(o.name, code),
    code,
    group: str(o.group, '?'),
    shares,
    cost,
    snapshot_price: toNum(o.snapshot_price) ?? cost,
  }
}

function parseGroupMeta(raw: unknown): HoldingGroupMeta | null {
  const o = objOf(raw)
  if (!o) return null
  const id = str(o.id)
  if (id === '') return null
  return {
    id,
    name: str(o.name, id),
    count: toNum(o.count) ?? 0,
    market_value: toNum(o.market_value) ?? 0,
    pnl: toNum(o.pnl) ?? 0,
    weight: toNum(o.weight) ?? 0,
    pnl_share: toNum(o.pnl_share) ?? 0,
  }
}

export function parseHoldings(raw: unknown): HoldingsFile {
  const o = objOf(raw)
  if (!o) throw new Error('holdings.json 顶层不是对象')
  const rows = (Array.isArray(o.rows) ? o.rows : [])
    .map(parseRow)
    .filter((r): r is HoldingRow => r !== null)
  if (rows.length === 0) throw new Error('holdings.json 里没有合法的持仓行（需要 code/shares/cost）')
  const totalsRaw = objOf(o.totals) ?? {}
  const groups = (Array.isArray(o.groups) ? o.groups : [])
    .map(parseGroupMeta)
    .filter((g): g is HoldingGroupMeta => g !== null)
  return {
    generated_at: str(o.generated_at, '—'),
    as_of: str(o.as_of, '—'),
    account: str(o.account, '—'),
    source: str(o.source, '—'),
    note: str(o.note, ''),
    totals: {
      count: toNum(totalsRaw.count) ?? rows.length,
      market_value: toNum(totalsRaw.market_value) ?? 0,
      cost: toNum(totalsRaw.cost) ?? 0,
      pnl: toNum(totalsRaw.pnl) ?? 0,
      pnl_pct: toNum(totalsRaw.pnl_pct) ?? 0,
    },
    groups,
    rows,
  }
}

function parseQuote(raw: unknown): HoldingQuote | null {
  const o = objOf(raw)
  if (!o) return null
  const code = str(o.code)
  if (code === '') return null
  return {
    code,
    symbol: str(o.symbol),
    name: typeof o.name === 'string' ? o.name : null,
    price: toNum(o.price),
    prev_close: toNum(o.prev_close),
    open: toNum(o.open),
    high: toNum(o.high),
    low: toNum(o.low),
    chg_pct: toNum(o.chg_pct),
    amount: toNum(o.amount),
    quote_date: /^\d{4}-\d{2}-\d{2}$/.test(str(o.quote_date)) ? str(o.quote_date) : null,
  }
}

function parseQuotes(raw: unknown): HoldingQuotesFile {
  const o = objOf(raw) ?? {}
  const sessionRaw = objOf(o.session) ?? {}
  return {
    ts: str(o.ts, '—'),
    session: { state: str(sessionRaw.state, 'closed'), label: str(sessionRaw.label, '—') },
    quotes: (Array.isArray(o.quotes) ? o.quotes : [])
      .map(parseQuote)
      .filter((q): q is HoldingQuote => q !== null),
    errors: Array.isArray(o.errors) ? o.errors.filter((e): e is string => typeof e === 'string') : [],
  }
}

/* ------------------------------ 取数 ------------------------------ */

export async function fetchHoldings(signal?: AbortSignal): Promise<HoldingsFile> {
  let res: Response
  try {
    res = await fetch('holdings.json', { signal, cache: 'no-store' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error('无法读取 holdings.json（网络错误）')
  }
  if (res.status === 404) {
    throw new HoldingsMissingError('未找到 holdings.json（HTTP 404）')
  }
  if (!res.ok) throw new Error(`holdings.json 返回 HTTP ${res.status} ${res.statusText}`)

  // 「文件不存在」在两种服务器上表现不同，要归一成同一种状态：
  //   - 纯静态服务器 → 404（上面已处理）
  //   - Vite dev / preview → **回退到 index.html 并返回 200**，于是会伪装成「JSON 解析失败」
  // 靠 content-type 识别后者。否则 clone 下来（没有 holdings.json）看到的是「加载失败」，
  // 而不是「暂无持仓数据 + 怎么创建」的指引 —— 那才是正确且可操作的状态。
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    throw new HoldingsMissingError('未找到 holdings.json（返回的是 HTML，文件尚未生成）')
  }

  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    throw new Error('holdings.json 不是合法 JSON')
  }
  return parseHoldings(raw)
}

/**
 * 实时报价。返回 `null` 表示**接口不可用**（静态部署 / 网络问题），
 * 与「接口可用但没有报价」是两件事：前者静默降级到快照价，后者会在面板上提示。
 */
export async function fetchHoldingQuotes(signal?: AbortSignal): Promise<HoldingQuotesFile | null> {
  let res: Response
  try {
    res = await fetch('/api/holdings', { signal, cache: 'no-store' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return null
  }
  if (!res.ok) return null
  try {
    return parseQuotes(await res.json())
  } catch {
    return null
  }
}

/* ------------------------------ 逐只计算 ------------------------------ */

/**
 * 生效价来源（按优先级）：
 * - `live` —— 实时报价（现价 > 0）；
 * - `prevclose` —— **用昨收当现价**：盘前（开盘前行情源把现价返回 0）或该只停牌。
 *   此时「今日涨跌 / 今日盈亏」按定义为 0，市值等于昨收市值 ——
 *   还没开盘就说「今天赚了 X 元」是错的。昨收是权威且最新的收盘价。
 * - `snapshot` —— 兜底：接口整体拿不到（静态部署 / 网络失败），连昨收都没有，
 *   只能用 `holdings.md` 里那次导出的快照价。
 */
export type PriceSource = 'live' | 'prevclose' | 'snapshot'

export interface HoldingCell extends HoldingRow {
  groupName: string
  /** 生效现价（实时 → 昨收 → 快照价） */
  price: number
  priceSource: PriceSource
  /** 当日涨跌幅 %（实时报价有；按昨收计价时为 0） */
  chgPct: number | null
  /** 当日成交额（亿元，只有实时报价才有） */
  amount: number | null
  /** 市值 = 份额 × 生效现价 */
  marketValue: number
  /** 成本额 = 份额 × 成本价 */
  costValue: number
  /** 浮动盈亏（负数＝浮亏） */
  pnl: number
  /** 浮动盈亏率（-0.1 = -10%） */
  pnlPct: number
  /** 今日盈亏（相对昨收；拿不到昨收时为 null） */
  todayPnl: number | null
  /** 回本所需涨幅（0.2 = 还需涨 20%） */
  breakevenPct: number
}

export function buildCells(file: HoldingsFile, quotes: HoldingQuotesFile | null): HoldingCell[] {
  const groupNames = new Map(file.groups.map((g) => [g.id, g.name]))
  const byCode = new Map<string, HoldingQuote>()
  for (const q of quotes?.quotes ?? []) byCode.set(q.code, q)

  return file.rows.map((row) => {
    const q = byCode.get(row.code)
    const livePrice = q && isNum(q.price) && q.price > 0 ? q.price : null
    const prevClose = q && isNum(q.prev_close) && q.prev_close > 0 ? q.prev_close : null
    /**
     * 没有实时价时**优先用昨收**，而不是回退到 `holdings.md` 的快照价。
     *
     * 快照价是「用户上次导出持仓时的价」，可能已隔一天以上（如 9-16 12:05 的中午价）；
     * 昨收却是**权威且更新的最近收盘价**。更要紧的是：盘前用昨收计价，今日盈亏天然为 0 ——
     * 这才是符合定义的（还没开盘，今天确实没赚没亏）。用快照价则会算成
     * `份额 ×（快照价 − 昨收）`，一个既不是 0 也没有意义的数。
     */
    const priceSource: PriceSource =
      livePrice !== null ? 'live' : prevClose !== null ? 'prevclose' : 'snapshot'
    const price = livePrice ?? prevClose ?? row.snapshot_price

    const marketValue = row.shares * price
    const costValue = row.shares * row.cost
    const pnl = marketValue - costValue
    const todayPnl = prevClose === null ? null : row.shares * (price - prevClose)

    return {
      ...row,
      groupName: groupNames.get(row.group) ?? row.group,
      price,
      priceSource,
      // 按昨收计价时「今日涨跌」定义为 0（price === prevClose），不是「没有数据」
      chgPct: priceSource === 'live' ? (q?.chg_pct ?? null) : priceSource === 'prevclose' ? 0 : null,
      amount: priceSource === 'live' ? (q?.amount ?? null) : null,
      marketValue,
      costValue,
      pnl,
      pnlPct: costValue > 0 ? pnl / costValue : 0,
      todayPnl,
      breakevenPct: marketValue > 0 ? (costValue - marketValue) / marketValue : 0,
    }
  })
}

/* ------------------------------ 组合与分组汇总 ------------------------------ */

export interface PortfolioTotals {
  count: number
  marketValue: number
  costValue: number
  pnl: number
  pnlPct: number
  /** 今日盈亏合计；任一只有报价才计入，全无报价时为 null */
  todayPnl: number | null
  /**
   * 今日盈亏率（小数）= 今日盈亏 / **昨收**市值（除期初）。
   *
   * 与券商口径一致，也与图 3 记录的 `day_pnl_pct` 同式。**不要改用当前市值做分母**：
   * 分母会被当天自己的涨跌带着跑，涨时低估涨幅、跌时高估跌幅。昨收市值为 0 或负时为 null。
   */
  todayPnlPct: number | null
  /** 有实时报价的只数 */
  liveCount: number
  /** 按**昨收**计价的只数（盘前 / 停牌） */
  prevCloseCount: number
  /** 退到 `holdings.md` 快照价的只数（接口整体拿不到时才会 > 0） */
  snapshotCount: number
  /** 距成本：亏损时为「还需涨多少回本」，盈利时为「可回撤多少仍不亏」（小数） */
  breakevenPct: number
  /** 盈亏绝对额之和 —— 所有「贡献占比」的分母（对盈亏混合的组合也成立） */
  grossPnl: number
  /** 亏损只数 / 盈利只数 */
  losers: number
  winners: number
  /** 亏损最大与盈利最大的单只（没有对应项时为 null） */
  worst: HoldingCell | null
  best: HoldingCell | null
}

export function portfolioTotals(cells: HoldingCell[]): PortfolioTotals {
  const marketValue = cells.reduce((s, c) => s + c.marketValue, 0)
  const costValue = cells.reduce((s, c) => s + c.costValue, 0)
  const pnl = marketValue - costValue
  const withToday = cells.filter((c) => c.todayPnl !== null)
  const todayPnl = withToday.length > 0 ? withToday.reduce((s, c) => s + (c.todayPnl ?? 0), 0) : null
  // 昨收市值 = 当前市值 − 今日盈亏（份额不变，价格变动即当日盈亏）
  const prevValue = todayPnl === null ? null : marketValue - todayPnl
  const losersList = cells.filter((c) => c.pnl < 0)
  const winnersList = cells.filter((c) => c.pnl > 0)
  return {
    count: cells.length,
    marketValue,
    costValue,
    pnl,
    pnlPct: costValue > 0 ? pnl / costValue : 0,
    todayPnl,
    todayPnlPct: todayPnl !== null && prevValue !== null && prevValue > 0 ? todayPnl / prevValue : null,
    liveCount: cells.filter((c) => c.priceSource === 'live').length,
    prevCloseCount: cells.filter((c) => c.priceSource === 'prevclose').length,
    snapshotCount: cells.filter((c) => c.priceSource === 'snapshot').length,
    breakevenPct: marketValue > 0 ? (costValue - marketValue) / marketValue : 0,
    grossPnl: cells.reduce((s, c) => s + Math.abs(c.pnl), 0),
    losers: losersList.length,
    winners: winnersList.length,
    worst: losersList.length > 0 ? losersList.reduce((m, c) => (c.pnl < m.pnl ? c : m)) : null,
    best: winnersList.length > 0 ? winnersList.reduce((m, c) => (c.pnl > m.pnl ? c : m)) : null,
  }
}

/**
 * 「距成本」的双向语义。
 *
 * 同一个 `breakevenPct = (成本 − 市值) / 市值` 在两种持仓下都成立，但读法相反：
 *   - 亏损仓（pnl < 0）：正数，表示**还需上涨**多少才回本；
 *   - 盈利仓（pnl > 0）：负数，其绝对值表示**还能回撤**多少才回到成本（安全垫）。
 * 统一在这里判定，避免表格与总览卡各写一套而说法不一致。
 */
export function breakevenOf(v: { pnl: number; breakevenPct: number }): {
  kind: 'recover' | 'cushion'
  /** 始终为正的幅度（小数） */
  pct: number
} {
  return v.pnl < 0
    ? { kind: 'recover', pct: Math.abs(v.breakevenPct) }
    : { kind: 'cushion', pct: Math.abs(v.breakevenPct) }
}

export interface GroupStat {
  id: string
  name: string
  count: number
  marketValue: number
  costValue: number
  pnl: number
  pnlPct: number
  /** 市值占组合比例（0.26 = 26%） */
  weight: number
  /**
   * 有符号的盈亏贡献占比 = 该组净盈亏 / 全部持仓盈亏绝对额之和。
   * 与 `weight` 对比即「盈亏集中度」：亏损组为负、盈利组为正。
   * 全浮亏时它等于「占总亏损的比例」的相反数，语义与旧口径一致。
   */
  pnlContribution: number
  breakevenPct: number
}

export function groupStats(cells: HoldingCell[], groups: HoldingGroupMeta[]): GroupStat[] {
  const totalMv = cells.reduce((s, c) => s + c.marketValue, 0)
  const grossPnl = cells.reduce((s, c) => s + Math.abs(c.pnl), 0)
  return groups
    .map((g) => {
      const members = cells.filter((c) => c.group === g.id)
      const marketValue = members.reduce((s, c) => s + c.marketValue, 0)
      const costValue = members.reduce((s, c) => s + c.costValue, 0)
      const pnl = marketValue - costValue
      return {
        id: g.id,
        name: g.name,
        count: members.length,
        marketValue,
        costValue,
        pnl,
        pnlPct: costValue > 0 ? pnl / costValue : 0,
        weight: totalMv > 0 ? marketValue / totalMv : 0,
        pnlContribution: grossPnl > 0 ? pnl / grossPnl : 0,
        breakevenPct: marketValue > 0 ? (costValue - marketValue) / marketValue : 0,
      }
    })
    .filter((g) => g.count > 0)
}
