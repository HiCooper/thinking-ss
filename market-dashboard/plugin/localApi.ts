/**
 * 本地实时行情接口（Vite 插件）：GET /api/spot
 *
 * 浏览器直连新浪 hq.sinajs.cn 会被 CORS 挡住，因此在 Vite 服务端做一层代理：
 *   - dev（`configureServer`）与 preview（`configurePreviewServer`）**同时挂载**
 *   - 请求 `https://hq.sinajs.cn/list=<逗号分隔符号>`，必须带 Referer / User-Agent
 *   - 响应按 **GBK** 解码（`new TextDecoder('gbk')`），逐行解析
 *     `var hq_str_<符号>="字段,字段,...";`
 *
 * 容错原则：单个子项抓取失败只往 `errors` 里写一条并把该项置 null，
 * 接口本身**始终返回 200 + 合法 JSON**（绝不 500），前端据此做优雅降级。
 *
 * 字段序（实测）：
 *   - 指数全量字段 sh/sz/bj：[0]名称 [1]今开 [2]昨收 [3]最新 [4]最高 [5]最低
 *     … [8]成交量 [9]成交额（元）。
 *     ⚠️ 成交额只在全量字段里统一是「元」；`s_` 简版沪深是万元而北证50是元，混用会差 10000 倍。
 *   - hf_CHA50CFD：[0]最新 [4]高 [5]低 [6]时间(HH:MM:SS) [7]昨结
 *   - b_KOSPI / b_KOSDAQ：[0]名称 [1]最新 [2]涨跌额 [3]涨跌幅% [6]日期 [7]时间
 *     （日期/时间的实际下标与部分文档相反，代码按 HH:MM:SS 的形状挑选）
 *   - hkHSTECH / rt_hkHSTECH：[0]英文码 [1]中文名 [2]今开 [3]昨收 [4]最高 [5]最低
 *     [6]现价 [7]涨跌额 [8]涨跌幅% … [17]日期 [18]时间。
 *     ⚠️ **不要**把 [2] 当昨收：[2] 是今开（与腾讯分时首点 09:30 的价格一致），[3] 才是昨收。
 *     `rt_` 变体的时间带秒、`hk` 变体只有 HH:MM，两个都抓、优先 `rt_`。
 */
import type { Connect, Plugin } from 'vite'

const SINA_ENDPOINT = 'https://hq.sinajs.cn/list='
const TIMEOUT_MS = 8000

/** 指数全量字段符号（去重后）。bj899050 同时用于北证50 成交额分项。 */
const INDEX_SYMBOLS = ['sh000001', 'sz399001', 'sz399006', 'sh000688', 'bj899050']
/** 富时中国 A50 期货（外盘 hf_ 前缀）。 */
const A50_SYMBOL = 'hf_CHA50CFD'
/** 纳斯达克 100 期货（外盘 hf_ 前缀，字段与 A50 完全一致）。 */
const NQ_SYMBOL = 'hf_NQ'
/** 韩国指数（外盘 b_ 前缀）。 */
const KOREA_SYMBOLS = ['b_KOSPI', 'b_KOSDAQ']
/**
 * 恒生科技指数（港股）。抓两个变体：`rt_` 的时间带秒（`pickClock` 只认 HH:MM:SS），
 * `hk` 是收盘口径的兜底。一次批量请求里多两个符号，没有额外往返。
 *
 * 为什么要它：港股 16:00 收盘、比 A 股晚一小时 —— **A 股收盘后到 16:00 这一小时，
 * 港股科技是唯一还在动的中国科技读数**，而这个面板原有的 A50/KOSPI/NQ 全是股指期货，
 * 缺的正是「港股科技」这条腿。
 */
const HK_SYMBOL = 'hkHSTECH'
const HK_RT_SYMBOL = 'rt_hkHSTECH'
/**
 * COMEX 黄金 / 白银、NYMEX WTI 原油（外盘 `hf_` 前缀，字段序与 A50/NQ 完全一致）。
 * 加这三个的目的：实时面板原来清一色「风险资产」（股指期货 + 港股科技），
 * 缺一条**避险 / 大宗**腿 —— 黄金是避险与实际利率代理（直接对应黄金股板块），
 * WTI 对应油气化工行业读数，白银与黄金高度相关（0.8+，信息量重叠，属顺带展示）。
 */
const GOLD_SYMBOL = 'hf_GC'
const SILVER_SYMBOL = 'hf_SI'
const WTI_SYMBOL = 'hf_CL'

const SYMBOLS = [
  ...INDEX_SYMBOLS,
  A50_SYMBOL,
  NQ_SYMBOL,
  ...KOREA_SYMBOLS,
  HK_SYMBOL,
  HK_RT_SYMBOL,
  GOLD_SYMBOL,
  SILVER_SYMBOL,
  WTI_SYMBOL,
]

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn',
  'User-Agent': 'Mozilla/5.0',
}

/** 外盘期货分时（新浪 JSONP，返回 `var t=({...});`）；A50 与 NQ 同一个 service。 */
const futuresMinUrl = (symbol: string) =>
  `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=${symbol}`
/** 韩国指数分时（新浪全球指数分钟线）。 */
const koreaMinUrl = (symbol: string) =>
  `https://gi.finance.sina.com.cn/hq/min?symbol=${symbol}&num=400`
/**
 * 腾讯分时（A 股 / 港股通用）。**港股必须走这条** —— 新浪的「全球指数」分时端点只认
 * KOSPI/KOSDAQ，对 HSTECH 返回 `data: null`；新浪的 `HK_MinLineService` 也已下线
 * （返回 `Service not valid`）。实测腾讯这条对 `hkHSTECH` 返回与 A 股同格式的数据。
 */
