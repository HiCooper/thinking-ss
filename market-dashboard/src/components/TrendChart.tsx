import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { column, movingAverage } from '../calc'
import { fmtInt, fmtNum, trendClass } from '../format'
import { lastValue } from '../stats'
import {
  C,
  AXIS_LABEL_STYLE,
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
import { trendStateOf } from '../trend'
import type { MarketRow } from '../types'

const NAME_CLOSE = '沪深300 收盘'
const NAME_MA20 = 'MA20'
const NAME_MA60 = 'MA60'
const NAME_HIGH = '创20日新高（右轴）'
const NAME_LOW = '创20日新低（右轴）'

/**
 * 站上 / 跌破 MA20 的底色分段（markArea）。
 *
 * 读图时最费眼睛的是「现在到底在均线上方还是下方、从哪天开始的」——
 * 直接把两种区段铺成极浅的底色（站上 = 浅红、跌破 = 浅绿，与全站红涨绿跌一致），
 * 翻历史区间时一眼能看到每次站上/跌破持续了多久。
 *
 * 用 markArea 而不是第三条序列：它是背景刻度，不该进图例、tooltip 与 dataZoom。
 * 分段坐标用 **category 轴索引（数字）**：ECharts 对 category 轴的 markArea 接受索引，
 * 传日期字符串在类别值重复/缺失时反而容易错位。
 */
function buildAreas(
  closes: (number | null)[],
  ma20: (number | null)[],
): { above: [number, number][]; below: [number, number][] } {
  const above: [number, number][] = []
  const below: [number, number][] = []
  let start = -1
  let cur: 'above' | 'below' | null = null
  const flush = (endIdx: number) => {
    if (cur === null || start < 0) return
    const seg: [number, number] = [start, endIdx]
    ;(cur === 'above' ? above : below).push(seg)
  }
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i]
    const m = ma20[i]
    if (!Number.isFinite(c) || !Number.isFinite(m)) {
      // 数据缺口打断连续区段，缺口本身不着色
      flush(i - 1)
      start = -1
      cur = null
      continue
    }
    const s = (c as number) >= (m as number) ? 'above' : 'below'
    if (s !== cur) {
      flush(i - 1)
      start = i
      cur = s
    }
  }
  flush(closes.length - 1)
  return { above, below }
}

