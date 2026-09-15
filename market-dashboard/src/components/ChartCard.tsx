import type { ReactNode } from 'react'

interface ChartCardProps {
  /** 卡片序号，例如 "图 1" */
  index: string
  title: string
  subtitle?: string
  /** 右上角附加信息，例如单位说明 */
  meta?: ReactNode
  /** 追加到 .chart-card 上的类名，用于两列网格里跨列（chart-card--wide）等布局 */
  className?: string
  children: ReactNode
}

export default function ChartCard({ index, title, subtitle, meta, className, children }: ChartCardProps) {
  return (
    <section className={className ? `card chart-card ${className}` : 'card chart-card'}>
      <header className="chart-card__head">
        <div className="chart-card__title-wrap">
          <h2 className="chart-card__title">
            <span className="chart-card__index">{index}</span>
            {title}
          </h2>
          {subtitle ? <p className="chart-card__subtitle">{subtitle}</p> : null}
        </div>
        {meta ? <div className="chart-card__meta">{meta}</div> : null}
      </header>
      <div className="chart-card__body">{children}</div>
    </section>
  )
}
