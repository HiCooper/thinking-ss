import type {
  MarketData,
  MarketRow,
  NumericKey,
  SpotA50,
  SpotCn,
  SpotData,
  SpotIndex,
  SpotKoreaItem,
  SpotSession,
  SparkSeries,
  SessionState,
} from './types'

/** data.json 不存在（404）时抛出，用于区分「文件还没生成」与「真的出错了」。 */
export class DataMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataMissingError'
  }
}

/**
 * `/api/spot` 不可用（静态部署没有本地服务端、网络失败、返回非 JSON 等）。
 * 前端据此展示「实时接口不可用」的浅色提示并隐藏数值，而不是报错崩掉。
 */
export class SpotUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpotUnavailableError'
  }
}

const NUMERIC_KEYS: NumericKey[] = [
  'turnover_sh',
  'turnover_sz',
  'turnover_total',
  'us10y',
  'cn10y',
  'margin_rz',
  'margin_rq',
  'margin_total',
  'float_mktcap',
  'margin_rz_ratio',
  'turnover_ratio',
  'kospi',
  'star50',
]

/** 任意非有限数值（含 null / undefined / NaN / ""）统一收敛为 null。 */
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function normalizeRow(raw: unknown, index: number): MarketRow {
  const r = (raw ?? {}) as Record<string, unknown>
  const row = {
    date: typeof r.date === 'string' && r.date ? r.date : `#${index + 1}`,
  } as MarketRow
  for (const key of NUMERIC_KEYS) {
    row[key] = toNum(r[key])
  }
  return row
}

/**
 * 读取 `/data.json`。纯前端取数，不硬编码任何行情数据。
 * - 404 → DataMissingError（上层展示「尚未生成数据」的友好提示）
 * - 其它网络 / 解析错误 → 普通 Error（上层展示错误态 + 重试）
 */
export async function fetchMarketData(signal?: AbortSignal): Promise<MarketData> {
  let res: Response
  try {
    res = await fetch('/data.json', { signal, cache: 'no-store' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error('无法连接服务器读取 /data.json，请确认开发服务器仍在运行。')
  }

  if (res.status === 404) {
    throw new DataMissingError('未找到 /data.json，数据文件尚未生成。')
  }
  if (!res.ok) {
    throw new Error(`读取 /data.json 失败：HTTP ${res.status} ${res.statusText}`)
  }

  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    throw new Error('/data.json 不是合法的 JSON，请检查数据生成脚本的输出。')
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('/data.json 顶层结构应为对象 { generated_at, sources, rows }。')
  }

  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.rows)) {
    throw new Error('/data.json 缺少 rows 数组。')
  }

  const rows = obj.rows
    .map((r, i) => normalizeRow(r, i))
    // 按日期升序；日期缺失/不可比较的保持原有相对顺序
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const cmp = a.row.date.localeCompare(b.row.date)
      return cmp !== 0 ? cmp : a.i - b.i
    })
    .map((x) => x.row)

  return {
    generated_at: typeof obj.generated_at === 'string' ? obj.generated_at : '未知',
    sources: typeof obj.sources === 'string' ? obj.sources : '',
    rows,
  }
}

/* ------------------------------ /api/spot（本地实时接口） ------------------------------ */

function objOf(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}

function strOf(o: Record<string, unknown>, key: string): string | null {
  const v = o[key]
  return typeof v === 'string' && v !== '' ? v : null
}

function normalizedIndex(raw: unknown): SpotIndex | null {
  const o = objOf(raw)
  if (!o) return null
  return {
    name: strOf(o, 'name') ?? '—',
    code: strOf(o, 'code') ?? '—',
    price: toNum(o.price),
    chg_pct: toNum(o.chg_pct),
  }
}

function normalizedCn(raw: unknown): SpotCn | null {
  const o = objOf(raw)
  if (!o) return null
  const list = Array.isArray(o.indices) ? o.indices : []
  return {
    sh: toNum(o.sh),
    sz: toNum(o.sz),
    total: toNum(o.total),
    bj50: toNum(o.bj50),
    indices: list.map(normalizedIndex).filter((x): x is SpotIndex => x !== null),
  }
}

