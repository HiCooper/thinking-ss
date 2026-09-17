import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { column, marginTotalOf } from '../calc'
import { fmtInt } from '../format'
import {
  C,
  asItems,
  categoryAxis,
  dataZoomBase,
  gridWithZoom,
  legendBase,
  numOf,
  percentileBand,
  tooltipBase,
  ttDivider,
  ttRow,
  ttTitle,
  valueAxis,
  TT_EMPTY,
} from '../chartTheme'
import { PERCENTILE_WINDOW, percentileOfLatest } from '../stats'
import type { MarketRow } from '../types'

const NAME_RZ = '融资余额（左轴）'
const NAME_RQ = '融券余额（右轴）'

export default function MarginChart({ rows }: { rows: MarketRow[] }) {
  // 分位带（图上）与分位文字（图下）都要用，所以放在 option 之外单独算
  const rzPct = useMemo(() => percentileOfLatest(column(rows, 'margin_rz')), [rows])

  const option = useMemo<EChartsOption>(() => {
    const dates = rows.map((r) => r.date)
    const rz = column(rows, 'margin_rz')
    const rq = column(rows, 'margin_rq')
    const totalFallback = rows.map((r) => marginTotalOf(r))

    const tooltipFormatter = (params: unknown): string => {
      const items = asItems(params)
      if (items.length === 0) return ''
      const idx = items[0].dataIndex
      const byName = new Map(items.map((it) => [it.seriesName ?? '', it]))
      const rzv = rz[idx] ?? numOf(byName.get(NAME_RZ)?.value)
      const rqv = rq[idx] ?? numOf(byName.get(NAME_RQ)?.value)
      const total = totalFallback[idx]

      return [
        ttTitle(rows[idx]?.date ?? ''),
        ttRow(C.marginRz, '融资余额', rzv === null ? TT_EMPTY : `${fmtInt(rzv)} 亿元`),
        ttRow(C.marginRq, '融券余额', rqv === null ? TT_EMPTY : `${fmtInt(rqv)} 亿元`),
        ttDivider(),
        ttRow(undefined, '两融合计', total === null ? TT_EMPTY : `${fmtInt(total)} 亿元`),
        rzv !== null && rqv !== null && total !== null
          ? ttRow(
              undefined,
              '融券 / 融资',
              `${((rqv / rzv) * 100).toFixed(2)}%`,
              '杠杆情绪偏空指标',
            )
          : '',
      ].join('')
    }

    return {
      animationDuration: 420,
      color: [C.marginRz, C.marginRq],
      grid: gridWithZoom(52),
      legend: { ...legendBase(), data: [NAME_RZ, NAME_RQ] },
      tooltip: { ...tooltipBase(), formatter: tooltipFormatter },
      dataZoom: dataZoomBase(45),
      xAxis: categoryAxis(dates),
      yAxis: [
        valueAxis({
          name: '融资余额（亿元）',
          nameTextStyle: { color: C.marginRz, fontSize: 11, align: 'left' },
          position: 'left',
          splitLine: { lineStyle: { color: C.splitLine } },
        }),
        {
          type: 'value',
          name: '融券余额（亿元）',
          nameTextStyle: { color: C.marginRq, fontSize: 11, align: 'right' },
          position: 'right',
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: C.marginRq,
            fontSize: 11,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          },
          // 右轴不重复画网格线，避免双轴网格打架
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: NAME_RZ,
          type: 'line',
          yAxisIndex: 0,
          data: rz,
          symbol: 'none',
          lineStyle: { width: 2.2, color: C.marginRz },
          itemStyle: { color: C.marginRz },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(192, 57, 43, 0.18)' },
                { offset: 1, color: 'rgba(192, 57, 43, 0.01)' },
              ],
            },
          },
          // 分位带只挂在融资余额上（左轴、主序列）；融券量级小两个数量级，挂上去会被压成一条线
          ...(rzPct ? percentileBand(rzPct) : {}),
          z: 2,
          connectNulls: false,
        },
        {
          name: NAME_RQ,
          type: 'line',
          yAxisIndex: 1,
          data: rq,
          symbol: 'none',
          lineStyle: { width: 1.8, color: C.marginRq },
          itemStyle: { color: C.marginRq },
          z: 3,
          connectNulls: false,
        },
      ],
    } as EChartsOption
  }, [rows, rzPct])

  return (
    <>
      <div className="chart-legend-note">
        <span className="muted">
          融资余额（左轴，亿元）与融券余额（右轴，亿元）量级相差约两个数量级，故使用双 y 轴，
          两轴刻度独立缩放，请分别按对应轴读数。
        </span>
        {rzPct ? (
          <span className="muted">
            灰色带＝融资余额近 {PERCENTILE_WINDOW} 个交易日 <b>P20~P80</b>（{fmtInt(rzPct.p20)} ~{' '}
            {fmtInt(rzPct.p80)} 亿），虚线为中位 {fmtInt(rzPct.p50)} 亿；最新处{' '}
            <b>{rzPct.rank.toFixed(0)}% 分位</b>
            {rzPct.rank >= 80 ? '（偏高）' : rzPct.rank <= 20 ? '（偏低）' : ''}
          </span>
        ) : null}
      </div>
      <EChart option={option} height={340} ariaLabel="融资融券余额走势图（双 y 轴，含近一年分位带）" />
    </>
  )
}
