/**
 * 数据契约：与 public/data.json 一一对应。
 * 任何数值字段都可能是 null（节假日 / 数据缺失），因此全部声明为 `number | null`。
 * 单位：金额 = 亿元，收益率 = %。
 */
export interface MarketRow {
  date: string
  /** 沪市成交额（亿元） */
  turnover_sh: number | null
  /** 深市成交额（亿元） */
  turnover_sz: number | null
  /** 沪深合计成交额（亿元） */
  turnover_total: number | null
  /** 美国 10 年期国债收益率（%） */
  us10y: number | null
  /** 中国 10 年期国债收益率（%） */
  cn10y: number | null
  /** 融资余额（亿元） */
  margin_rz: number | null
  /** 融券余额（亿元） */
  margin_rq: number | null
  /** 两融余额（亿元） */
  margin_total: number | null
}

export interface MarketData {
  generated_at: string
  sources: string
  rows: MarketRow[]
}

/** MarketRow 上所有数值字段的键名。 */
export type NumericKey =
  | 'turnover_sh'
  | 'turnover_sz'
  | 'turnover_total'
  | 'us10y'
  | 'cn10y'
  | 'margin_rz'
  | 'margin_rq'
  | 'margin_total'