export default function TrendChart({ rows }: { rows: MarketRow[] }) {
  const read = useMemo(() => trendStateOf(rows), [rows])

  const option = useMemo<EChartsOption>(() => {
    const dates = rows.map((r) => r.date)
    const closes = column(rows, 'hs300')
    const ma20 = movingAverage(closes, 20)
    const ma60 = movingAverage(closes, 60)
    const areas = buildAreas(closes, ma20)
    // 市场宽度副轴：创新高/新低家数。价格趋势「真不真」要看宽度跟不跟——
    // 价格还在 MA20 上方但创新高的家数在萎缩，是趋势衰减的第一信号。
    const breadthHigh = column(rows, 'breadth_high20')
    const breadthLow = column(rows, 'breadth_low20')

    const tooltipFormatter = (params: unknown): string => {
      const items = asItems(params)
      if (items.length === 0) return ''
      const idx = items[0].dataIndex
      const byName = new Map(items.map((it) => [it.seriesName ?? '', it]))
      const close = closes[idx] ?? numOf(byName.get(NAME_CLOSE)?.value)
      const m20 = ma20[idx] ?? numOf(byName.get(NAME_MA20)?.value)
      const m60 = ma60[idx] ?? numOf(byName.get(NAME_MA60)?.value)
      const bh = breadthHigh[idx] ?? numOf(byName.get(NAME_HIGH)?.value)
      const bl = breadthLow[idx] ?? numOf(byName.get(NAME_LOW)?.value)
      const dev = (ma: number | null) =>
        close !== null && ma !== null ? `${close >= ma ? '站上' : '跌破'}` : null
      return [
        ttTitle(rows[idx]?.date ?? ''),
        ttRow(C.hs300, '沪深300 收盘', close === null ? TT_EMPTY : fmtNum(close, 2)),
        ttRow(C.ma20, NAME_MA20, m20 === null ? TT_EMPTY : fmtNum(m20, 2),
          dev(m20) ?? ''),
        ttRow(C.ma60, NAME_MA60, m60 === null ? TT_EMPTY : fmtNum(m60, 2),
          dev(m60) ?? ''),
        ttDivider(),
        ttRow(C.breadthHigh, '创20日新高', bh === null ? TT_EMPTY : `${fmtInt(bh)} 家`),
        ttRow(C.breadthLow, '创20日新低', bl === null ? TT_EMPTY : `${fmtInt(bl)} 家`),
        bh !== null && bl !== null
          ? ttRow(undefined, '净宽度', `${fmtInt(bh - bl)} 家`, '新高−新低，正＝扩张')
          : '',
      ].join('')
    }

    const areaData = [
      ...areas.above.map((seg) => [{ xAxis: seg[0] }, { xAxis: seg[1], itemStyle: { color: 'rgba(217, 52, 43, 0.05)' } }]),
      ...areas.below.map((seg) => [{ xAxis: seg[0] }, { xAxis: seg[1], itemStyle: { color: 'rgba(18, 156, 98, 0.05)' } }]),
    ]

    return {
      animationDuration: 420,
      color: [C.hs300, C.ma20, C.ma60, C.breadthHigh, C.breadthLow],
      grid: gridWithZoom(52),
      legend: { ...legendBase(), data: [NAME_CLOSE, NAME_MA20, NAME_MA60, NAME_HIGH, NAME_LOW] },
      tooltip: { ...tooltipBase(), formatter: tooltipFormatter },
      dataZoom: dataZoomBase(45),
      xAxis: categoryAxis(dates),
      yAxis: [
        valueAxis({
          name: '点',
          nameTextStyle: { color: C.axisLabel, fontSize: 11 },
          scale: true,
        }),
        {
          // 副轴：家数。不画网格线，避免与主轴网格打架（与图 4 双轴同一惯例）
          type: 'value',
          name: '家数',
          nameTextStyle: { color: C.axisLabel, fontSize: 11, align: 'right' },
          position: 'right',
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: AXIS_LABEL_STYLE,
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: NAME_CLOSE,
          type: 'line',
          yAxisIndex: 0,
          data: closes,
          symbol: 'none',
          lineStyle: { width: 2, color: C.hs300 },
          itemStyle: { color: C.hs300 },
          connectNulls: false,
          markArea: areaData.length > 0
            ? { silent: true, label: { show: false }, data: areaData }
            : undefined,
        },
        {
          name: NAME_MA20,
          type: 'line',
          yAxisIndex: 0,
          data: ma20,
          symbol: 'none',
          lineStyle: { width: 1.4, color: C.ma20, type: 'dashed' },
          itemStyle: { color: C.ma20 },
          connectNulls: false,
        },
        {
          name: NAME_MA60,
          type: 'line',
          yAxisIndex: 0,
          data: ma60,
          symbol: 'none',
          lineStyle: { width: 1.4, color: C.ma60, type: 'dashed' },
          itemStyle: { color: C.ma60 },
          connectNulls: false,
        },
        {
          name: NAME_HIGH,
          type: 'line',
          yAxisIndex: 1,
          data: breadthHigh,
          symbol: 'none',
          lineStyle: { width: 1.2, color: C.breadthHigh },
          itemStyle: { color: C.breadthHigh },
          z: 1,
          connectNulls: false,
        },
        {
          name: NAME_LOW,
          type: 'line',
          yAxisIndex: 1,
          data: breadthLow,
          symbol: 'none',
          lineStyle: { width: 1.2, color: C.breadthLow },
          itemStyle: { color: C.breadthLow },
          z: 1,
          connectNulls: false,
        },
      ],
    } as EChartsOption
  }, [rows])

  // 宽度最新读数：取各列最后一个有效值（涨跌家数/新高新低可能滞后于价格一天，如实显示可得值）
  const breadthNote = useMemo(() => {
    const bh = lastValue(column(rows, 'breadth_high20'))
    const bl = lastValue(column(rows, 'breadth_low20'))
    if (bh === null && bl === null) return null
    const net = bh !== null && bl !== null ? bh - bl : null
    return {
      text: `最新宽度：创20日高 ${bh === null ? '—' : fmtInt(bh)} 家 / 创20日低 ${bl === null ? '—' : fmtInt(bl)} 家`
        + (net === null ? '' : ` · 净 ${net > 0 ? '+' : ''}${fmtInt(net)}`),
      net,
    }
  }, [rows])

  return (
    <>
      <div className="chart-legend-note">
        <span className="num">
          最新判定：
          {read.state ? (
            <b className={read.trend === 1 ? 'trend-up' : read.trend === -1 ? 'trend-down' : ''}>
              {read.state}
            </b>
          ) : (
            <b>样本不足</b>
          )}
        </span>
        <span className="muted" title={read.basis}>{read.basis}</span>
        {breadthNote ? (
          <span className={`num ${trendClass(breadthNote.net)}`} title="创新高/新低家数取最新可得交易日；价格趋势要配上宽度看——新高萎缩＝趋势衰减">
            {breadthNote.text}
          </span>
        ) : null}
        <span className="muted">底色：站上 MA20 浅红 / 跌破浅绿（近一年窗口内）</span>
      </div>
      <EChart option={option} height={340} ariaLabel="沪深300 收盘价与 20/60 日均线走势图（副轴为创20日新高/新低家数）" />
    </>
  )
}