const tencentMinUrl = (code: string) =>
  `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`

/** 迷你图最多返回的点数：等距抽稀、保留首尾，降低传输与渲染开销。 */
const SPARK_MAX_POINTS = 120

export interface SpotSession {
  state: 'pre' | 'open' | 'lunch' | 'closed'
  label: string
}

export interface SpotIndex {
  name: string
  code: string
  price: number | null
  chg_pct: number | null
}

export interface SpotCn {
  /** 沪市成交额（亿元） */
  sh: number | null
  /** 深市成交额（亿元） */
  sz: number | null
  /** 沪深合计成交额（亿元，不含北交所） */
  total: number | null
  /** 北证50 成交额（亿元） */
  bj50: number | null
  indices: SpotIndex[]
}

export interface SpotA50 {
  price: number | null
  chg_pct: number | null
  time: string | null
}

export interface SpotKoreaItem {
  name: string
  price: number | null
  chg_pct: number | null
  time: string | null
}

/** 港股指数快照（形状与 SpotKoreaItem 一致，但**字段下标完全不同**，所以单独一个类型）。 */
export interface SpotHkItem {
  name: string
  price: number | null
  chg_pct: number | null
  time: string | null
}

/**
 * 迷你日内走势（下采样到 ≤ SPARK_MAX_POINTS 点）。
 * `base` 是当日基准（A50 = 昨结，韩国指数 = 昨收），前端按「末值 ≥ base → 红」上色。
 */
export interface SparkSeries {
  points: number[]
  times: string[]
  base: number | null
  /** 首个分时点时间 HH:MM */
  from: string | null
  /** 最后一个分时点时间 HH:MM */
  to: string | null
}

export interface SpotSpark {
  a50: SparkSeries | null
  nq: SparkSeries | null
  kospi: SparkSeries | null
  kosdaq: SparkSeries | null
  hstech: SparkSeries | null
  gold: SparkSeries | null
  silver: SparkSeries | null
  wti: SparkSeries | null
  qvix: SparkSeries | null
}

export interface SpotPayload {
  ts: string
  session: SpotSession
  cn: SpotCn | null
  a50: SpotA50 | null
  /** 纳指期货：与 a50 同形（现价 + 涨跌幅 + 自己的报价时间） */
  nq: SpotA50 | null
  korea: { kospi: SpotKoreaItem | null; kosdaq: SpotKoreaItem | null } | null
  /** 恒生科技指数：面板上补「港股科技」这条腿，且它比 A 股晚一小时收盘 */
  hstech: SpotHkItem | null
  /** 大宗商品：COMEX 黄金 / 白银、NYMEX WTI（与 a50 同形，补避险 / 大宗这条腿） */
  futures: {
    gold: SpotA50 | null
    silver: SpotA50 | null
    wti: SpotA50 | null
  }
  /**
   * QVIX：50ETF 期权隐含波动率指数（**中国波指**，optbbs 民间重建）。形状与 a50 一致，
   * `time` 为当日最后有效读数的北京时间（A 股时段，收盘后停在收盘值）。
   */
  qvix: SpotA50 | null
  spark: SpotSpark
  errors: string[]
}

/* ------------------------------ 数值工具 ------------------------------ */

function toNum(s: string | undefined): number | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const round = (v: number, digits: number): number => Number(v.toFixed(digits))

/** 涨跌幅（%）= 最新 / 基准 - 1。 */
function chgPct(last: number | null, base: number | null, digits = 2): number | null {
  if (last === null || base === null || base === 0) return null
  return round((last / base - 1) * 100, digits)
}

/** 金额一律保留 1 位小数，单位亿元。 */
function yi(v: number | null): number | null {
  return v === null ? null : round(v / 1e8, 1)
}

const CLOCK_RE = /^\d{1,2}:\d{2}:\d{2}$/

/** 韩国接口的日期/时间下标在实测中相反，按 HH:MM:SS 的形状挑。 */
function pickClock(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    const t = c?.trim()
    if (t && CLOCK_RE.test(t)) return t
  }
  return null
}

/* ------------------------------ 北京时间 / 时段 ------------------------------ */

