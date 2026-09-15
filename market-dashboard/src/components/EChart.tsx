import { useEffect, useRef } from 'react'
import * as echarts from '../echarts'
import type { EChartsOption } from 'echarts'

type EChartsInstance = ReturnType<typeof echarts.init>

export interface EChartProps {
  option: EChartsOption
  /** 容器高度，默认 380px */
  height?: number | string
  className?: string
  /** 无障碍/测试用标识 */
  ariaLabel?: string
}

/**
 * ECharts 薄封装：
 * - useRef 持有 DOM 与实例，useEffect 内 init / dispose
 * - 组件卸载时 dispose()，避免内存泄漏与重复初始化
 * - 监听容器尺寸变化（ResizeObserver）与 window resize，调用 chart.resize()
 */
export default function EChart({ option, height = 380, className, ariaLabel }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<EChartsInstance | null>(null)

  // 初始化 / 销毁：只跑一次
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const chart = echarts.init(el, undefined, { renderer: 'canvas' })
    chartRef.current = chart

    const handleResize = () => {
      // 容器可能被隐藏（display:none）导致宽高为 0，此时 resize 无意义
      if (el.clientWidth > 0 && el.clientHeight > 0) chart.resize()
    }

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(handleResize)
      observer.observe(el)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      observer?.disconnect()
      observer = null
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  // 数据 / 配置更新
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setOption(option, true)
    chart.resize()
  }, [option])

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label={ariaLabel}
      style={{ width: '100%', height }}
    />
  )
}
