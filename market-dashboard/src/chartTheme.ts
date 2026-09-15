/** 金融终端配色（浅色底）。 */
export const C = {
  sh: '#e0a33e',
  sz: '#4a90d9',
  total: '#1f3a5f',
  ma20: '#8e5bb5',
  us10y: '#c0392b',
  cn10y: '#2471a3',
  marginRz: '#c0392b',
  marginRq: '#2471a3',
  /** 图 4：杠杆率（融资余额/流通市值） */
  rzRatio: '#c0392b',
  /** 图 4：换手率（成交额/流通市值） */
  turnoverRatio: '#1f7a5c',
  /** 图 5：科创50 */
  star50: '#8e5bb5',
  /** 图 5：韩国 KOSPI */
  kospi: '#d97706',
  axisLine: '#dfe3e9',
  splitLine: '#eef1f5',
  axisLabel: '#7a8699',
  legendText: '#48566b',
  up: '#d9342b',
  down: '#129c62',
} as const

export const AXIS_LABEL_STYLE = {
  color: C.axisLabel,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

/** 统一的坐标区留白：底部给 dataZoom slider 留位置。 */
export function gridWithZoom(top = 56): Record<string, unknown> {
  return { left: 8, right: 16, top, bottom: 74, containLabel: true }
}

export function legendBase(): Record<string, unknown> {
  return {
    top: 6,
    left: 0,
    itemWidth: 14,
    itemHeight: 8,
    itemGap: 16,
    icon: 'roundRect',
    textStyle: { color: C.legendText, fontSize: 12 },
  }
}

/** inside + slider 双 dataZoom；默认展示尾部区间。 */
export function dataZoomBase(startPercent = 45): Record<string, unknown>[] {
  return [
    {
      type: 'inside',
      start: startPercent,
      end: 100,
      minValueSpan: 15,
      zoomOnMouseWheel: true,
      moveOnMouseMove: true,
    },
    {
      type: 'slider',
      start: startPercent,
      end: 100,
      height: 20,
      bottom: 14,
      borderColor: '#e3e6eb',
      backgroundColor: '#fafbfc',
      fillerColor: 'rgba(31, 58, 95, 0.07)',
      handleStyle: { color: '#1f3a5f', borderColor: '#1f3a5f' },
      moveHandleStyle: { color: '#8e9bb0' },
      dataBackground: {
        lineStyle: { color: '#c3cbd8', width: 1 },
        areaStyle: { color: '#e8ecf2' },
      },
      selectedDataBackground: {
        lineStyle: { color: '#5b7ba6', width: 1 },
        areaStyle: { color: 'rgba(31,58,95,0.12)' },
      },
      textStyle: { color: C.axisLabel, fontSize: 10 },
      labelFormatter: (_v: number, s: string) => s,
    },
  ]
}

export function tooltipBase(): Record<string, unknown> {
  return {
    trigger: 'axis',
    axisPointer: {
      type: 'cross',
      lineStyle: { color: '#a9b4c4', width: 1, type: 'dashed' },
      crossStyle: { color: '#a9b4c4', width: 1, type: 'dashed' },
      label: {
        backgroundColor: '#1f3a5f',
        color: '#fff',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      },
    },
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderColor: '#d8dde5',
    borderWidth: 1,
    padding: [10, 12],
    textStyle: { color: '#1f2d3d', fontSize: 12 },
    extraCssText: 'box-shadow: 0 6px 20px rgba(15,30,60,0.12); border-radius: 6px;',
  }
}

export function categoryAxis(dates: string[]): Record<string, unknown> {
  return {
    type: 'category',
    data: dates,
    boundaryGap: false,
    axisLine: { lineStyle: { color: C.axisLine } },
    axisTick: { show: false },
    axisLabel: {
      ...AXIS_LABEL_STYLE,
      hideOverlap: true,
      formatter: (v: string) => (v.length >= 10 ? v.slice(5) : v),
    },
    splitLine: { show: false },
  }
}

export function valueAxis(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'value',
    scale: true,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: AXIS_LABEL_STYLE,
    splitLine: { lineStyle: { color: C.splitLine } },
    ...extra,
  }
}

/* ------------------------------ tooltip HTML ------------------------------ */

export function ttTitle(text: string): string {
  return `<div style="font-weight:600;color:#1f2d3d;margin-bottom:6px;letter-spacing:.2px">${text}</div>`
}

export function ttRow(color: string | undefined, name: string, value: string, extra = ''): string {
  const dot = color
    ? `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${color};margin-right:7px;vertical-align:middle"></span>`
    : '<span style="display:inline-block;width:7px;margin-right:7px"></span>'
  const tail = extra
    ? `<span style="color:#7a8699;margin-left:8px;font-size:11px">${extra}</span>`
    : ''
  return (
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:20px;line-height:1.7">` +
    `<span style="color:#48566b">${dot}${name}</span>` +
    `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;font-weight:600;color:#1f2d3d">${value}${tail}</span>` +
    `</div>`
  )
}

export function ttDivider(): string {
  return `<div style="height:1px;background:#eef1f5;margin:6px 0"></div>`
}

/** 数据点没有值时显示占位，避免出现 "null"。 */
export const TT_EMPTY = '—'

/**
 * 图内文字提示（ECharts graphic 组件）。
 * 某条序列整列都是 null 时，画一张空图比不画更容易误导，所以在图里直接写明「不可用」。
 */
export function graphicNotice(
  text: string,
  place: 'center' | 'topRight' = 'center',
): Record<string, unknown>[] {
  const style = {
    text,
    fill: '#8b96a6',
    fontSize: 12.5,
    lineHeight: 20,
  }
  if (place === 'topRight') {
    return [{ type: 'text', silent: true, z: 100, right: 18, top: 32, style: { ...style, textAlign: 'right' } }]
  }
  return [
    { type: 'text', silent: true, z: 100, left: 'center', top: 'middle', style: { ...style, textAlign: 'center' } },
  ]
}

/** ECharts formatter 回调参数的最小结构（避免依赖内部类型）。 */
export interface TooltipItem {
  seriesName?: string
  color?: string
  dataIndex: number
  value?: unknown
  axisValue?: string
}

export function asItems(params: unknown): TooltipItem[] {
  if (Array.isArray(params)) return params as TooltipItem[]
  if (params && typeof params === 'object') return [params as TooltipItem]
  return []
}

export function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0]
  return null
}