/** 外盘期货快照（A50 / 纳指期货同形）。 */
function normalizedFuture(raw: unknown): SpotA50 | null {
  const o = objOf(raw)
  if (!o) return null
  return { price: toNum(o.price), chg_pct: toNum(o.chg_pct), time: strOf(o, 'time') }
}

function normalizedKorea(raw: unknown): SpotKoreaItem | null {
  const o = objOf(raw)
  if (!o) return null
  return {
    name: strOf(o, 'name') ?? '—',
    price: toNum(o.price),
    chg_pct: toNum(o.chg_pct),
    time: strOf(o, 'time'),
  }
}

const SESSION_STATES: SessionState[] = ['pre', 'open', 'lunch', 'closed']

/** 分时序列：points/times 必须等长且 ≥2 点才有意义，否则整体降级为 null。 */
function normalizedSpark(raw: unknown): SparkSeries | null {
  const o = objOf(raw)
  if (!o) return null
  const pointsRaw = Array.isArray(o.points) ? o.points : []
  const timesRaw = Array.isArray(o.times) ? o.times : []
  const points = pointsRaw.map((v) => toNum(v)).filter((v): v is number => v !== null)
  const times = timesRaw.filter((t): t is string => typeof t === 'string')
  if (points.length < 2 || times.length < 2) return null
  return {
    points,
    times,
    base: toNum(o.base),
    from: strOf(o, 'from') ?? times[0],
    to: strOf(o, 'to') ?? times[times.length - 1],
  }
}

function normalizedSession(raw: unknown): SpotSession {
  const o = objOf(raw)
  const state = o && SESSION_STATES.includes(o.state as SessionState) ? (o.state as SessionState) : 'closed'
  const fallback: Record<SessionState, string> = {
    pre: '盘前',
    open: '交易中',
    lunch: '午间休市',
    closed: '已收盘',
  }
  return { state, label: (o && strOf(o, 'label')) ?? fallback[state] }
}

/** 把服务端返回收敛成契约形状；缺失/异常一律降级为 null，绝不抛解析错。 */
function normalizeSpot(raw: unknown): SpotData {
  const o = objOf(raw) ?? {}
  const koreaRaw = objOf(o.korea)
  const kospi = koreaRaw ? normalizedKorea(koreaRaw.kospi) : null
  const kosdaq = koreaRaw ? normalizedKorea(koreaRaw.kosdaq) : null
  const sparkRaw = objOf(o.spark)
  return {
    ts: strOf(o, 'ts') ?? '—',
    session: normalizedSession(o.session),
    cn: normalizedCn(o.cn),
    a50: normalizedFuture(o.a50),
    nq: normalizedFuture(o.nq),
    korea: kospi || kosdaq ? { kospi, kosdaq } : null,
    spark: {
      a50: sparkRaw ? normalizedSpark(sparkRaw.a50) : null,
      nq: sparkRaw ? normalizedSpark(sparkRaw.nq) : null,
      kospi: sparkRaw ? normalizedSpark(sparkRaw.kospi) : null,
      kosdaq: sparkRaw ? normalizedSpark(sparkRaw.kosdaq) : null,
    },
    errors: Array.isArray(o.errors) ? o.errors.filter((e): e is string => typeof e === 'string') : [],
  }
}

/**
 * 读取本地实时接口 `/api/spot`（由 Vite 插件在 dev / preview 服务端代理新浪行情）。
 * 静态部署下该路径不存在（404）→ 抛 SpotUnavailableError，由 LiveStrip 做优雅降级。
 */
export async function fetchSpot(signal?: AbortSignal): Promise<SpotData> {
  let res: Response
  try {
    res = await fetch('/api/spot', { signal, cache: 'no-store' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new SpotUnavailableError('无法连接 /api/spot（网络错误）')
  }

  if (res.status === 404) {
    throw new SpotUnavailableError('/api/spot 不存在（HTTP 404）')
  }
  if (!res.ok) {
    throw new SpotUnavailableError(`/api/spot 返回 HTTP ${res.status} ${res.statusText}`)
  }

  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    throw new SpotUnavailableError('/api/spot 返回的不是合法 JSON')
  }
  return normalizeSpot(raw)
}
