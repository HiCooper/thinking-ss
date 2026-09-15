import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { column, hasAnyValue, normalizeTo100 } from '../calc'
import { fmtNum, fmtPct } from '../format'
import {
  C,
  asItems,
  categoryAxis,
  dataZoomBase,
  graphicNotice,
  gridWithZoom,
  legendBase,
  numOf,
  tooltipBase,
  ttDivider,
  ttRow,
  ttTitle,
  valueAxis,
  TT_EMPTY,
} from '../chartTheme'
import type { MarketRow } from '../types'

const NAME_STAR = '科创50（区间起点=100）'
const NAME_KOSPI = '韩国 KOSPI（区间起点=100）'

/**
 * 图 5：跨市场科技情绪。
 * 科创50 与 KOSPI 点位量级不同，统一以**区间第一个有效值 = 100** 归一后同轴比较，
 * 看的是相对走势与背离，而不是绝对点位。
 */
export default function CrossMarketChart({ rows }: { rows: MarketRow[] }) {
  const option = useMemo<EChartsOption>(() => {
    const dates = rows.map((r) => r.date)
    const star = column(rows, 'star50')
    const kospi = column(rows, 'kospi')
    const starIdx = normalizeTo100(star)
    const kospiIdx = normalizeTo100(kospi)

    const tooltipFormatter = (params: unknown): string => {
      const items = asItems(params)
      if (items.length === 0) return ''
      const idx = items[0].dataIndex
      const byName = new Map(items.map((it) => [it.seriesName ?? '', it]))
      const sv = starIdx[idx] ?? numOf(byName.get(NAME_STAR)?.value)
      const kv = kospiIdx[idx] ?? numOf(byName.get(NAME_KOSPI)?.value)
      // 相对涨幅 = 相对指数 - 100
      const rel = (v: number | null) => (v === null ? TT_EMPTY : fmtPct(v - 100))
      const point = (v: number | null) => (v === null ? TT_EMPTY : fmtNum(v, 2))

      return [
        ttTitle(rows[idx]?.date ?? ''),
        ttRow(C.star50, '科创50', point(star[idx]), `相对 ${rel(sv)}`),
        ttRow(C.kospi, '韩国 KOSPI', point(kospi[idx]), `相对 ${rel(kv)}`),
        ttDivider(),
        ttRow(
          undefined,
          '相对强弱（科创50 - KOSPI）',
          sv !== null && kv !== null ? `${fmtNum(sv - kv, 2)}` : TT_EMPTY,
          '＞0 表示 A 股科技相对更强',
        ),
      ].join('')
    }

    const starOk = hasAnyValue(starIdx)
    const kospiOk = hasAnyValue(kospiIdx)
    const missing: string[] = []
    if (!starOk) missing.push('科创50（star50）序列不可用')
    if (!kospiOk) missing.push('韩国 KOSPI（kospi）序列不可用')

    return {
      animationDuration: 420,
      color: [C.star50, C.kospi],
      grid: gridWithZoom(52),
      legend: { ...legendBase(), data: [NAME_STAR, NAME_KOSPI] },
      tooltip: { ...tooltipBase(), formatter: tooltipFormatter },
      dataZoom: dataZoomBase(45),
      xAxis: categoryAxis(dates),
      yAxis: valueAxis({
        name: '区间起点＝100',
        nameTextStyle: { color: C.axisLabel, fontSize: 11 },
        scale: true,
      }),
      series: [
        {
          name: NAME_STAR,
          type: 'line',
          data: starIdx,
          symbol: 'none',
          lineStyle: { width: 2.2, color: C.star50 },
          itemStyle: { color: C.star50 },
          z: 3,
          connectNulls: false,
        },
        {
          name: NAME_KOSPI,
          type: 'line',
          data: kospiIdx,
          symbol: 'none',
          lineStyle: { width: 2, color: C.kospi, type: 'dashed' },
          itemStyle: { color: C.kospi },
          z: 2,
          connectNulls: false,
        },
      ],
      // 某条序列整列为 null：给出图内文字提示，而不是画一张空图
      graphic:
        missing.length === 0
          ? []
          : graphicNotice(missing.join('\n'), missing.length === 2 ? 'center' : 'topRight'),
    } as EChartsOption
  }, [rows])

  const latest = useMemo(() => {
    const starIdx = normalizeTo100(column(rows, 'star50'))
    const kospiIdx = normalizeTo100(column(rows, 'kospi'))
    const lastOf = (values: (number | null)[]) => {
      for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i] as number
      return null
    }
    return { star: lastOf(starIdx), kospi: lastOf(kospiIdx) }
  }, [rows])

  return (
    <>
      <div className="chart-legend-note">
        <span className="num">
          最新相对涨幅：科创50 {latest.star === null ? '—' : fmtPct(latest.star - 100)}　·　KOSPI{' '}
          {latest.kospi === null ? '—' : fmtPct(latest.kospi - 100)}
        </span>
        <span className="muted">归一化：区间第一个有效值 = 100，仅比较相对走势</span>
      </div>
      <EChart option={option} height={400} ariaLabel="科创50 与韩国 KOSPI 归一化走势对比图" />
    </>
  )
}
