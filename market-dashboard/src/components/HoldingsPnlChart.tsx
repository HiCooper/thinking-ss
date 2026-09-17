import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import {
  AXIS_LABEL_STYLE,
  C,
  asItems,
  pnlColor,
  tooltipBase,
  ttDivider,
  ttRow,
  ttTitle,
  zeroMarkLine,
} from '../chartTheme'
import { fmtPct, fmtSignedYuan, fmtYuan } from '../format'
import { breakevenOf } from '../holdings'
import type { HoldingCell } from '../holdings'

interface HoldingsPnlChartProps {
  cells: HoldingCell[]
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/**
 * 图 2：个股盈亏排行。
 *
 * 排序用**金额**而不是幅度，因为金额决定组合的痛点：一只 −45% 的小仓位，
 * 对总盈亏的贡献可能还不如一只 −8% 的大仓位。两者都放进 tooltip 与条尾标签，避免单维度误导。
 *
 * 盈亏可正可负：最惨的排最上、盈利的落到下方；轴范围覆盖正负并在 0 处画参考线；
 * 颜色按红涨绿跌、随幅度深浅渐变（`maxAbsPct` 取本屏最大幅度，避免小波动组合整屏发白）。
 */
export default function HoldingsPnlChart({ cells }: HoldingsPnlChartProps) {
  const option = useMemo<EChartsOption>(() => {
    // 横向条形图从下往上画，先升序排 → 最惨的落在最上方
    const ordered = [...cells].sort((a, b) => a.pnl - b.pnl).reverse()
    const names = ordered.map((c) => c.name)
    const values = ordered.map((c) => +c.pnl.toFixed(0))
    const maxAbsPct = Math.max(...ordered.map((c) => Math.abs(c.pnlPct)), 0.01)

    // 轴范围必须覆盖正负两侧，并给条尾标签留出空间
    const hi = Math.max(...values, 0)
    const lo = Math.min(...values, 0)
    const max = hi > 0 ? Math.ceil((hi * 1.28) / 1000) * 1000 : 0
    const min = lo < 0 ? Math.floor((lo * 1.18) / 1000) * 1000 : 0

    return {
      grid: { left: 8, right: 132, top: 20, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltipBase(),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(31,58,95,0.05)' } },
        formatter: (params: unknown) => {
          const items = asItems(params)
          const idx = items[0]?.dataIndex ?? 0
          const c = ordered[idx]
          if (!c) return ''
          const be = breakevenOf(c)
          return (
            ttTitle(`${c.name}　<span style="color:#8b96a6;font-weight:400">${c.code}</span>`) +
            ttRow(c.pnl >= 0 ? C.up : C.down, '浮动盈亏', `${fmtSignedYuan(c.pnl)} 元`) +
            ttRow(undefined, '盈亏率', fmtPct(c.pnlPct * 100)) +
            ttRow(undefined, be.kind === 'recover' ? '回本需涨' : '可回撤', fmtPct(be.pct * 100)) +
            ttDivider() +
            ttRow(
              undefined,
              '市值',
              `${fmtYuan(c.marketValue)} 元`,
              `${c.shares.toLocaleString('zh-CN')} 份`,
            ) +
            ttRow(
              undefined,
              '成本 / 现价',
              `${c.cost.toFixed(3)} → ${c.price.toFixed(3)}`,
              c.priceSource === 'live' ? '实时' : c.priceSource === 'prevclose' ? '昨收' : '快照',
            )
          )
        },
      },
      xAxis: {
        type: 'value',
        min,
        max,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          ...AXIS_LABEL_STYLE,
          formatter: (v: number) => (v === 0 ? '0' : `${(v / 10000).toFixed(1)}万`),
        },
        splitLine: { lineStyle: { color: C.splitLine } },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { onZero: false, lineStyle: { color: C.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: C.axisLabel, fontSize: 11 },
      },
      series: [
        {
          name: '浮动盈亏',
          type: 'bar',
          barWidth: 13,
          data: ordered.map((c) => {
            const v = c.pnl
            return {
              value: v,
              itemStyle: {
                color: pnlColor(c.pnlPct, maxAbsPct),
                borderRadius: v >= 0 ? [0, 2, 2, 0] : [2, 0, 0, 2],
              },
              label: {
                show: true,
                position: v >= 0 ? 'right' : 'left',
                color: C.legendText,
                fontSize: 10.5,
                fontFamily: MONO,
                formatter: `${fmtSignedYuan(c.pnl)}　${fmtPct(c.pnlPct * 100, 1)}`,
              },
            }
          }),
          markLine: zeroMarkLine(),
        },
      ],
    }
  }, [cells])

  return (
    <EChart
      option={option}
      height={Math.max(360, cells.length * 26 + 90)}
      ariaLabel="个股浮动盈亏排行"
    />
  )
}
