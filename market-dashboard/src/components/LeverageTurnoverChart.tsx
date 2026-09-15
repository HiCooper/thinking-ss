import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { column, hasAnyValue, latestWith } from '../calc'
import { fmtInt, fmtNum } from '../format'
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

const NAME_RZ = '杠杆率（融资余额/流通市值）'
const NAME_TO = '换手率（成交额/流通市值）'

/**
 * 图 4：杠杆率与换手率。
 * 两个指标都做了「除以流通市值」的规模归一，量纲一致（%），因此共用同一条 y 轴。
 */
export default function LeverageTurnoverChart({ rows }: { rows: MarketRow[] }) {
  const option = useMemo<EChartsOption>(() => {
    const dates = rows.map((r) => r.date)
    const rz = column(rows, 'margin_rz_ratio')
    const turnover = column(rows, 'turnover_ratio')
    const mktcap = column(rows, 'float_mktcap')

    const tooltipFormatter = (params: unknown): string => {
      const items = asItems(params)
      if (items.length === 0) return ''
      const idx = items[0].dataIndex
      const byName = new Map(items.map((it) => [it.seriesName ?? '', it]))
      const rzv = rz[idx] ?? numOf(byName.get(NAME_RZ)?.value)
      const tv = turnover[idx] ?? numOf(byName.get(NAME_TO)?.value)
      const cap = mktcap[idx]

      return [
        ttTitle(rows[idx]?.date ?? ''),
        ttRow(C.rzRatio, '杠杆率', rzv === null ? TT_EMPTY : `${fmtNum(rzv, 2)}%`),
        ttRow(C.turnoverRatio, '换手率', tv === null ? TT_EMPTY : `${fmtNum(tv, 2)}%`),
        ttDivider(),
        ttRow(undefined, '流通市值', cap === null ? TT_EMPTY : `${fmtInt(cap)} 亿元`),
      ].join('')
    }

    const rzOk = hasAnyValue(rz)
    const turnoverOk = hasAnyValue(turnover)
    const missing: string[] = []
    if (!rzOk) missing.push('杠杆率（margin_rz_ratio）不可用')
    if (!turnoverOk) missing.push('换手率（turnover_ratio）不可用')

    return {
      animationDuration: 420,
      color: [C.rzRatio, C.turnoverRatio],
      grid: gridWithZoom(52),
      legend: { ...legendBase(), data: [NAME_RZ, NAME_TO] },
      tooltip: { ...tooltipBase(), formatter: tooltipFormatter },
      dataZoom: dataZoomBase(45),
      xAxis: categoryAxis(dates),
      yAxis: valueAxis({
        name: '%',
        nameTextStyle: { color: C.axisLabel, fontSize: 11 },
        scale: true,
      }),
      series: [
        {
          name: NAME_RZ,
          type: 'line',
          data: rz,
          symbol: 'none',
          lineStyle: { width: 2.2, color: C.rzRatio },
          itemStyle: { color: C.rzRatio },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(192, 57, 43, 0.14)' },
                { offset: 1, color: 'rgba(192, 57, 43, 0.01)' },
              ],
            },
          },
          z: 2,
          connectNulls: false,
        },
        {
          name: NAME_TO,
          type: 'line',
          data: turnover,
          symbol: 'none',
          lineStyle: { width: 2, color: C.turnoverRatio },
          itemStyle: { color: C.turnoverRatio },
          z: 3,
          connectNulls: false,
        },
      ],
      // 整列都是 null 时不要画空图，在图上写明哪条不可用
      graphic:
        missing.length === 0
          ? []
          : graphicNotice(missing.join('\n'), missing.length === 2 ? 'center' : 'topRight'),
    } as EChartsOption
  }, [rows])

  const latest = useMemo(() => {
    const rz = latestWith(rows, 'margin_rz_ratio')
    const to = latestWith(rows, 'turnover_ratio')
    const cap = latestWith(rows, 'float_mktcap')
    return { rz, to, cap }
  }, [rows])

  return (
    <>
      <div className="chart-legend-note">
        <span className="num">
          最新：杠杆率 {fmtNum(latest.rz?.value, 2)}%　·　换手率 {fmtNum(latest.to?.value, 2)}%　·　流通市值{' '}
          {fmtInt(latest.cap?.value)} 亿元
        </span>
        <span className="muted">杠杆率高＝交易拥挤／加杠杆，杠杆率回落＝去杠杆；null 不连线</span>
      </div>
      <EChart option={option} height={340} ariaLabel="杠杆率与换手率走势图（同一 y 轴，%）" />
    </>
  )
}
