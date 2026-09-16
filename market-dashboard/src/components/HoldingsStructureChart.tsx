import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import {
  AXIS_LABEL_STYLE,
  C,
  asItems,
  legendBase,
  pnlTextColor,
  tooltipBase,
  ttDivider,
  ttRow,
  ttTitle,
  zeroMarkLine,
} from '../chartTheme'
import { fmtPct, fmtSignedYuan, fmtYuan } from '../format'
import { breakevenOf } from '../holdings'
import type { GroupStat } from '../holdings'

interface HoldingsStructureChartProps {
  groups: GroupStat[]
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/**
 * 图 1：分组结构 —— 「市值占比」与「盈亏贡献占比」并排对比。
 *
 * 读法：两根条**越不成比例**，说明这个组对总盈亏的影响远超它的仓位占比
 * （典型：占 20% 市值却贡献了一半亏损；或者反过来，小仓位贡献了大利润）。
 *
 * **盈亏贡献是有符号的**：亏损组向左、盈利组向右，0 处画参考线。
 * 口径 = 该组净盈亏 / 全部持仓盈亏绝对额之和 —— 对盈亏混合的组合也成立；
 * 全浮亏时它退化成「占总亏损的比例」。
 */
export default function HoldingsStructureChart({ groups }: HoldingsStructureChartProps) {
  const option = useMemo<EChartsOption>(() => {
    // 横向条形图从下往上画，倒序让第一组显示在最上方
    const ordered = [...groups].reverse()
    const names = ordered.map((g) => `${g.id}. ${g.name}`)
    const weights = ordered.map((g) => +(g.weight * 100).toFixed(2))
    const contribs = ordered.map((g) => +(g.pnlContribution * 100).toFixed(2))

    // 轴范围要同时容纳「正的市值占比」与「有符号的贡献占比」，且必须包含 0
    const hi = Math.max(...weights, ...contribs, 0)
    const lo = Math.min(...contribs, 0)
    const max = Math.max(10, Math.ceil((hi * 1.12) / 5) * 5)
    const min = Math.min(0, Math.floor((lo * 1.12) / 5) * 5)

    return {
      grid: { left: 8, right: 64, top: 44, bottom: 8, containLabel: true },
      legend: legendBase(),
      tooltip: {
        ...tooltipBase(),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(31,58,95,0.05)' } },
        formatter: (params: unknown) => {
          const items = asItems(params)
          const idx = items[0]?.dataIndex ?? 0
          const g = ordered[idx]
          if (!g) return ''
          const be = breakevenOf(g)
          return (
            ttTitle(`${g.id}. ${g.name}`) +
            ttRow(C.total, '市值', `${fmtYuan(g.marketValue)} 元`, `${(g.weight * 100).toFixed(1)}%`) +
            ttRow(
              g.pnl >= 0 ? C.up : C.down,
              '净盈亏',
              `${fmtSignedYuan(g.pnl)} 元`,
              `${(g.pnlContribution * 100).toFixed(1)}% 贡献`,
            ) +
            ttDivider() +
            ttRow(undefined, '该组盈亏率', fmtPct(g.pnlPct * 100)) +
            ttRow(
              undefined,
              be.kind === 'recover' ? '回本需涨' : '可回撤',
              fmtPct(be.pct * 100),
              `${g.count} 只`,
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
        axisLabel: { ...AXIS_LABEL_STYLE, formatter: '{value}%' },
        splitLine: { lineStyle: { color: C.splitLine } },
      },
      yAxis: {
        type: 'category',
        data: names,
        // onZero:false → 类目名贴左边缘。若用默认的 onZero，轴线会落在 x=0 处，
        // 类目名紧贴轴线左侧，正好压在负向条形上。
        axisLine: { onZero: false, lineStyle: { color: C.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: C.axisLabel, fontSize: 11.5 },
      },
      series: [
        {
          name: '市值占比',
          type: 'bar',
          data: weights,
          barWidth: 12,
          barGap: '30%',
          itemStyle: { color: C.total, borderRadius: [0, 2, 2, 0] },
          label: {
            show: true,
            position: 'right',
            formatter: '{c}%',
            color: C.legendText,
            fontSize: 11,
            fontFamily: MONO,
          },
        },
        {
          name: '盈亏贡献',
          type: 'bar',
          barWidth: 12,
          data: ordered.map((g) => {
            const v = +(g.pnlContribution * 100).toFixed(2)
            const color = pnlTextColor(g.pnlContribution)
            return {
              value: v,
              itemStyle: {
                color,
                // 负值条形从 0 向左长，圆角在左端；正值反之
                borderRadius: v >= 0 ? [0, 2, 2, 0] : [2, 0, 0, 2],
              },
              label: {
                show: true,
                // 标签放在条形外侧：负值的外侧是左，正值是右
                position: v >= 0 ? 'right' : 'left',
                color,
                fontSize: 11,
                fontFamily: MONO,
                formatter: `${v.toFixed(1)}%`,
              },
            }
          }),
          markLine: zeroMarkLine(),
        },
      ],
    }
  }, [groups])

  return (
    <EChart
      option={option}
      height={Math.max(260, groups.length * 46 + 80)}
      ariaLabel="分组市值占比与盈亏贡献占比对比"
    />
  )
}
