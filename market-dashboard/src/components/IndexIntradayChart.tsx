import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import {
  AXIS_LABEL_STYLE,
  C,
  TT_EMPTY,
  asItems,
  graphicNotice,
  tooltipBase,
  ttDivider,
  ttRow,
  ttTitle,
} from '../chartTheme'
import { fmtNum, fmtPct } from '../format'
import { LABEL_TIMES, SESSION_MINUTES, YI, niceStep } from '../intraday'
import type { IntradaySeries } from '../types'

const AREA_UP = 'rgba(217, 52, 43, 0.10)'
const AREA_DOWN = 'rgba(18, 156, 98, 0.10)'

/** 当日累计成交额用中性藏青（不预设涨跌方向），上日同期用灰色虚线 —— 与价格栏的昨收虚线同一语义。 */
const TODAY_AMT_COLOR = C.total
const PREV_AMT_COLOR = '#93a0b4'
const TODAY_AMT_AREA = 'rgba(31, 58, 95, 0.08)'

/**
 * 两栏的 left/right 必须**完全相同**、且不按各自轴标签宽度自适应（`containLabel`）：
 * 否则每栏按自己标签的宽度独立收缩，同一分钟会落在不同像素上 ——
 * 这正是把价格图和成交额副图合成一张图要解决的问题。留白按最宽的标签（点位 8 位）手算。
 */
const LEFT = 60
const RIGHT = 56
const PRICE_TOP = 12
const PRICE_H = 168
/** 价格栏底部那条 axisLine 就是两栏的分隔线，之间只留一行单位注记的呼吸距离。 */
const AMT_TOP = 208
const AMT_H = 68
const CHART_H = 300

function lastIndexOf(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i
  return -1
}

/**
 * 单个指数的当日分时：上栏价格（左轴点位 / 右轴涨跌幅，灰虚线为昨收），
 * 下栏累计成交额（当日实线 vs 上一交易日同时刻灰虚线）。
 *
 * 两栏共用同一条 `SESSION_MINUTES` 分类轴，只在最底部打时间标签，
 * 十字线用 `axisPointer.link` 联动 —— 鼠标扫过能看到同一分钟的点位与量能。
 */
