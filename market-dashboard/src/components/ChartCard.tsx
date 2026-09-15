import type { ReactNode } from 'react'

interface ChartCardProps {
  /** 卡片序号，例如 "图 1" */
  index: string
  title: string
  subtitle?: string
  /** 右上角附加信息，例如单位说明 */
  meta?: ReactNode
  children: ReactNode
}

export default function ChartCard({ index, title, subtitle, meta, children }: ChartCardProps) {
  return (
    <section className="card chart-card">
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
