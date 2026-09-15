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

const SYMBOLS = [...INDEX_SYMBOLS, A50_SYMBOL, NQ_SYMBOL, ...KOREA_SYMBOLS]

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
}

export interface SpotPayload {
  ts: string
  session: SpotSession
  cn: SpotCn | null
  a50: SpotA50 | null
  /** 纳指期货：与 a50 同形（现价 + 涨跌幅 + 自己的报价时间） */
  nq: SpotA50 | null
  korea: { kospi: SpotKoreaItem | null; kosdaq: SpotKoreaItem | null } | null
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

async function buildSpot(): Promise<SpotPayload> {
  const { minutes, ts } = beijingNow()
  const errors: string[] = []

  // 行情与四条分时并行抓，互不阻塞
  const [quotes, sparkA50, sparkNq, sparkKospi, sparkKosdaq] = await Promise.all([
    fetchQuotes(errors),
    fetchFuturesSpark('CHA50CFD', 'A50', errors),
    fetchFuturesSpark('NQ', 'NQ', errors),
    fetchKoreaSpark('KOSPI', errors),
    fetchKoreaSpark('KOSDAQ', errors),
  ])

  const kospi = buildKorea(quotes, 'b_KOSPI')
  const kosdaq = buildKorea(quotes, 'b_KOSDAQ')
  const cn = buildCn(quotes)

  return {
    ts,
    session: sessionOf(minutes),
    cn,
    a50: buildFuture(quotes, A50_SYMBOL),
    nq: buildFuture(quotes, NQ_SYMBOL),
    // kosdaq 保留在 payload 里（前端暂不渲染），想恢复只改 LiveStrip 一行
    korea: kospi || kosdaq ? { kospi, kosdaq } : null,
    spark: { a50: sparkA50, nq: sparkNq, kospi: sparkKospi, kosdaq: sparkKosdaq },
    errors,
  }
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
    spark: { a50: null, nq: null, kospi: null, kosdaq: null },
    errors: [message],
  }
}

export function localApi(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next): void => {
    const request = req as unknown as HttpRequestLike
    const response = res as unknown as HttpResponseLike
    const pathname = (request.url ?? '').split('?')[0]
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

  return {
    name: 'market-dashboard:local-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
