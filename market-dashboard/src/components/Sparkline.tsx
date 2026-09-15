import { useMemo } from 'react'
import { fmtPct } from '../format'
import type { SparkSeries } from '../types'

/**
 * 迷你图固定高度（px）。必须 ≤ 数值行的高度（22px 字号 × 1.2 行高 ≈ 26px），
 * 否则会把卡片撑高——这是「加迷你图不改变卡片尺寸」的关键约束。
 */
export const SPARK_HEIGHT = 20

/** viewBox 宽度：配合 preserveAspectRatio="none" 横向拉伸到容器宽度。 */
const VB_W = 100

/**
 * 内联 SVG 迷你日内走势。
 * 不用 ECharts：A50/KOSPI/KOSDAQ 三个小图各起一个实例太重，30s 刷新还会频繁重建。
 *
 * - 高 20px、宽自适应，放在数值行右侧，不参与撑高卡片
 * - 末值 ≥ base → 红，否则绿（A 股习惯）；1px 线（non-scaling-stroke）+ 极淡同色面积
 * - hover 用原生 <title> 显示口径与区间涨跌幅，例如「A50 分时 17:01→21:39  +0.28%」
 */
export default function Sparkline({ series, name }: { series: SparkSeries; name: string }) {
  const { line, area, up, title } = useMemo(() => {
    const vals = series.points
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = max - min || 1
    const n = vals.length
    // 左右/上下各留 1（viewBox 单位）给 1px 描边，避免贴边被裁掉
    const x = (i: number) => 0.5 + (i * (VB_W - 1)) / (n - 1)
    const y = (v: number) => 1 + (1 - (v - min) / span) * (SPARK_HEIGHT - 2)

    const pts = vals.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`)
    const base = series.base ?? vals[0]
    const last = vals[n - 1]
    const pct = base === 0 ? null : ((last - base) / base) * 100
    const range = `${series.from ?? '—'}→${series.to ?? '—'}`

    return {
      line: pts.join(' '),
      area: `${x(0).toFixed(2)},${SPARK_HEIGHT - 1} ${pts.join(' ')} ${x(n - 1).toFixed(2)},${SPARK_HEIGHT - 1}`,
      up: last >= base,
      title: `${name} 分时 ${range}  ${fmtPct(pct)}`,
    }
  }, [series, name])

  return (
    <svg
      className={`live-spark ${up ? 'live-spark--up' : 'live-spark--down'}`}
      viewBox={`0 0 ${VB_W} ${SPARK_HEIGHT}`}
      height={SPARK_HEIGHT}
      preserveAspectRatio="none"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <polygon points={area} fill="currentColor" fillOpacity="0.12" stroke="none" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
