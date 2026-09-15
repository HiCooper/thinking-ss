import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { bpDiff, column, valueOf } from '../calc'
import { fmtBp, fmtNum } from '../format'
import {
  C,
  asItems,
  categoryAxis,
  dataZoomBase,
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

const NAME_US = '美国 10Y'
const NAME_CN = '中国 10Y'

export default function YieldChart({ rows }: { rows: MarketRow[] }) {
  const option = useMemo<EChartsOption>(() => {
    const dates = rows.map((r) => r.date)
    const us = column(rows, 'us10y')
    const cn = column(rows, 'cn10y')

    const tooltipFormatter = (params: unknown): string => {
      const items = asItems(params)
      if (items.length === 0) return ''
      const idx = items[0].dataIndex
      const byName = new Map(items.map((it) => [it.seriesName ?? '', it]))
      const usv = us[idx] ?? numOf(byName.get(NAME_US)?.value)
      const cnv = cn[idx] ?? numOf(byName.get(NAME_CN)?.value)
      const spread = usv !== null && cnv !== null ? (usv - cnv) * 100 : null
      const prevUsIdx = (() => {
        for (let i = idx - 1; i >= 0; i--) if (us[i] !== null) return i
        return -1
      })()
      const usChg = prevUsIdx >= 0 ? bpDiff(usv, us[prevUsIdx]) : null

      return [
        ttTitle(rows[idx]?.date ?? ''),
        ttRow(C.us10y, NAME_US, usv === null ? TT_EMPTY : `${fmtNum(usv, 2)} %`,
          usChg === null ? '' : `日 ${fmtBp(usChg)}`),
        ttRow(C.cn10y, NAME_CN, cnv === null ? TT_EMPTY : `${fmtNum(cnv, 2)} %`),
        ttDivider(),
        ttRow(
          undefined,
          '美中利差',
          spread === null ? TT_EMPTY : `${fmtNum(spread, 0)} bp`,
          '美 10Y − 中 10Y',
        ),
      ].join('')
    }

    return {
      animationDuration: 420,
      color: [C.us10y, C.cn10y],
      grid: gridWithZoom(52),
      legend: { ...legendBase(), data: [NAME_US, NAME_CN] },
      tooltip: { ...tooltipBase(), formatter: tooltipFormatter },
      dataZoom: dataZoomBase(45),
      xAxis: categoryAxis(dates),
      yAxis: valueAxis({
        name: '%',
        nameTextStyle: { color: C.axisLabel, fontSize: 11 },
        axisLabel: {
          color: C.axisLabel,
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          formatter: (v: number) => v.toFixed(2),
        },
      }),
      series: [
        {
          name: NAME_US,
          type: 'line',
          data: us,
          symbol: 'none',
          lineStyle: { width: 2, color: C.us10y },
          itemStyle: { color: C.us10y },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(192, 57, 43, 0.07)' },
                { offset: 1, color: 'rgba(192, 57, 43, 0.00)' },
              ],
            },
          },
          connectNulls: false,
        },
        {
          name: NAME_CN,
          type: 'line',
          data: cn,
          symbol: 'none',
          lineStyle: { width: 2, color: C.cn10y },
          itemStyle: { color: C.cn10y },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(36, 113, 163, 0.07)' },
                { offset: 1, color: 'rgba(36, 113, 163, 0.00)' },
              ],
            },
          },
          connectNulls: false,
        },
      ],
    } as EChartsOption
  }, [rows])

  const latestSpread = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const u = valueOf(rows[i], 'us10y')
      const c = valueOf(rows[i], 'cn10y')
      if (u !== null && c !== null) return (u - c) * 100
    }
    return null
  }, [rows])

  return (
    <>
      <div className="chart-legend-note">
        <span className="num">最新美中利差：{fmtNum(latestSpread, 0)} bp</span>
        <span className="muted">利差 = 美 10Y − 中 10Y，正向走阔代表人民币资产相对吸引力下降</span>
      </div>
      <EChart option={option} height={340} ariaLabel="中美 10 年期国债收益率走势图" />
    </>
  )
}