function beijingNow(): { minutes: number; ts: string } {
  // 服务器时区不一定是 Asia/Shanghai，统一走 UTC+8 偏移后用 UTC getter 读数
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    ts:
      `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
      `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`,
  }
}

function sessionOf(minutes: number): SpotSession {
  if (minutes < 9 * 60 + 30) return { state: 'pre', label: '盘前' }
  if (minutes < 11 * 60 + 30) return { state: 'open', label: '交易中' }
  if (minutes < 13 * 60) return { state: 'lunch', label: '午间休市' }
  if (minutes <= 15 * 60) return { state: 'open', label: '交易中' }
  return { state: 'closed', label: '已收盘' }
}

/* ------------------------------ 新浪取数 ------------------------------ */

type QuoteMap = Map<string, string[]>

async function fetchQuotes(errors: string[]): Promise<QuoteMap> {
  const quotes: QuoteMap = new Map()
  let res: Response
  try {
    res = await fetch(`${SINA_ENDPOINT}${SYMBOLS.join(',')}`, {
      headers: SINA_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    errors.push(`新浪行情请求失败：${err instanceof Error ? err.message : String(err)}`)
    return quotes
  }

  if (!res.ok) {
    errors.push(`新浪行情返回 HTTP ${res.status}`)
    return quotes
  }

  let text: string
  try {
    text = new TextDecoder('gbk').decode(await res.arrayBuffer())
  } catch (err) {
    errors.push(`GBK 解码失败：${err instanceof Error ? err.message : String(err)}`)
    return quotes
  }

  const re = /var\s+hq_str_([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*;/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const body = m[2].trim()
    if (body === '') {
      errors.push(`${m[1]}：返回空字符串`)
      continue
    }
    quotes.set(m[1], body.split(','))
  }

  for (const sym of SYMBOLS) {
    if (!quotes.has(sym)) errors.push(`${sym}：未返回数据`)
  }
  return quotes
}

/* ------------------------------ 各子项组装 ------------------------------ */

function buildCn(quotes: QuoteMap): SpotCn | null {
  const indices: SpotIndex[] = []
  const amounts = new Map<string, number | null>()

  for (const code of INDEX_SYMBOLS) {
    const f = quotes.get(code)
    if (!f) continue
    const last = toNum(f[3])
    amounts.set(code, yi(toNum(f[9])))
    indices.push({
      name: f[0]?.trim() || code,
      code,
      price: last === null ? null : round(last, 2),
      chg_pct: chgPct(last, toNum(f[2])),
    })
  }

  if (indices.length === 0) return null

  const sh = amounts.get('sh000001') ?? null
  const sz = amounts.get('sz399001') ?? null
  const bj50 = amounts.get('bj899050') ?? null
  return {
    sh,
    sz,
    // 合计只在沪深都有值时才给，避免半截数据被当成「两市成交额」
    total: sh !== null && sz !== null ? round(sh + sz, 1) : null,
    bj50,
    indices,
  }
}

/** 外盘期货快照（hf_ 前缀，A50 与 NQ 字段序一致）：[0]最新 [6]时间 [7]昨结。 */
function buildFuture(quotes: QuoteMap, symbol: string): SpotA50 | null {
  const f = quotes.get(symbol)
  if (!f) return null
  const last = toNum(f[0])
  return {
    price: last === null ? null : round(last, 1),
    chg_pct: chgPct(last, toNum(f[7])),
    time: pickClock(f[6], f[7]),
  }
}

function buildKorea(quotes: QuoteMap, symbol: string): SpotKoreaItem | null {
  const f = quotes.get(symbol)
  if (!f) return null
  const last = toNum(f[1])
  const chg = toNum(f[3])
  return {
    name: f[0]?.trim() || symbol,
    price: last === null ? null : round(last, 2),
    chg_pct: chg === null ? null : round(chg, 2),
    time: pickClock(f[7], f[6]),
  }
}

/**
 * 港股指数快照。
 *
 * ⚠️ 下标与 A 股 / 韩股**都不一样**，别套用：
 *   [1]中文名 [2]今开 [3]昨收 [4]最高 [5]最低 [6]现价 [7]涨跌额 [8]涨跌幅% [18]时间
 * 特别容易踩的是 **[2] 是今开不是昨收**（与腾讯分时首点 09:30 的价格一致）。
 * 这里现价与涨跌幅都自己算，不直接读 [8]，保持与 A50 / 韩股同一个口径。
 */
function buildHk(quotes: QuoteMap): SpotHkItem | null {
  const f = quotes.get(HK_RT_SYMBOL) ?? quotes.get(HK_SYMBOL)
  if (!f) return null
  const last = toNum(f[6])
  const prev = toNum(f[3])
  return {
    name: f[1]?.trim() || '恒生科技指数',
    price: last === null ? null : round(last, 2),
    chg_pct: chgPct(last, prev),
    time: pickClock(f[18]),
  }
}

/* ------------------------------ 迷你日内走势（sparkline） ------------------------------ */

/** 等距抽稀到 ≤ max 点，保留首尾。 */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  const out: T[] = []
  const step = (arr.length - 1) / (max - 1)
  for (let i = 0; i < max - 1; i++) out.push(arr[Math.round(i * step)])
  out.push(arr[arr.length - 1]) // 末点一定保留
  return out
}

/**
 * 分时点 → 契约形状。点数 < 2 时仍返回对象（前端据此不渲染），无点则返回 null。
 * base 缺失时退化为「首个分时点」，这样颜色至少能表达「日内相对起点」的方向。
 */
function toSpark(raw: { t: string; v: number }[], base: number | null): SparkSeries | null {
  if (raw.length === 0) return null
  const sampled = downsample(raw, SPARK_MAX_POINTS)
  return {
    points: sampled.map((p) => round(p.v, 2)),
    times: sampled.map((p) => p.t),
    base: base ?? round(sampled[0].v, 2),
    from: sampled[0].t,
    to: sampled[sampled.length - 1].t,
  }
}

/**
 * 外盘期货分时（A50 / NQ 共用解析器）。
 * JSONP `var t=({...});`，首行是表头 —— **[1] 恒为基准（昨结）**（A50 表头 10 个元素、NQ 也是一样，
 * 不按下标长度分支）；数据行 [0]=HH:MM [1]=价。
 */
async function fetchFuturesSpark(
  symbol: string,
  label: string,
  errors: string[],
): Promise<SparkSeries | null> {
  let text: string
  try {
    const res = await fetch(futuresMinUrl(symbol), {
      headers: SINA_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      errors.push(`${label} 分时返回 HTTP ${res.status}`)
      return null
    }
    text = new TextDecoder('gbk').decode(await res.arrayBuffer())
  } catch (err) {
    errors.push(`${label} 分时抓取失败：${err instanceof Error ? err.message : String(err)}`)
    return null
  }

  try {
    // 前面可能带 /*<script>…*/ 注释，取第一个 "(" 到最后一个 ")" 之间即为 JSON
    const start = text.indexOf('(')
    const end = text.lastIndexOf(')')
    if (start < 0 || end <= start) throw new Error('未找到 JSONP 包裹')
    const json = JSON.parse(text.slice(start + 1, end)) as { minLine_1d?: unknown }
    const rows = Array.isArray(json.minLine_1d) ? json.minLine_1d : []
    const header = rows[0]
    const base = Array.isArray(header) ? toNum(header[1] as string | undefined) : null

    const pts: { t: string; v: number }[] = []
    for (const row of rows) {
      if (!Array.isArray(row)) continue
      const t = typeof row[0] === 'string' ? row[0].trim() : ''
      if (!/^\d{2}:\d{2}$/.test(t)) continue // 表头行与异常行自然被过滤
      const v = toNum(row[1] as string | undefined)
      if (v !== null) pts.push({ t, v })
    }
    return toSpark(pts, base)
  } catch (err) {
    errors.push(`${label} 分时解析失败：${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** 韩国指数分时：[0]=HH:MM [1]=价；**昨收只在首行的 [5]**。 */
async function fetchKoreaSpark(symbol: string, errors: string[]): Promise<SparkSeries | null> {
  let json: { result?: { data?: unknown } }
  try {
    const res = await fetch(koreaMinUrl(symbol), {
      headers: SINA_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      errors.push(`${symbol} 分时返回 HTTP ${res.status}`)
      return null
    }
    json = JSON.parse(await res.text()) as { result?: { data?: unknown } }
  } catch (err) {
    errors.push(`${symbol} 分时抓取失败：${err instanceof Error ? err.message : String(err)}`)
    return null
  }

  const rows = Array.isArray(json.result?.data) ? (json.result?.data as unknown[]) : []
  const header = rows[0]
  const base = Array.isArray(header) ? toNum(header[5] as string | undefined) : null

  const pts: { t: string; v: number }[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const t = typeof row[0] === 'string' ? row[0].trim() : ''
    if (!/^\d{2}:\d{2}$/.test(t)) continue
    const v = toNum(row[1] as string | undefined)
    if (v !== null) pts.push({ t, v })
  }
  return toSpark(pts, base)
}

/** 腾讯分时解析结果：点位 + 腾讯自带的昨收（`qt[code][4]`，仅作兜底）。 */
interface MinPoints {
  points: { t: string; v: number }[]
  base: number | null
}

/* ------------------------------ QVIX（中国波指） ------------------------------ */

/**
 * QVIX：50ETF 期权的隐含波动率指数（**国内版恐慌指数**，民间项目 optbbs 重建，
 * akshare 的 QVIX 接口也只是包了壳）。为什么不用 CBOE VIX：已实测替换需求 —— VIX 是
 * 全球恐慌读数，QVIX 直接反映 A 股期权市场对**国内资产**未来波动的定价，对 A 股持仓更贴身。
 *
 * 为什么选 50ETF：国内期权流动性最好的品种。⚠️ 同站的「中证300股指」序列已于 2026-05-29
 * 停更（CSV 里全是 `#NAME?` 公式断链残骸），50ETF 线仍每日更新 —— 别换列，别信 akshare 文档。
 *
 * 端点：`http://1.optbbs.com/d/csv/d/vix50.csv`，纯文本 CSV：
 *   头行 `Time,QVIX,Pre,max,min`；数据行 `9:30:00,15.80 ,15.96,…`（字段带尾随空格）
 *   - [1] 当日分时读数（收盘后尾部是空占位行，要过滤）
 *   - [2] **昨收**（只在首行有值）
 */
const QVIX_URL = 'http://1.optbbs.com/d/csv/d/vix50.csv'

interface QvixResult {
  quote: SpotA50 | null
  spark: SparkSeries | null
}

function parseQvixCsv(text: string): QvixResult {
  const pts: { t: string; v: number }[] = []
  let preClose: number | null = null
  let lastT: string | null = null
  let lastV: number | null = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\ufeff/, '').trim()
    if (line === '' || line.startsWith('Time')) continue
    const cols = line.split(',').map((c) => c.trim())
    const t = cols[0] ?? ''
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t)
    if (!m) continue
    const v = toNum(cols[1])
    if (v === null || v <= 0) continue // 空占位行
    const p = toNum(cols[2])
    if (preClose === null && p !== null && p > 0) preClose = p // 昨收只在首行
    const hhmm = `${m[1].padStart(2, '0')}:${m[2]}`
    pts.push({ t: hhmm, v })
    lastT = hhmm
    lastV = v
  }

  if (lastV === null) return { quote: null, spark: null }
  return {
    quote: {
      price: round(lastV, 2),
      chg_pct: chgPct(lastV, preClose),
      time: lastT,
    },
    spark: toSpark(pts, preClose),
  }
}

