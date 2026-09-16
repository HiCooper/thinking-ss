import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fmtInt, fmtNum, fmtPct, fmtSigned, trendClass } from '../format'
import { breakevenOf } from '../holdings'
import type { GroupStat, HoldingCell } from '../holdings'

interface HoldingsTableProps {
  cells: HoldingCell[]
  groups: GroupStat[]
}

type SortKey =
  | 'name'
  | 'group'
  | 'shares'
  | 'cost'
  | 'price'
  | 'chgPct'
  | 'todayPnl'
  | 'marketValue'
  | 'pnl'
  | 'pnlPct'
  | 'breakevenPct'

type SortDir = 'asc' | 'desc'

interface Column {
  key: SortKey
  label: string
  /** 数值列右对齐、等宽字体 */
  numeric?: boolean
  title?: string
  render: (c: HoldingCell, maxAbsPct: number) => ReactNode
}

const COLUMNS: Column[] = [
  {
    key: 'name',
    label: '名称',
    render: (c) => (
      <span className="holdings-name">
        <span className="holdings-name__text" title={`${c.name}（${c.code}）`}>
          {c.name}
        </span>
        <span className="holdings-name__code num">{c.code}</span>
      </span>
    ),
  },
  {
    key: 'group',
    label: '分组',
    render: (c) => <span className="tag tag--ghost holdings-group">{c.group}</span>,
  },
  { key: 'shares', label: '份额', numeric: true, render: (c) => fmtInt(c.shares) },
  { key: 'cost', label: '成本', numeric: true, render: (c) => c.cost.toFixed(3) },
  {
    key: 'price',
    label: '现价',
    numeric: true,
    title: '实时价（不可用时回退为快照价）',
    render: (c) => (
      <span className={c.priceSource === 'snapshot' ? 'holdings-price--snapshot' : undefined}>
        {c.price.toFixed(3)}
        {c.priceSource === 'snapshot' ? <em className="holdings-snap-dot" title="快照价" /> : null}
      </span>
    ),
  },
  {
    key: 'chgPct',
    label: '今日涨跌',
    numeric: true,
    title: '当日涨跌幅（现价 vs 昨收）；无实时报价时为「—」',
    render: (c) => (
      <span className={trendClass(c.chgPct)}>{c.chgPct === null ? '—' : fmtPct(c.chgPct)}</span>
    ),
  },
  {
    key: 'todayPnl',
    label: '今日盈亏',
    numeric: true,
    title: '份额 ×（现价 − 昨收），单位：元；无实时报价时为「—」',
    render: (c) => (
      <span className={trendClass(c.todayPnl)}>
        {c.todayPnl === null ? '—' : fmtSigned(c.todayPnl, 0)}
      </span>
    ),
  },
  { key: 'marketValue', label: '市值', numeric: true, render: (c) => fmtInt(c.marketValue) },
  {
    key: 'pnl',
    label: '浮动盈亏',
    numeric: true,
    render: (c) => <span className={trendClass(c.pnl)}>{fmtSigned(c.pnl, 0)}</span>,
  },
  {
    key: 'pnlPct',
    label: '盈亏率',
    numeric: true,
    title: '浮动盈亏 / 持仓成本（红涨绿跌）',
    render: (c, maxAbsPct) => (
      <span className="holdings-pnlcell">
        <span className={`holdings-pnlcell__text num ${trendClass(c.pnl)}`}>
          {fmtPct(c.pnlPct * 100)}
        </span>
        {/* 发散微条：0 居中，亏损向左（绿）、盈利向右（红）。
            width 用 50% 封顶，因为是在半个轨道里填充。 */}
        <span className="holdings-pnlbar" aria-hidden="true">
          <span
            className={`holdings-pnlbar__fill ${c.pnl < 0 ? 'is-loss' : 'is-gain'}`}
            style={{ width: `${Math.min(Math.abs(c.pnlPct) / (maxAbsPct || 1), 1) * 50}%` }}
          />
        </span>
      </span>
    ),
  },
  {
    key: 'breakevenPct',
    label: '距成本',
    numeric: true,
    title: '亏损仓：还需上涨多少才回本；盈利仓：还能回撤多少才回到成本',
    render: (c) => {
      // 恰好持平时两个方向都是 0，说「需涨 0.0% / 可跌 0.0%」都别扭，直接标注
      if (Math.abs(c.pnl) < 0.005) return <span className="muted">持平</span>
      const be = breakevenOf(c)
      return (
        <span className={be.kind === 'recover' ? 'holdings-breakeven' : 'holdings-cushion'}>
          {be.kind === 'recover' ? '需涨 ' : '可跌 '}
          {fmtNum(be.pct * 100, 1)}%
        </span>
      )
    },
  },
]

