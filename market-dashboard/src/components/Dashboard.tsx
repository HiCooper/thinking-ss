import { useMemo } from 'react'
import ChartCard from './ChartCard'
import SummaryCards from './SummaryCards'
import TurnoverChart from './TurnoverChart'
import YieldChart from './YieldChart'
import MarginChart from './MarginChart'
import LeverageTurnoverChart from './LeverageTurnoverChart'
import CrossMarketChart from './CrossMarketChart'
import LiveStrip from './LiveStrip'
import type { MarketData } from '../types'

export default function Dashboard({ data }: { data: MarketData }) {
  const { rows } = data

  const range = useMemo(() => {
    if (rows.length === 0) return ''
    const first = rows[0].date
    const last = rows[rows.length - 1].date
    return first === last ? first : `${first} ~ ${last}`
  }, [rows])

  return (
    <>
      <LiveStrip />

      <SummaryCards rows={rows} />

      {/* 两列网格：图1｜图2 / 图3｜图4，图5 跨两列（归一化对比线宽一点更清楚） */}
      <div className="chart-grid">
        <ChartCard
          index="图 1"
          title="两市总成交额走势"
          subtitle="沪深合计成交额与 20 日均线，用于观察量能趋势与放量/缩量拐点"
          meta={
            <>
              <span className="tag">单位：亿元</span>
              <span className="tag tag--ghost">样本 {rows.length} 个交易日</span>
            </>
          }
        >
          <TurnoverChart rows={rows} />
        </ChartCard>

        <ChartCard
          index="图 2"
          title="国际市场联动（国债收益率）"
          subtitle="美国 10 年期与中国 10 年期国债收益率同轴对比，利差以 bp 计"
          meta={
            <>
              <span className="tag">单位：%</span>
              <span className="tag tag--ghost">利差单位：bp</span>
            </>
          }
        >
          <YieldChart rows={rows} />
        </ChartCard>

        <ChartCard
          index="图 3"
          title="融资融券"
          subtitle="融资余额（左轴）与融券余额（右轴）双轴展示，量级差异大，读数请对应各自坐标轴"
          meta={
            <>
              <span className="tag">双 y 轴</span>
              <span className="tag tag--ghost">单位：亿元</span>
            </>
          }
        >
          <MarginChart rows={rows} />
        </ChartCard>

        <ChartCard
          index="图 4"
          title="杠杆率与换手率"
          subtitle="杠杆率＝融资余额/流通市值，换手率＝成交额/流通市值，都做了规模归一，便于跨时间比较"
          meta={
            <>
              <span className="tag">同一 y 轴 · 单位：%</span>
              <span className="tag tag--ghost">杠杆率高＝拥挤，回落＝去杠杆</span>
            </>
          }
        >
          <LeverageTurnoverChart rows={rows} />
        </ChartCard>

        <ChartCard
          index="图 5"
          title="跨市场科技情绪（科创50 vs 韩国 KOSPI）"
          subtitle="韩国是 A 股半导体/算力的第一顺位跨市场读数；两条线的背离＝A 股科技相对强弱的独立信号"
          className="chart-card--wide"
          meta={
            <>
              <span className="tag">区间起点＝100</span>
              <span className="tag tag--ghost">前端归一化</span>
            </>
          }
        >
          <CrossMarketChart rows={rows} />
        </ChartCard>
      </div>

      <p className="footnote">数据区间：{range || '—'}　·　所有图表均支持滚轮缩放与底部滑块区间选择。</p>
    </>
  )
}