export default function IndexIntradayChart({ series }: { series: IntradaySeries }) {
  const option = useMemo<EChartsOption>(() => {
    const priceByTime = new Map<string, number>()
    const todayByTime = new Map<string, number>()
    for (const p of series.points) {
      if (p.v !== null) priceByTime.set(p.t, p.v)
      if (p.amt !== null && p.amt !== undefined) todayByTime.set(p.t, p.amt)
    }
    const prevByTime = new Map(series.prev_amt.map((p) => [p.t, p.v]))

    const base = series.prev_close
    const priceValues = SESSION_MINUTES.map((t) => priceByTime.get(t) ?? null)
    const hasPrice = priceValues.some((v) => v !== null)
    const lastIdx = lastIndexOf(priceValues)
    const last = lastIdx >= 0 ? priceValues[lastIdx] : null
    const isUp = base === null || last === null || last >= base
    const color = isUp ? C.up : C.down

    // 成交额轴：上下两条线共用量程
    const todayValues = SESSION_MINUTES.map((t) => {
      const v = todayByTime.get(t)
      return v === undefined ? null : v / YI
    })
    const lastAmtIdx = lastIndexOf(todayValues)
    // 上日只画到当日已走到的那一刻：两条线末端对齐，缺口才代表同比。
    // 上日全天量刻意不画 —— 拿盘中的当日去比已收官的上日，会把「量还没跑完」读成「今天缩量」。
    const prevValues = SESSION_MINUTES.map((t, i) => {
      if (lastAmtIdx < 0 || i > lastAmtIdx) return null
      const v = prevByTime.get(t)
      return v === undefined ? null : v / YI
    })
    const hasAmt = lastAmtIdx >= 0
    const prevLabel = series.prev_amt_date
      ? `${series.prev_amt_date.slice(5)} 同期`
      : '上日同期'

    const peak = Math.max(
      0,
      ...todayValues.filter((v): v is number => v !== null),
      ...prevValues.filter((v): v is number => v !== null),
    )
    const amtStep = niceStep(peak / 3)
    const amtMax = peak > 0 ? Math.ceil(peak / amtStep) * amtStep : undefined

    // 价格轴：上下各留一点余量、刻度取整
    const anchors = priceValues.filter((v): v is number => v !== null)
    if (base !== null) anchors.push(base)

    let yMin: number | undefined
    let yMax: number | undefined
    let step = 0
    if (anchors.length > 0) {
      const lo = Math.min(...anchors)
      const hi = Math.max(...anchors)
      const pad = Math.max((hi - lo) * 0.06, hi * 0.001)
      step = niceStep((hi - lo + 2 * pad) / 4)
      yMin = Math.floor((lo - pad) / step) * step
      yMax = Math.ceil((hi + pad) / step) * step
    }
    const axisDigits = step >= 10 ? 0 : step >= 1 ? 1 : 2
    // 右轴必须和左轴落在同一组水平线上：两轴用同一个分段数，间隔按各自量纲换算
    const intervals =
      step > 0 && yMin !== undefined && yMax !== undefined
        ? Math.max(1, Math.round((yMax - yMin) / step))
        : 4
    // 涨跌幅轴只有在昨收可读时才有意义（它就是「相对昨收」的另一种刻度）
    const pctMin = base !== null && base > 0 && yMin !== undefined ? (yMin / base - 1) * 100 : null
    const pctMax = base !== null && base > 0 && yMax !== undefined ? (yMax / base - 1) * 100 : null
    // 成交额栏的 y 轴永远排在最后一个：涨跌幅轴只在有昨收时才存在
    const pctAxis =
      pctMin !== null && pctMax !== null
        ? {
            type: 'value',
            gridIndex: 0,
            position: 'right',
            min: pctMin,
            max: pctMax,
            interval: (pctMax - pctMin) / intervals,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
              ...AXIS_LABEL_STYLE,
              formatter: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
            },
            // 十字线打在这条轴上时，默认标签会吐出 0.75871041679… 这种原始浮点数
            axisPointer: {
              label: {
                formatter: (p: { value: number | string }) =>
                  `${Number(p.value) > 0 ? '+' : ''}${Number(p.value).toFixed(2)}%`,
              },
            },
            splitLine: { show: false },
          }
        : null

    const amtAxisIndex = pctAxis === null ? 1 : 2
    const amtAxis = {
      type: 'value',
      gridIndex: 1,
      min: 0,
      max: amtMax,
      interval: hasAmt ? amtStep : undefined,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...AXIS_LABEL_STYLE, formatter: (v: number) => fmtNum(v, 0) },
      axisPointer: {
        label: {
          formatter: (p: { value: number | string }) => `${fmtNum(Number(p.value), 0)} 亿`,
        },
      },
      splitLine: { lineStyle: { color: C.splitLine } },
    }

    // 两栏联动时 params 会带上四个系列的点，直接用 dataIndex 回到同一分钟再查表
    const tooltipFormatter = (params: unknown): string => {
      const it = asItems(params)[0]
      if (!it) return ''
      const t = SESSION_MINUTES[it.dataIndex] ?? String(it.axisValue ?? '')
      const v = priceByTime.get(t) ?? null
      const pct = v !== null && base !== null && base > 0 ? (v / base - 1) * 100 : null
      const amt = todayByTime.get(t) ?? null
      const pAmt = it.dataIndex <= lastAmtIdx ? (prevByTime.get(t) ?? null) : null
      const yoy = amt !== null && pAmt !== null && pAmt > 0 ? (amt / pAmt - 1) * 100 : null
      return [
        ttTitle(`${series.name} ${t}`),
        ttRow(color, '点位', v === null ? TT_EMPTY : fmtNum(v, 2), pct === null ? '' : fmtPct(pct)),
        ttDivider(),
        ttRow(TODAY_AMT_COLOR, '当日累计', amt === null ? TT_EMPTY : `${fmtNum(amt / YI, 0)} 亿`, yoy === null ? '' : fmtPct(yoy)),
        ttRow(PREV_AMT_COLOR, prevLabel, pAmt === null ? TT_EMPTY : `${fmtNum(pAmt / YI, 0)} 亿`),
      ].join('')
    }

    // 下栏的刻度只有数字，单位写在栏内左上角 —— 没有它，「6,000」会被读成点位
    const notices = hasPrice
      ? hasAmt
        ? [
            {
              type: 'text',
              silent: true,
              z: 100,
              left: LEFT,
              top: AMT_TOP - 20,
              style: { text: '亿元', fill: '#8b96a6', fontSize: 10 },
            },
          ]
        : []
      : graphicNotice('今日分时尚未开始')

    return {
      // 5s 一次重绘，动画会把整条线反复从左往右画一遍
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: { ...tooltipBase(), formatter: tooltipFormatter },
      graphic: notices,
      grid: [
        { left: LEFT, right: RIGHT, top: PRICE_TOP, height: PRICE_H },
        { left: LEFT, right: RIGHT, top: AMT_TOP, height: AMT_H },
      ],
      xAxis: [
        {
          type: 'category',
          gridIndex: 0,
          data: SESSION_MINUTES,
          boundaryGap: false,
          axisLine: { lineStyle: { color: C.axisLine } },
          axisTick: { show: false },
          // 时间标签只出现在最底部那一条轴上
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: SESSION_MINUTES,
          boundaryGap: false,
          axisLine: { lineStyle: { color: C.axisLine } },
          axisTick: { show: false },
          axisLabel: {
            ...AXIS_LABEL_STYLE,
            hideOverlap: true,
            interval: (_index: number, value: string) => LABEL_TIMES.has(value),
          },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          scale: true,
          min: yMin,
          max: yMax,
          interval: step > 0 ? step : undefined,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { ...AXIS_LABEL_STYLE, formatter: (v: number) => fmtNum(v, axisDigits) },
          axisPointer: {
            label: { formatter: (p: { value: number | string }) => fmtNum(Number(p.value), 2) },
          },
          splitLine: { lineStyle: { color: C.splitLine } },
        },
        ...(pctAxis === null ? [] : [pctAxis]),
        amtAxis,
      ],
      series: [
        {
          name: series.name,
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: priceValues,
          symbol: 'none',
          connectNulls: false,
          lineStyle: { width: 1.6, color },
          itemStyle: { color },
          areaStyle: { color: isUp ? AREA_UP : AREA_DOWN },
          // 昨收：灰色虚线，也是右轴 0.0% 的位置
          markLine:
            base === null
              ? undefined
              : {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: '#a9b4c4', type: 'dashed', width: 1 },
                  label: {
                    position: 'insideEndTop',
                    formatter: `昨收 ${fmtNum(base, 2)}`,
                    color: C.axisLabel,
                    fontSize: 10,
                  },
                  data: [{ yAxis: base }],
                },
        },
        {
          name: '当日累计成交额',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: amtAxisIndex,
          data: todayValues,
          symbol: 'none',
          connectNulls: false,
          lineStyle: { width: 1.4, color: TODAY_AMT_COLOR },
          itemStyle: { color: TODAY_AMT_COLOR },
          areaStyle: { color: TODAY_AMT_AREA },
          // 压在上日虚线之下：面积填充是半透明的，虚线若先画会被蒙一层
          z: 2,
        },
        {
          name: prevLabel,
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: amtAxisIndex,
          data: prevValues,
          symbol: 'none',
          connectNulls: false,
          lineStyle: { width: 1.2, color: PREV_AMT_COLOR, type: 'dashed' },
          itemStyle: { color: PREV_AMT_COLOR },
          z: 3,
        },
      ],
    } as EChartsOption
  }, [series])

  return <EChart option={option} height={CHART_H} ariaLabel={`${series.name} 盘中分时走势与累计成交额`} />
}
