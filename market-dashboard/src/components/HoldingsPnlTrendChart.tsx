import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import {
  AXIS_LABEL_STYLE,
  C,
  TT_EMPTY,
  asItems,
  categoryAxis,
  graphicNotice,
  legendBase,
  tooltipBase,
  ttDivider,
  ttRow,
  ttTitle,
  valueAxis,
  zeroMarkLine,
} from '../chartTheme'
import { fmtInt, fmtPct, fmtSignedYuan, fmtYuan } from '../format'
import { TREND_MEANINGFUL_DAYS } from '../holdingsHistory'
import type { PnlDay } from '../holdingsHistory'

interface HoldingsPnlTrendChartProps {
  /** 已记录的交易日（升序）。少于 MIN_TREND_DAYS 时画不出走势，只显示引导。 */
  days: PnlDay[]
}

/** 去掉 null，供量程计算使用。 */
function nums(arr: (number | null)[]): number[] {
  return arr.filter((v): v is number => v !== null && Number.isFinite(v))
}

/**
 * 图 1：账户收益走势（**账户级汇总，不含逐只**）。
 *
 * **两条折线、双轴**，都是**当日**口径：
 *   - 左轴 日收益金额（元）   ← `day_pnl`
 *   - 右轴 日收益率（%）     ← `day_pnl_pct`，分母是**昨收市值**
 *
 * ⚠️ 与「累计浮动盈亏 / 累计收益率」不同，这两个口径**不严格成比例** ——
 * 后者的分母是固定成本（`收益率 ≡ 金额 ÷ 成本`），而日收益率的分母每天不同。
 * 所以两条线可以真正分叉：同样赚 1 万元，仓位缩水的那天收益率更高。
 * 用「实线 + 面积（金额）/ 虚线 + 空心圈（收益率）」在重叠时也能看出是两条。
 *
 * 数据来自 `holdings-history.json` —— 每天收盘后由 `scripts/record_holdings_snapshot.py`
 * 追加一笔。**这份序列只记录、不回填**：账户真实盈亏无法从当前持仓反推
 * （份额是分批买入的），所以曲线从「开始记录那天」起才有值。
 *
 * 因此天数不足时这里渲染的是**引导**而不是空图 —— 空图比没有图更容易误导。
 */
