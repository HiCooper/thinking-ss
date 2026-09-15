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
  /** 沪深流通市值合计（亿元） */
  float_mktcap: number | null
  /** 杠杆率 = 融资余额 / 流通市值（%） */
  margin_rz_ratio: number | null
  /** 全市场换手率 = 成交额 / 流通市值（%） */
  turnover_ratio: number | null
  /** 韩国 KOSPI 收盘点位 */
  kospi: number | null
  /** 科创50 收盘点位 */
  star50: number | null
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
  | 'float_mktcap'
  | 'margin_rz_ratio'
  | 'turnover_ratio'
  | 'kospi'
  | 'star50'

/* ------------------------------ /api/spot 实时接口契约 ------------------------------ */

/** 交易时段（按北京时间判断）。 */
export type SessionState = 'pre' | 'open' | 'lunch' | 'closed'

export interface SpotSession {
  state: SessionState
  /** 中文标签：盘前 / 交易中 / 午间休市 / 已收盘 */
  label: string
}

export interface SpotIndex {
  name: string
  code: string
  price: number | null
  chg_pct: number | null
}

export interface SpotCn {
  /** 沪市成交额（亿元） */
  sh: number | null
  /** 深市成交额（亿元） */
  sz: number | null
  /** 沪深合计成交额（亿元，不含北交所） */
  total: number | null
  /** 北证50 成交额（亿元） */
  bj50: number | null
  indices: SpotIndex[]
}

export interface SpotA50 {
  price: number | null
  chg_pct: number | null
  time: string | null
}

export interface SpotKoreaItem {
  name: string
  price: number | null
  chg_pct: number | null
  time: string | null
}

/**
 * 迷你日内走势（下采样到 ≤120 点）。
 * `base` 是当日基准（A50 = 昨结，韩国指数 = 昨收），前端按「末值 ≥ base → 红，否则绿」上色。
 */
export interface SparkSeries {
  points: number[]
  times: string[]
  base: number | null
  from: string | null
  to: string | null
}

export interface SpotSpark {
  a50: SparkSeries | null
  nq: SparkSeries | null
  kospi: SparkSeries | null
  kosdaq: SparkSeries | null
}

/** GET /api/spot 的返回结构。任一子项抓取失败时该项为 null，原因写入 errors。 */
export interface SpotData {
  ts: string
  session: SpotSession
  cn: SpotCn | null
  a50: SpotA50 | null
  /** 纳指期货：与 a50 同形（现价 + 涨跌幅 + 自己的报价时间 + 分时在 spark.nq） */
  nq: SpotA50 | null
  korea: { kospi: SpotKoreaItem | null; kosdaq: SpotKoreaItem | null } | null
  spark: SpotSpark
  errors: string[]
}