async function fetchQvix(errors: string[]): Promise<QvixResult> {
  let text: string
  try {
    const res = await fetch(QVIX_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      errors.push(`QVIX 返回 HTTP ${res.status}`)
      return { quote: null, spark: null }
    }
    text = await res.text()
  } catch (err) {
    errors.push(`QVIX 抓取失败：${err instanceof Error ? err.message : String(err)}`)
    return { quote: null, spark: null }
  }

  try {
    return parseQvixCsv(text)
  } catch (err) {
    errors.push(`QVIX 解析失败：${err instanceof Error ? err.message : String(err)}`)
    return { quote: null, spark: null }
  }
}

/**
 * 腾讯分时解析。`data[code].data.data` 是 `"HHMM 价 量 额"` 字符串数组；
 * 昨收在 `data[code].qt[code][4]`（同一份响应里，不用另发一次请求）。
 *
 * 注意它返回的是**普通 JSON**（不是 JSONP），所以直接 `res.json()`。
 */
async function fetchTencentMinPoints(
  code: string,
  label: string,
  errors: string[],
): Promise<MinPoints | null> {
  let json: unknown
  try {
    const res = await fetch(tencentMinUrl(code), {
      headers: SINA_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      errors.push(`${label} 分时返回 HTTP ${res.status}`)
      return null
    }
    json = await res.json()
  } catch (err) {
    errors.push(`${label} 分时抓取失败：${err instanceof Error ? err.message : String(err)}`)
    return null
  }

  try {
    const root = json as { data?: Record<string, unknown> } | null
    const node = root?.data?.[code] as
      | { data?: { data?: unknown }; qt?: Record<string, unknown> }
      | undefined
    const rows = Array.isArray(node?.data?.data) ? (node.data.data as unknown[]) : []

    const points: { t: string; v: number }[] = []
    for (const row of rows) {
      if (typeof row !== 'string') continue
      const parts = row.trim().split(/\s+/)
      const hhmm = parts[0] ?? ''
      if (!/^\d{4}$/.test(hhmm)) continue
      const v = toNum(parts[1])
      if (v === null) continue
      points.push({ t: `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`, v })
    }

    // 昨收：qt[code] 的 [4]（与港股报价的 [3] 是同一个值，来源不同）
    const qt = node?.qt?.[code]
    const base = Array.isArray(qt) ? toNum(qt[4] as string | undefined) : null

    return points.length > 0 ? { points, base } : null
  } catch (err) {
    errors.push(`${label} 分时解析失败：${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

async function buildSpot(): Promise<SpotPayload> {
  const { minutes, ts } = beijingNow()
  const errors: string[] = []

  // 行情与分时并行抓，互不阻塞
  const [quotes, sparkA50, sparkNq, sparkKospi, sparkKosdaq, hkPoints, sparkGold, sparkSilver, sparkWti, qvix] =
    await Promise.all([
      fetchQuotes(errors),
      fetchFuturesSpark('CHA50CFD', 'A50', errors),
      fetchFuturesSpark('NQ', 'NQ', errors),
      fetchKoreaSpark('KOSPI', errors),
      fetchKoreaSpark('KOSDAQ', errors),
      fetchTencentMinPoints(HK_SYMBOL, '恒生科技', errors),
      fetchFuturesSpark('GC', 'COMEX黄金', errors),
      fetchFuturesSpark('SI', 'COMEX白银', errors),
      fetchFuturesSpark('CL', 'WTI原油', errors),
      fetchQvix(errors),
    ])

  const kospi = buildKorea(quotes, 'b_KOSPI')
  const kosdaq = buildKorea(quotes, 'b_KOSDAQ')
  const cn = buildCn(quotes)

  // 迷你图的基准优先用**新浪报价的昨收**（[3]），这样卡片上的涨跌幅与分时的红绿方向
  // 一定一致；新浪没取到时才退到腾讯自带的昨收。腾讯的 [2] 是今开，不能用。
  const hkQuote = quotes.get(HK_RT_SYMBOL) ?? quotes.get(HK_SYMBOL)
  const hkPrev = hkQuote ? toNum(hkQuote[3]) : null
  const sparkHstech = hkPoints ? toSpark(hkPoints.points, hkPrev ?? hkPoints.base) : null

  return {
    ts,
    session: sessionOf(minutes),
    cn,
    a50: buildFuture(quotes, A50_SYMBOL),
    nq: buildFuture(quotes, NQ_SYMBOL),
    // kosdaq 保留在 payload 里（前端暂不渲染），想恢复只改 LiveStrip 一行
    korea: kospi || kosdaq ? { kospi, kosdaq } : null,
    hstech: buildHk(quotes),
    futures: {
      gold: buildFuture(quotes, GOLD_SYMBOL),
      silver: buildFuture(quotes, SILVER_SYMBOL),
      wti: buildFuture(quotes, WTI_SYMBOL),
    },
    qvix: qvix.quote,
    spark: {
      a50: sparkA50,
      nq: sparkNq,
      kospi: sparkKospi,
      kosdaq: sparkKosdaq,
      hstech: sparkHstech,
      gold: sparkGold,
      silver: sparkSilver,
      wti: sparkWti,
      qvix: qvix.spark,
    },
    errors,
  }
}

/* ------------------------------ 快讯（新浪 7×24） ------------------------------ */

/**
 * 新浪 7×24 快讯（与行情同生态，免费稳定）。为什么不用财联社电报：质量更好但反爬严格。
 * 客户端 60s 轮询一次即可 —— 快讯不是价格，轮询太快没有意义还容易被封；
 * 服务端再做一层 30s 内存缓存兜底（多个标签页共用，避免重复打上游）。
 *
 * 重要级判定：接口的 `tag` 是**分类**（市场/央行/国际/公司…）不是重要级，
 * 所以用关键词规则自己判 —— 命中即视为重要（红点 + 置顶加粗的依据）。
 */
const SINA_NEWS_URL =
  'https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=50&zhibo_id=152&tag_id=0&dire=f&dpc=1'
const NEWS_CACHE_MS = 30_000
const NEWS_MAX_ITEMS = 50

/** 命中即视为「重要」的关键词：货币政策 / 监管 / 财政 / 贸易 / 指数规则类事件。 */
const NEWS_IMPORTANT_RE =
  /(央行|降准|降息|加息|加息|证监会|国务院|财政部|发改委|印花税|关税|美联储|议息|国务院常务|政治局)/

export interface NewsItem {
  id: string
  /** HH:MM（同日）；跨日时带 MM-DD 前缀 */
  time: string
  text: string
  /** 命中重要关键词 */
  important: boolean
  /** 新浪 7×24 详情页（无则空串） */
  url: string
  /** 分类名（市场/央行/国际/公司/其他…，取第一个） */
  tag: string
}

export interface NewsPayload {
  ts: string
  items: NewsItem[]
  errors: string[]
}

let newsCache: { at: number; payload: NewsPayload } | null = null

function parseNewsTs(createTime: string, today: string): string {
  // "2026-09-17 22:35:57" → 同日 "22:35"，跨日 "09-16 22:35"
  const m = /^\d{4}-(\d{2}-\d{2}) (\d{2}:\d{2})/.exec(createTime.trim())
  if (!m) return createTime.slice(11, 16) || createTime
  return m[1] === today ? m[2] : `${m[1]} ${m[2]}`
}

async function fetchNews(now: Date): Promise<NewsPayload> {
  const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  try {
    const res = await fetch(SINA_NEWS_URL, {
      headers: SINA_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as {
      result?: { data?: { feed?: { list?: unknown } } }
    }
    const list = Array.isArray(json.result?.data?.feed?.list)
      ? (json.result!.data!.feed!.list as Record<string, unknown>[])
      : []
    const items: NewsItem[] = []
    for (const it of list) {
      const text = typeof it.rich_text === 'string' ? it.rich_text.trim() : ''
      if (text === '') continue
      const tags = Array.isArray(it.tag) ? (it.tag as { name?: unknown }[]) : []
      const tag = typeof tags[0]?.name === 'string' ? tags[0].name : ''
      items.push({
        id: String(it.id ?? ''),
        time: parseNewsTs(typeof it.create_time === 'string' ? it.create_time : '', today),
        text,
        important: NEWS_IMPORTANT_RE.test(text),
        url: typeof it.docurl === 'string' ? it.docurl : '',
        tag,
      })
      if (items.length >= NEWS_MAX_ITEMS) break
    }
    return { ts, items, errors: items.length === 0 ? ['快讯列表为空'] : [] }
  } catch (err) {
    return {
      ts,
      items: [],
      errors: [`快讯抓取失败：${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

/** 内存缓存：30s 内的重复请求（多标签页 / 手动连点）直接回缓存，不打上游。 */
async function getNews(): Promise<NewsPayload> {
  const now = new Date()
  if (newsCache && now.getTime() - newsCache.at < NEWS_CACHE_MS) return newsCache.payload
  const payload = await fetchNews(now)
  if (payload.items.length > 0) newsCache = { at: now.getTime(), payload }
  else if (newsCache) return newsCache.payload // 抓取失败时退回旧缓存，列表不闪空
  return payload
}

/* ------------------------------ data.json 版本标记 ------------------------------ */

export interface DataVersionPayload {
  /** 文件 mtime（毫秒）；文件不存在时为 0 */
  mtime: number
  /** 文件字节数；文件不存在时为 0 */
  size: number
}

interface StatsLike {
  mtimeMs: number
  size: number
}

interface FsLike {
  statSync: (path: string) => StatsLike
  readFileSync: (path: string, encoding: string) => string
}

let fsPromise: Promise<FsLike | null> | null = null

/**
 * 取 `node:fs`。本项目没有装 @types/node（装了也只为这一处），
 * 所以用**变量说明符**动态 import：TS 不会去解析 `node:` 模块因而不会报 TS2307，
 * esbuild 也会原样保留这行 import，运行时在 Node 里正常解析；也不需要新增任何依赖。
 */
function loadFs(): Promise<FsLike | null> {
  if (!fsPromise) {
    const specifier = 'node:fs'
    fsPromise = import(/* @vite-ignore */ specifier)
      .then((mod) => {
        const fs = mod as Partial<FsLike>
        return typeof fs.statSync === 'function' ? (fs as FsLike) : null
      })
      .catch(() => null)
  }
  return fsPromise
}

/** root + 目录（支持绝对/相对、去掉多余斜杠）+ 文件名 → 该文件的绝对路径。 */
function dataFile(root: string, dir: string, name = 'data.json'): string {
  const clean = dir.replace(/\/+$/, '')
  if (clean.startsWith('/')) return `${clean}/${name}`
  const base = root.replace(/\/+$/, '')
  return `${base}/${clean.replace(/^\.\//, '')}/${name}`
}

/** 依次探测候选文件，返回第一个存在者的 mtime/size；都不存在 → {0,0}（前端静默忽略）。 */
async function readDataVersion(candidates: string[]): Promise<DataVersionPayload> {
  const fs = await loadFs()
  if (!fs) return { mtime: 0, size: 0 }
  for (const file of candidates) {
    try {
      const st = fs.statSync(file)
      return { mtime: Math.round(st.mtimeMs), size: st.size }
    } catch {
      // 文件不存在 / 无权限：试下一个候选
    }
  }
  return { mtime: 0, size: 0 }
}

/* ------------------------------ /api/holdings（持仓实时行情） ------------------------------ */

/**
 * 持仓明细行（`public/holdings.json` 的 rows 子集，本接口只关心代码与名称）。
 * 份额/成本不在这里参与计算——前端拿到报价后自己算市值与浮亏，
 * 这样接口职责单一：**只负责报价**。
 */
export interface HoldingQuote {
  /** 6 位证券代码（原样回传，前端据此与 holdings.json 对齐） */
  code: string
  /** 新浪符号（sh588000 / sz159516 …） */
  symbol: string
  /** 行情源给出的名称 */
  name: string | null
  /** 现价；停牌/未开盘时为 0 → 归为 null，前端显示占位而不显示 0 */
  price: number | null
  prev_close: number | null
  open: number | null
  high: number | null
  low: number | null
  /** 当日涨跌幅 %（现价 vs 昨收） */
  chg_pct: number | null
  /** 当日成交额（亿元） */
  amount: number | null
  /**
   * 行情自带的日期（新浪字段 [30]，如 `2026-09-16`）。
   * 它等于**最近一个交易日**，非交易日会停在上一个交易日 —— 前端据此判断
   * 「收益记录是否落后于行情」，比用本地日期可靠（本地日期在周末/节假日会误判）。
   */
  quote_date: string | null
}

export interface HoldingQuotesPayload {
  ts: string
  session: SpotSession
  quotes: HoldingQuote[]
  errors: string[]
}

/**
 * 6 位代码 → 新浪符号前缀。
 * 5/6/9 开头（沪市 ETF、沪市股票、沪 B）走 sh；其余（深市 ETF/LOF、深市股票、北交所）走 sz/bj。
 * 本项目持仓是 ETF/LOF，实际只用到 5xxxxx → sh、1xxxxx → sz 两条。
 */
function sinaSymbol(code: string): string {
  const c = code.trim()
  if (/^[569]/.test(c)) return `sh${c}`
  if (/^[48]/.test(c)) return `bj${c}`
  return `sz${c}`
}

/** 通用新浪批量取数：返回「符号 → 字段数组」。与 spot 的 fetchQuotes 同源，但不做固定符号校验。 */
async function fetchSinaBatch(symbols: string[], errors: string[]): Promise<QuoteMap> {
  const quotes: QuoteMap = new Map()
  if (symbols.length === 0) return quotes

  let res: Response
  try {
    res = await fetch(`${SINA_ENDPOINT}${symbols.join(',')}`, {
      headers: SINA_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    errors.push(`新浪行情请求失败：${err instanceof Error ? err.message : String(err)}`)
    return quotes
  }
  if (!res.ok) {
    errors.push(`新浪行情返回 HTTP ${res.status}`)
    return quotes
  }

  let text: string
  try {
    text = new TextDecoder('gbk').decode(await res.arrayBuffer())
  } catch (err) {
    errors.push(`GBK 解码失败：${err instanceof Error ? err.message : String(err)}`)
    return quotes
  }

  const re = /var\s+hq_str_([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*;/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const body = m[2].trim()
    if (body !== '') quotes.set(m[1], body.split(','))
  }
  return quotes
}

interface HoldingsFileLike {
  rows?: { code?: unknown; name?: unknown }[]
}

/**
 * 依次探测候选 holdings.json，读出代码清单（保持文件顺序、去重）。
 * 文件缺失时返回 null，由调用方转成一条可读的 errors 提示。
 */
async function readHoldingsCodes(
  candidates: string[],
): Promise<{ code: string; name: string | null }[] | null> {
  const fs = await loadFs()
  if (!fs) return null
  for (const file of candidates) {
    let raw: string
    try {
      raw = fs.readFileSync(file, 'utf-8')
    } catch {
      continue // 文件不存在 / 无权限：试下一个候选
    }
    try {
      const parsed = JSON.parse(raw) as HoldingsFileLike
      const rows = Array.isArray(parsed.rows) ? parsed.rows : []
      const out: { code: string; name: string | null }[] = []
      const seen = new Set<string>()
      for (const r of rows) {
        const code = typeof r.code === 'string' ? r.code.trim() : ''
        if (!/^\d{6}$/.test(code) || seen.has(code)) continue
        seen.add(code)
        out.push({ code, name: typeof r.name === 'string' ? r.name : null })
      }
      return out
    } catch {
      return null // 文件在但 JSON 坏了：直接报错，不要静默跳过
    }
  }
  return null
}

/** ETF/LOF 全量字段下标：[0]名称 [1]今开 [2]昨收 [3]现价 [4]最高 [5]最低 … [8]成交量 [9]成交额(元) */
function buildHoldingQuote(code: string, fields: string[] | undefined): HoldingQuote {
  const symbol = sinaSymbol(code)
  const base: HoldingQuote = {
    code,
    symbol,
    name: null,
    price: null,
    prev_close: null,
    open: null,
    high: null,
    low: null,
    chg_pct: null,
    amount: null,
    quote_date: null,
  }
  if (!fields) return base

  const price = toNum(fields[3])
  // 停牌 / 盘前现价为 0.00，照抄会显示成「跌 100%」，统一归 null 交给前端占位。
  // ⚠️ chg_pct 必须用**归一后**的价算：否则会出现「price 是 null、chg_pct 却是 −100%」
  // 这种自相矛盾的数据（盘前每只都中招），下游若只读 chg_pct 就会拿到假的 −100%。
  const livePrice = price !== null && price > 0 ? price : null
  return {
    ...base,
    name: fields[0]?.trim() || null,
    price: livePrice,
    prev_close: toNum(fields[2]),
    open: toNum(fields[1]),
    high: toNum(fields[4]),
    low: toNum(fields[5]),
    chg_pct: chgPct(livePrice, toNum(fields[2])),
    amount: yi(toNum(fields[9])),
    // [30] = 行情日期。只接受 YYYY-MM-DD 形状，避免不同品种字段错位时把脏值传出去
    quote_date: /^\d{4}-\d{2}-\d{2}$/.test(fields[30] ?? '') ? fields[30] : null,
  }
}

async function buildHoldingQuotes(files: string[]): Promise<HoldingQuotesPayload> {
  const { minutes, ts } = beijingNow()
  const session = sessionOf(minutes)
  const errors: string[] = []

  const holdings = await readHoldingsCodes(files)
  if (holdings === null) {
    return {
      ts,
      session,
      quotes: [],
      errors: ['未找到或无法解析 holdings.json（请先运行 python3 scripts/export_holdings.py）'],
    }
  }
  if (holdings.length === 0) {
    return { ts, session, quotes: [], errors: ['holdings.json 里没有可用的 6 位证券代码'] }
  }

  const symbols = holdings.map((h) => sinaSymbol(h.code))
  const quotes = await fetchSinaBatch(symbols, errors)

  const payload: HoldingQuote[] = holdings.map((h) => {
    const fields = quotes.get(sinaSymbol(h.code))
    if (!fields) errors.push(`${h.name ?? h.code}（${h.code}）：未返回数据`)
    return buildHoldingQuote(h.code, fields)
  })

  return { ts, session, quotes: payload, errors }
}

/* ------------------------------ 中间件 ------------------------------ */

/**
 * 只按结构声明用得到的字段。
 * 说明：本项目没装 @types/node，vite 的 `Connect.IncomingMessage`（继承自
 * `http.IncomingMessage`）解析不出 url / method 成员，因此显式按结构断言。
 */
interface HttpRequestLike {
  url?: string
  method?: string
}

interface HttpResponseLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

function sendJson(res: HttpResponseLike, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.end(JSON.stringify(body))
}

/** 兜底响应：即使整体抓取崩了也要保住契约形状，让前端能正常渲染降级提示。 */
function failurePayload(message: string): SpotPayload {
  const { minutes, ts } = beijingNow()
  return {
    ts,
    session: sessionOf(minutes),
    cn: null,
    a50: null,
    nq: null,
    korea: null,
    hstech: null,
    futures: { gold: null, silver: null, wti: null },
    qvix: null,
    spark: {
      a50: null,
      nq: null,
      kospi: null,
      kosdaq: null,
      hstech: null,
      gold: null,
      silver: null,
      wti: null,
      qvix: null,
    },
    errors: [message],
  }
}

function createMiddleware(dataFiles: string[], holdingsFiles: string[]): Connect.NextHandleFunction {
  return (req, res, next): void => {
    const request = req as unknown as HttpRequestLike
    const response = res as unknown as HttpResponseLike
    const pathname = (request.url ?? '').split('?')[0]

    // data.json 的版本标记：前端据此在数据脚本重新生成后自动重载图表
    if (pathname === '/api/data-version') {
      if (request.method && request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: '仅支持 GET /api/data-version' })
        return
      }
      void readDataVersion(dataFiles)
        .then((payload) => sendJson(response, 200, payload))
        .catch(() => sendJson(response, 200, { mtime: 0, size: 0 }))
      return
    }

    // 持仓实时报价（批量，一次请求覆盖全部持仓代码）
    if (pathname === '/api/holdings') {
      if (request.method && request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: '仅支持 GET /api/holdings' })
        return
      }
      void buildHoldingQuotes(holdingsFiles)
        .then((payload) => sendJson(response, 200, payload))
        .catch((err: unknown) => {
          const { minutes, ts } = beijingNow()
          sendJson(response, 200, {
            ts,
            session: sessionOf(minutes),
            quotes: [],
            errors: [err instanceof Error ? err.message : String(err)],
          })
        })
      return
    }

    // 新浪 7×24 快讯（服务端 30s 内存缓存 + 客户端 60s 轮询）
    if (pathname === '/api/news') {
      if (request.method && request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: '仅支持 GET /api/news' })
        return
      }
      void getNews()
        .then((payload) => sendJson(response, 200, payload))
        .catch((err: unknown) =>
          sendJson(response, 200, {
            ts: beijingNow().ts,
            items: [],
            errors: [err instanceof Error ? err.message : String(err)],
          }),
        )
      return
    }

    if (pathname !== '/api/spot') {
      next()
      return
    }
    if (request.method && request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: '仅支持 GET /api/spot' })
      return
    }
    void buildSpot()
      .then((payload) => sendJson(response, 200, payload))
      .catch((err: unknown) =>
        sendJson(response, 200, failurePayload(err instanceof Error ? err.message : String(err))),
      )
  }
}

export function localApi(): Plugin {
  return {
    name: 'market-dashboard:local-api',
    // dev：页面读的是 public/data.json
    configureServer(server) {
      const { root, publicDir } = server.config
      const pub = publicDir || 'public'
      server.middlewares.use(
        createMiddleware(
          [dataFile(root, pub)],
          [dataFile(root, pub, 'holdings.json')],
        ),
      )
    },
    // preview：页面读的是构建产物 outDir/data.json；它不存在时退回 public/data.json
    configurePreviewServer(server) {
      const { root, publicDir, build } = server.config
      const out = build.outDir || 'dist'
      const pub = publicDir || 'public'
      server.middlewares.use(
        createMiddleware(
          [dataFile(root, out), dataFile(root, pub)],
          [dataFile(root, out, 'holdings.json'), dataFile(root, pub, 'holdings.json')],
        ),
      )
    },
  }
}
