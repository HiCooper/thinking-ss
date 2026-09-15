import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { column, movingAverage, pctChange, prevNonNull } from '../calc'
import { fmtInt, fmtNum, fmtPct } from '../format'
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

const MA_WINDOW = 20
const NAME_SH = '沪市成交额'
const NAME_SZ = '深市成交额'
const NAME_TOTAL = '两市合计'
const NAME_MA = `${MA_WINDOW} 日均线`

export default function TurnoverChart({ rows }: { rows: MarketRow[] }) {
  const option = useMemo<EChartsOption>(() => {
    const dates = rows.map((r) => r.date)
    const sh = column(rows, 'turnover_sh')
    const sz = column(rows, 'turnover_sz')
    const total = column(rows, 'turnover_total')
    const ma = movingAverage(total, MA_WINDOW)

    const tooltipFormatter = (params: unknown): string => {
      const items = asItems(params)
      if (items.length === 0) return ''
      const idx = items[0].dataIndex
      const byName = new Map(items.map((it) => [it.seriesName ?? '', it]))
      const pick = (name: string) => numOf(byName.get(name)?.value)

      const t = total[idx] ?? pick(NAME_TOTAL)
      const prev = prevNonNull(rows, 'turnover_total', idx)
      const chg = pctChange(t, prev ? prev.value : null)
      const shv = sh[idx] ?? pick(NAME_SH)
      const szv = sz[idx] ?? pick(NAME_SZ)
      const sum = t ?? (shv ?? 0) + (szv ?? 0)
      const share = (v: number | null) =>
        v !== null && sum > 0 ? `（${((v / sum) * 100).toFixed(1)}%）` : ''

      return [
        ttTitle(rows[idx]?.date ?? ''),
        ttRow(C.sh, NAME_SH, shv === null ? TT_EMPTY : `${fmtInt(shv)} 亿元`, share(shv)),
        ttRow(C.sz, NAME_SZ, szv === null ? TT_EMPTY : `${fmtInt(szv)} 亿元`, share(szv)),
        ttDivider(),
        ttRow(
          C.total,
          NAME_TOTAL,
          t === null ? TT_EMPTY : `${fmtInt(t)} 亿元`,
          chg === null ? '' : `日 ${fmtPct(chg)}`,
        ),
        ttRow(C.ma20, NAME_MA, ma[idx] === null ? TT_EMPTY : `${fmtInt(ma[idx] as number)} 亿元`),
      ].join('')
    }

    return {
      animationDuration: 420,
      color: [C.sh, C.sz, C.total, C.ma20],
      grid: gridWithZoom(52),
      legend: { ...legendBase(), data: [NAME_SH, NAME_SZ, NAME_TOTAL, NAME_MA] },
      tooltip: { ...tooltipBase(), formatter: tooltipFormatter },
      dataZoom: dataZoomBase(45),
      xAxis: categoryAxis(dates),
      yAxis: valueAxis({
        name: '亿元',
        nameTextStyle: { color: C.axisLabel, fontSize: 11 },
        // 沪/深是堆叠面积，基线必须为 0，否则各色带高度会被截断失真
        scale: false,
        min: 0,
      }),
      series: [
        {
          name: NAME_SH,
          type: 'line',
          stack: 'turnover',
          data: sh,
          symbol: 'none',
          lineStyle: { width: 1, color: C.sh, opacity: 0.9 },
          areaStyle: { color: 'rgba(224, 163, 62, 0.10)' },
          emphasis: { focus: 'series' },
          connectNulls: false,
        },
        {
          name: NAME_SZ,
          type: 'line',
          stack: 'turnover',
          data: sz,
          symbol: 'none',
          lineStyle: { width: 1, color: C.sz, opacity: 0.9 },
          areaStyle: { color: 'rgba(74, 144, 217, 0.10)' },
          emphasis: { focus: 'series' },
          connectNulls: false,
        },
        {
          name: NAME_TOTAL,
          type: 'line',
          data: total,
          symbol: 'none',
          smooth: false,
          lineStyle: { width: 2.4, color: C.total },
          itemStyle: { color: C.total },
          // 不再叠加 areaStyle：沪/深堆叠面积的上沿本身就等于合计线，
          // 再填一层会把下面的结构色带盖住。
          z: 3,
          connectNulls: false,
        },
        {
          name: NAME_MA,
          type: 'line',
          data: ma,
          symbol: 'none',
          lineStyle: { width: 1.6, color: C.ma20, type: 'dashed' },
          itemStyle: { color: C.ma20 },
          z: 4,
          connectNulls: false,
        },
      ],
    } as EChartsOption
  }, [rows])

  const latestMa = useMemo(() => {
    const ma = movingAverage(column(rows, 'turnover_total'), MA_WINDOW)
    for (let i = ma.length - 1; i >= 0; i--) if (ma[i] !== null) return ma[i] as number
    return null
  }, [rows])

  return (
    <>
      <div className="chart-legend-note">
        <span className="num">
          {MA_WINDOW} 日均线（最新）：{fmtNum(latestMa, 0)} 亿元
        </span>
        <span className="muted">null 不参与均值计算，也不连线（connectNulls: false）</span>
      </div>
      <EChart option={option} height={340} ariaLabel="两市总成交额走势图" />
    </>
  )
}