export default function HoldingsPnlTrendChart({ days }: HoldingsPnlTrendChartProps) {
  const option = useMemo<EChartsOption>(() => {
    // ⚠️ 必须先挡空数据：Hooks 规则要求 useMemo 无条件执行，而下面的「无记录」早退
    // 只能在它之后，所以空数组会走到这里 —— 不挡就是 `days[-1].day_pnl` 崩溃。
    if (days.length === 0) return {}

    const dates = days.map((d) => d.date)
    const amounts: (number | null)[] = days.map((d) => d.day_pnl)
    const pcts: (number | null)[] = days.map((d) =>
      d.day_pnl_pct === null ? null : d.day_pnl_pct * 100,
    )
    const aVals = nums(amounts)
    const pVals = nums(pcts)
    const noData = aVals.length === 0 && pVals.length === 0

    const single = days.length === 1
    const a0 = aVals[0] ?? 0
    const p0 = pVals[0] ?? 0
    const amountPad = Math.max(Math.abs(a0) * 0.15, 1000)
    const pctPad = Math.max(Math.abs(p0) * 0.15, 0.5)
    const amountRange = single && !noData ? { min: a0 - amountPad, max: a0 + amountPad } : {}
    const pctRange = single && !noData ? { min: p0 - pctPad, max: p0 + pctPad } : {}

    return {
      grid: { left: 8, right: 18, top: 44, bottom: 8, containLabel: true },
      legend: { ...legendBase(), data: ['日收益金额', '日收益率'] },
      graphic: noData
        ? graphicNotice('还没有可画的当日盈亏\n（首个记录日没有前收可比，需要至少两笔记录）')
        : undefined,
      tooltip: {
        ...tooltipBase(),
        trigger: 'axis',
        formatter: (params: unknown) => {
          const items = asItems(params)
          const idx = items[0]?.dataIndex ?? 0
          const d = days[idx]
          if (!d) return ''
          const rows = [
            ttRow(
              C.pnlTrendAmount,
              '日收益金额',
              d.day_pnl === null ? TT_EMPTY : `${fmtSignedYuan(d.day_pnl)} 元`,
            ),
            ttRow(
              C.pnlTrendPct,
              '日收益率',
              d.day_pnl_pct === null ? TT_EMPTY : fmtPct(d.day_pnl_pct * 100),
            ),
            ttDivider(),
            ttRow(undefined, '收盘市值', `${fmtYuan(d.market_value)} 元`),
            ttRow(undefined, '累计浮动盈亏', `${fmtSignedYuan(d.pnl)} 元`, fmtPct(d.pnl_pct * 100)),
            ttRow(undefined, '持仓成本', `${fmtYuan(d.cost)} 元`),
          ]
          return ttTitle(d.date) + rows.join('')
        },
      },
      xAxis: categoryAxis(dates),
      yAxis: [
        valueAxis({
          ...amountRange,
          axisLabel: {
            ...AXIS_LABEL_STYLE,
            // 刻度直接用**元**（千分位整数），不折成「万」：日盈亏的量级本来就在千元上下，
            // 「0.62万」既多一次心算、又和 tooltip 里的「+6,210.29 元」对不上。
            formatter: (v: number) => `${fmtInt(v)}元`,
          },
        }),
        valueAxis({
          ...pctRange,
          // 右轴不画网格线：两条线共用同一套横向参考线就够了，画两遍会显得密
          splitLine: { show: false },
          // toFixed(2) 再转回数字：抹掉浮点尾数（−18.600000000000001），同时保留两位小数
          axisLabel: { ...AXIS_LABEL_STYLE, formatter: (v: number) => `${Number(v.toFixed(2))}%` },
        }),
      ],
      series: [
        {
          name: '日收益金额',
          type: 'line',
          yAxisIndex: 0,
          data: amounts,
          connectNulls: false,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: single ? 10 : 6,
          lineStyle: { width: 2.5, color: C.pnlTrendAmount },
          itemStyle: { color: C.pnlTrendAmount },
          // 显式 origin: 0 —— 日盈亏有正有负、0 必在量程内，填到 0 轴才是「盈在线上、亏在线下」
          // 的读法。留默认 'auto' 会随量程解释，太隐晦。
          areaStyle: { color: `${C.pnlTrendAmount}14`, origin: 0 },
          markLine: zeroMarkLine('y'),
          z: 2,
        },
        {
          name: '日收益率',
          type: 'line',
          yAxisIndex: 1,
          data: pcts,
          connectNulls: false,
          // 空心圈 + 虚线：与金额线重叠时仍能看出是两条线（实线被空心圈套住）
          symbol: 'emptyCircle',
          symbolSize: single ? 15 : 10,
          lineStyle: { width: 2, color: C.pnlTrendPct, type: 'dashed' },
          itemStyle: { color: C.pnlTrendPct, borderWidth: 2 },
          z: 3,
        },
      ],
    }
  }, [days])

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

  const last = days[days.length - 1]

  return (
    <>
      <div className="trend-toolbar">
        <span className="trend-toolbar__meta muted">
          已记录 {days.length} 个交易日 · {days[0].date} ~ {last.date}
        </span>
      </div>
      <EChart option={option} height={320} ariaLabel="账户日收益走势（日收益金额与日收益率双轴）" />
      <p className="trend-note muted">
        账户级汇总，不含逐只；每个点是一天收盘后的<strong>当日</strong>盈亏（不是累计）。当前最后一笔：日收益{' '}
        <strong>{last.day_pnl === null ? TT_EMPTY : `${fmtSignedYuan(last.day_pnl)} 元`}</strong> /{' '}
        <strong>{last.day_pnl_pct === null ? TT_EMPTY : fmtPct(last.day_pnl_pct * 100)}</strong>。
        左轴是日收益金额（元），右轴是日收益率（%）。日收益率的分母是<strong>昨收市值</strong>（每天不同），
        所以两条线不严格成比例、可以真正分叉 —— 同样赚 1 万元，仓位缩水的那天收益率会更高。
        点图例可只看其中一条。
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
