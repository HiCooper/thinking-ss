import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import {
  C,
  AXIS_LABEL_STYLE,
  asItems,
  categoryAxis,
  dataZoomBase,
  gridWithZoom,
  legendBase,
  tooltipBase,
  ttDivider,
  ttRow,
  ttTitle,
  valueAxis,
  zeroMarkLine,
} from '../chartTheme'
import { fmtNum, fmtSigned } from '../format'
import { shortGroupName } from '../groupRs'
import type { GroupRsFile } from '../groupRs'

/**
 * 持仓看板 图 2：**分组相对强弱** —— 每个持仓组相对沪深300 的累计超额收益（%）。
 *
 * 这张图补的是整块看板缺掉的那个维度：其他图回答「今天该不该下场」，
 * 它回答「**该站在哪条腿上**」。实测组间相对强弱的量级常大于指数振幅
 * （2026-09-14 → 09-17 三天：A +4.61% vs D −1.53%，差 6.1pp）。
 *
 * 数据来自 `groups.json`（由 `npm run groups:export` 生成，**本地隐私文件，不入库**）。
 * 缺文件是正常状态，这里渲染引导而不是空图。
 *
 * 空态样式复用账户收益走势那套 `.trend-empty`（它就是本站通用的「怎么把数据搞出来」引导框）。
 */
export default function GroupRsChart({ data, loaded }: { data: GroupRsFile | null; loaded: boolean }) {
  const names = useMemo(() => (data ? data.groups.map(shortGroupName) : []), [data])

  const option = useMemo<EChartsOption>(() => {
    if (!data) return {}
    const { days, groups } = data

    return {
      animationDuration: 420,
      color: C.groupPalette,
      grid: gridWithZoom(56),
      legend: { ...legendBase(), data: names },
      tooltip: {
        ...tooltipBase(),
        formatter: (params: unknown) => {
          const items = asItems(params)
          const idx = items[0]?.dataIndex ?? 0
          const d = days[idx]
          if (d === undefined) return ''
          const rows = groups.map((g, i) => {
            const ex = g.excess[idx]
            const nav = g.nav[idx]
            return ttRow(
              C.groupPalette[i % C.groupPalette.length],
              shortGroupName(g),
              Number.isFinite(ex) ? `${fmtSigned(ex, 2)}pp` : '—',
              Number.isFinite(nav) ? `组净值 ${fmtNum(nav, 4)}` : '',
            )
          })
          // 超额的定义就是「减掉基准」，所以基准自己恒为 0 —— 写出来是为了让 pp 这个单位有落点
          rows.push(
            ttDivider(),
            ttRow(undefined, `基准 ${data.benchmark.name}`, '0.00pp', '超额＝组净值 / 基准净值 − 1'),
          )
          return ttTitle(d) + rows.join('')
        },
      },
      dataZoom: dataZoomBase(55),
      xAxis: categoryAxis(days),
      yAxis: valueAxis({
        scale: true,
        // 不写 `name`：轴名会画在轴的顶端，和最高那根刻度标签叠在一起（实测挡住一半）。
        // 单位改在图下的说明里写全 —— 那里本来就有位置。
        axisLabel: { ...AXIS_LABEL_STYLE, formatter: (v: number) => `${Number(v.toFixed(1))}%` },
      }),
      series: groups.map((g, i) => ({
        name: names[i],
        type: 'line' as const,
        data: g.excess,
        symbol: 'none',
        lineStyle: { width: 2, color: C.groupPalette[i % C.groupPalette.length] },
        itemStyle: { color: C.groupPalette[i % C.groupPalette.length] },
        connectNulls: false,
        // 0 线只画一次：它是「与基准持平」这条共同的参考线
        ...(i === 0 ? { markLine: zeroMarkLine('y') } : {}),
      })),
    } as EChartsOption
  }, [data, names])

  if (!loaded) {
    return <p className="muted">正在读取 groups.json …</p>
  }

  if (!data) {
    return (
      <div className="trend-empty">
        <p className="trend-empty__title">还没有分组相对强弱数据</p>
        <p className="trend-empty__detail">
          这份数据从 <code>holdings.json</code> 的分组派生（组内成员等权归一，再比沪深300），
          在<strong>本地生成、不入库</strong>。跑一次即可：
        </p>
        <pre className="trend-empty__code">cd market-dashboard && npm run groups:export</pre>
      </div>
    )
  }

  const lastIdx = data.days.length - 1
  const excluded = data.groups.reduce((n, g) => n + g.excluded.length, 0)

  return (
    <>
      <div className="chart-legend-note">
        <span className="num">
          窗口 {data.window} 个交易日 · 截至 {data.as_of ?? '—'} · 基准 {data.benchmark.name}
        </span>
        <span className="muted">
          纵轴＝<b>相对基准的累计超额（%）</b>，线在 0 上方＝该组跑赢基准。<b>组间差距才是重点</b>：
          同样一笔钱放在不同组，这段时间的差别就是各条线之间的垂直距离。点图例可只看一组。
          {excluded > 0 ? `　·　${excluded} 只成员因窗口内缺价被剔除` : ''}
        </span>
      </div>
      <EChart option={option} height={340} ariaLabel="分组相对强弱（相对沪深300 的累计超额收益）" />
      <p className="trend-note muted">
        最新超额：
        {data.groups.map((g, i) => (
          <span key={g.id}>
            {i > 0 ? '　·　' : ''}
            <b style={{ color: C.groupPalette[i % C.groupPalette.length] }}>{shortGroupName(g)}</b>{' '}
            {fmtSigned(g.excess[lastIdx], 2)}pp
          </span>
        ))}
      </p>
    </>
  )
}
