/**
 * 分组相对强弱（`groups.json`）的解析与取数。
 *
 * 这份文件回答的是**「该站在哪条腿上」**：每条线是一个持仓组相对沪深300 的累计超额收益。
 * 它由 `scripts/export_group_rs.py` 从 `holdings.json` 的分组派生 —— 因此
 * **和 holdings.json 一样是隐私文件，不入库**（组构成等于间接暴露持仓结构）。
 *
 * 缺文件是**正常状态**（clone 下来必然没有），由调用方渲染引导，不当作错误。
 */

export interface GroupRsGroup {
  /** 分组字母（A/B/C…），与 holdings.md 的分组标题一致 */
  id: string
  /** 分组全名 */
  name: string
  /** 参与等权归一的成员代码（整段窗口都有价） */
  members: string[]
  /** 因窗口内缺价被剔除的成员 */
  excluded: string[]
  /** 组净值，窗口首日 = 1 */
  nav: number[]
  /** 相对基准的累计超额（%），窗口首日 = 0 */
  excess: number[]
}

export interface GroupRsFile {
  generated_at: string
  source: string
  note: string
  /** 窗口交易日数 */
  window: number
  /** 最后一个交易日 */
  as_of: string | null
  benchmark: { code: string; name: string; nav: number[] }
  /** x 轴：窗口内每个交易日（升序），与各组 nav/excess 一一对应 */
  days: string[]
  groups: GroupRsGroup[]
  errors: string[]
}

/** 图例与 tooltip 用短名：分组全名是「半导体 / 芯片 / 算力硬件」这种，太占地方。 */
export function shortGroupName(g: GroupRsGroup): string {
  const head = g.name.split('/')[0].trim()
  return `${g.id} ${head || g.name}`
}

function objOf(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}

function numArr(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN))
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x !== '')
}

function parseGroup(raw: unknown): GroupRsGroup | null {
  const o = objOf(raw)
  if (!o) return null
  const id = typeof o.id === 'string' ? o.id : ''
  const nav = numArr(o.nav)
  const excess = numArr(o.excess)
  // nav 与 excess 是硬要求：缺了画不出东西
  if (!id || nav.length === 0 || excess.length !== nav.length) return null
  return {
    id,
    name: typeof o.name === 'string' && o.name !== '' ? o.name : id,
    members: strArr(o.members),
    excluded: strArr(o.excluded),
    nav,
    excess,
  }
}

export function parseGroupRs(raw: unknown): GroupRsFile | null {
  const o = objOf(raw)
  if (!o) return null
  const days = strArr(o.days)
  const groups = (Array.isArray(o.groups) ? o.groups : [])
    .map(parseGroup)
    .filter((g): g is GroupRsGroup => g !== null)
  // 天数与各组长度必须自洽，否则 x 轴会与线错位 —— 宁可不画
  if (days.length === 0 || groups.length === 0) return null
  if (groups.some((g) => g.excess.length !== days.length)) return null

  const bench = objOf(o.benchmark)
  return {
    generated_at: typeof o.generated_at === 'string' ? o.generated_at : '—',
    source: typeof o.source === 'string' ? o.source : '—',
    note: typeof o.note === 'string' ? o.note : '',
    window: typeof o.window === 'number' ? o.window : days.length,
    as_of: typeof o.as_of === 'string' ? o.as_of : null,
    benchmark: {
      code: bench && typeof bench.code === 'string' ? bench.code : '',
      name: bench && typeof bench.name === 'string' ? bench.name : '基准',
      nav: bench ? numArr(bench.nav) : [],
    },
    days,
    groups,
    errors: strArr(o.errors),
  }
}

/**
 * 读取分组相对强弱。**返回 `null` 表示「还没有这份数据」**
 * （文件不存在 / 静态部署下 404 / Vite dev 回退 index.html / 内容不合法）。
 */
export async function fetchGroupRs(signal?: AbortSignal): Promise<GroupRsFile | null> {
  let res: Response
  try {
    res = await fetch('groups.json', { signal, cache: 'no-store' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return null
  }
  if (!res.ok) return null
  // 与 holdings.json 同样的坑：Vite dev/preview 对不存在的路径回退 index.html 并返回 200，
  // 「文件不存在」会伪装成「JSON 解析失败」。按 content-type 识别。
  if (!(res.headers.get('content-type') ?? '').includes('json')) return null
  try {
    return parseGroupRs(await res.json())
  } catch {
    return null
  }
}
