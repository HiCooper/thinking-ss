import type { MarketData, MarketRow, NumericKey } from './types'

/** data.json 不存在（404）时抛出，用于区分「文件还没生成」与「真的出错了」。 */
export class DataMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataMissingError'
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
