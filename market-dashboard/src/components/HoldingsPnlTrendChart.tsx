import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import {
  AXIS_LABEL_STYLE,
  asItems,
  categoryAxis,
  pnlTextColor,
  tooltipBase,
  ttDivider,
  ttRow,
  ttTitle,
  valueAxis,
  zeroMarkLine,
} from '../chartTheme'
import { fmtNum, fmtPct, fmtSignedYuan, fmtYuan } from '../format'
import { TREND_MEANINGFUL_DAYS } from '../holdingsHistory'
import type { PnlDay } from '../holdingsHistory'

interface HoldingsPnlTrendChartProps {
  /** 已记录的交易日（升序）。少于 MIN_TREND_DAYS 时画不出走势，只显示引导。 */
  days: PnlDay[]
}

type Unit = 'amount' | 'pct'

/**
 * 图 3：账户收益走势（**账户级汇总，不含逐只**）。
 *
 * 数据来自 `holdings-history.json` —— 每天收盘后由 `scripts/record_holdings_snapshot.py`
 * 追加一笔。**这份序列只记录、不回填**：账户真实盈亏无法从当前持仓反推
 * （份额是分批买入的），所以曲线从「开始记录那天」起才有值。
 *
 * 因此天数不足时这里渲染的是**引导**而不是空图 —— 空图比没有图更容易误导。
 */
export default function HoldingsPnlTrendChart({ days }: HoldingsPnlTrendChartProps) {
  const [unit, setUnit] = useState<Unit>('amount')

  const option = useMemo<EChartsOption>(() => {
    // ⚠️ 必须先挡空数据：Hooks 规则要求 useMemo 无条件执行，而下面的「无记录」早退
    // 只能在它之后，所以空数组会走到这里 —— 不挡就是 `days[-1].pnl` 崩溃。
    if (days.length === 0) return {}

    const dates = days.map((d) => d.date)
    const values = days.map((d) => (unit === 'amount' ? d.pnl : d.pnl_pct * 100))
    const last = days[days.length - 1]
    // 与页面数字一致：红涨绿跌，按**最后一个点**的方向取色（即当前盈亏方向）
    const lineColor = pnlTextColor(unit === 'amount' ? last.pnl : last.pnl_pct)

    // 只有一个点时，ECharts 会把 value 轴撑得很宽（实测 −8.2万 撑成 −4万~−14万），
    // 一个点落在大片空白里像没画完。单点没有趋势可言，量程本来就该围绕这个值取，
    // 所以显式收紧到 ±15%，并把点画大一点。多点的量程交给 ECharts（scale: true）自动定。
    const single = days.length === 1
    const v0 = values[0]
    const pad = Math.max(Math.abs(v0) * 0.15, unit === 'amount' ? 1000 : 0.5)
    const yRange = single ? { min: v0 - pad, max: v0 + pad } : {}

    return {
      grid: { left: 8, right: 18, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltipBase(),
        trigger: 'axis',
        formatter: (params: unknown) => {
          const items = asItems(params)
          const idx = items[0]?.dataIndex ?? 0
          const d = days[idx]
          if (!d) return ''
          const rows = [
            ttRow(lineColor, unit === 'amount' ? '浮动盈亏' : '收益率',
              unit === 'amount' ? `${fmtSignedYuan(d.pnl)} 元` : fmtPct(d.pnl_pct * 100)),
            ttRow(undefined, '持仓市值', `${fmtYuan(d.market_value)} 元`),
            ttRow(undefined, '持仓成本', `${fmtYuan(d.cost)} 元`),
          ]
          if (d.day_pnl !== null) {
            rows.push(
              ttDivider(),
              ttRow(
                pnlTextColor(d.day_pnl),
                '当日盈亏',
                `${fmtSignedYuan(d.day_pnl)} 元`,
                d.day_pnl_pct !== null ? fmtPct(d.day_pnl_pct * 100) : '',
              ),
            )
          }
          return ttTitle(d.date) + rows.join('')
        },
      },
      xAxis: categoryAxis(dates),
      yAxis: valueAxis({
        ...yRange,
        axisLabel: {
          ...AXIS_LABEL_STYLE,
          formatter: (v: number) => (unit === 'amount' ? `${(v / 10000).toFixed(1)}万` : `${v}%`),
        },
      }),
      series: [
        {
          name: unit === 'amount' ? '浮动盈亏' : '收益率',
          type: 'line',
          data: values,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: single ? 10 : 5,
          lineStyle: { width: 2, color: lineColor },
          itemStyle: { color: lineColor },
          // 默认填充（贴曲线到坐标轴底）而不是 origin:0 —— 盈亏常年远离 0 时，
          // 0 会落在可视范围之外，origin:0 的填充会铺满整幅图、上边界变成图表顶边，容易被误读。
          areaStyle: { color: `${lineColor}1a` },
          markLine: zeroMarkLine('y'),
        },
      ],
    }
  }, [days, unit])

  // 一天都没有：给「怎么开始累积」的引导（此时无点可画）。
  if (days.length === 0) {
    return (
      <div className="trend-empty">
        <p className="trend-empty__title">还没有任何收益记录</p>
        <p className="trend-empty__detail">
          这份曲线只记真实值、不回填（份额是分批买入的，用今天的份额套过去的价格
          会得到一条不存在的曲线）。每天收盘后跑一次即可累积：
        </p>
        <pre className="trend-empty__code">cd market-dashboard && npm run holdings:snapshot</pre>
      </div>
    )
  }

  const last = days[days.length - 1]      // 走到这里 days.length >= 2，必非空

  return (
    <>
      <div className="trend-toolbar">
        <div className="trend-toolbar__units" role="group" aria-label="指标口径">
          {(
            [
              ['amount', '金额（元）'],
              ['pct', '收益率（%）'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn btn--mini ${unit === key ? 'btn--mini-primary' : 'btn--mini-off'}`}
              aria-pressed={unit === key}
              onClick={() => setUnit(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="trend-toolbar__meta muted">
          已记录 {days.length} 个交易日 · {days[0].date} ~ {last.date}
        </span>
      </div>
      <EChart
        option={option}
        height={320}
        ariaLabel={`账户收益走势（${unit === 'amount' ? '金额' : '收益率'}）`}
      />
      <p className="trend-note muted">
        账户级汇总，不含逐只；每个点对应一天收盘后的实际持仓。当前最后一笔：
        {unit === 'amount' ? fmtSignedYuan(last.pnl) : fmtNum(last.pnl_pct * 100, 2)}
        {unit === 'amount' ? ' 元' : '%'}
        {days.length < TREND_MEANINGFUL_DAYS ? (
          <>
            <br />
            目前只有 1 个交易日，还看不出趋势 —— 每天收盘后跑一次{' '}
            <code>npm run holdings:snapshot</code>，或直接 <code>npm start</code>
            （启动时会自动检查补记）即可逐日累积。
          </>
        ) : null}
      </p>
    </>
  )
}