export default function HoldingsTable({ cells, groups }: HoldingsTableProps) {
  // 默认按浮动盈亏升序 —— 最惨的排最前，这是这张表最常用的读法
  const [sortKey, setSortKey] = useState<SortKey>('pnl')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [groupFilter, setGroupFilter] = useState<string>('all')

  const maxAbsPct = useMemo(
    () => Math.max(...cells.map((c) => Math.abs(c.pnlPct)), 0.01),
    [cells],
  )

  const rows = useMemo(() => {
    const filtered = groupFilter === 'all' ? cells : cells.filter((c) => c.group === groupFilter)
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name' || sortKey === 'group') {
        const av = sortKey === 'name' ? a.name : a.groupName
        const bv = sortKey === 'name' ? b.name : b.groupName
        return av.localeCompare(bv, 'zh-Hans-CN') * dir
      }
      const av = a[sortKey]
      const bv = b[sortKey]
      // 无报价（null）恒排在最后，不参与方向翻转
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return (Number(av) - Number(bv)) * dir
    })
  }, [cells, groupFilter, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    // 金额/份额类列默认从大到小；盈亏类默认从小到大（最惨在前）
    setSortDir(
      key === 'pnl' || key === 'pnlPct' || key === 'breakevenPct' || key === 'todayPnl'
        ? 'asc'
        : 'desc',
    )
  }

  const sumMv = rows.reduce((s, c) => s + c.marketValue, 0)
  const sumPnl = rows.reduce((s, c) => s + c.pnl, 0)

  return (
    <section className="card holdings-table-card">
      <header className="chart-card__head">
        <div className="chart-card__title-wrap">
          <h2 className="chart-card__title">
            <span className="chart-card__index">持仓</span>
            明细
          </h2>
          <p className="chart-card__subtitle">
            点击表头排序 · 默认按浮动盈亏从小到大（最惨在前）；带
            <em className="holdings-snap-dot holdings-snap-dot--inline" />
            的是快照价（无实时报价时的回退）
          </p>
        </div>
        <div className="chart-card__meta">
          <span className="tag">
            当前 {rows.length} 只 · 市值 {fmtInt(sumMv)}
          </span>
          <span className={`tag ${trendClass(sumPnl)}`}>盈亏 {fmtSigned(sumPnl, 0)}</span>
        </div>
      </header>

      <div className="holdings-filter">
        <button
          type="button"
          className={`btn btn--mini ${groupFilter === 'all' ? 'btn--mini-primary' : 'btn--mini-off'}`}
          onClick={() => setGroupFilter('all')}
        >
          全部 {cells.length}
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`btn btn--mini ${groupFilter === g.id ? 'btn--mini-primary' : 'btn--mini-off'}`}
            onClick={() => setGroupFilter(g.id)}
            title={`${g.name} · 市值占比 ${(g.weight * 100).toFixed(1)}% · 盈亏贡献 ${(g.pnlContribution * 100).toFixed(1)}%`}
          >
            {g.id} {g.name.length > 10 ? `${g.name.slice(0, 10)}…` : g.name}
            <span className="holdings-filter__count">{g.count}</span>
          </button>
        ))}
      </div>

      <div className="holdings-table-wrap">
        <table className="holdings-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={col.numeric ? 'is-numeric' : undefined}
                  aria-sort={
                    sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button
                    type="button"
                    className="holdings-th"
                    onClick={() => toggleSort(col.key)}
                    title={col.title}
                  >
                    {col.label}
                    <span className="holdings-th__arrow" aria-hidden="true">
                      {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.code}>
                {COLUMNS.map((col) => (
                  <td key={col.key} className={col.numeric ? 'is-numeric' : undefined}>
                    {col.render(c, maxAbsPct)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? <p className="footnote">该分组下没有持仓。</p> : null}
    </section>
  )
}
