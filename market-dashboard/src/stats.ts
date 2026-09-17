/**
 * 历史分位统计（纯前端，零新增取数）。
 *
 * 用途：图 3 / 图 4 的**分位带**，以及摘要卡的**分位角标**。
 *
 * 口径：窗口取「最近 N 个交易日」（默认 250 ≈ 一年），只用非 null 值。
 * 分位用**百分位排名**（小于等于当前值的占比）——「近 1 年 78% 分位」读作
 * 「历史上有 78% 的交易日读数低于或等于今天」，与分位带、中位线的读法一致。
 *
 * 为什么要有它：两融 26,285 亿、换手率 1.876% 这类裸数字**没有位置感** ——
 * 看图只能靠眼睛跟历史比。趋势交易要判断的是「在历史的什么位置、往哪个方向偏离」。
 */

/** 默认窗口：250 个交易日 ≈ 一年。data.json 目前正好 250 行。 */
export const PERCENTILE_WINDOW = 250

/** 样本少于这个数就不给分位 —— 小样本的分位数是噪音，不如不显示。 */
export const MIN_PERCENTILE_SAMPLES = 20

export interface PercentileInfo {
  /** 窗口内有效样本数 */
  n: number
  p20: number
  p50: number
  p80: number
  /** 当前值在窗口内的百分位排名（0~100） */
  rank: number
}

/** 已升序数组的线性插值分位（q ∈ [0,1]）。 */
function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** 序列里最后一个非 null 值（「最新读数」）。 */
export function lastValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

/**
 * 取序列尾部 window 个有效值，算 20 / 50 / 80 分位，以及 `current` 在其中的百分位排名。
 * 样本不足（< `MIN_PERCENTILE_SAMPLES`）或 current 为 null 时返回 null。
 */
export function percentileInfo(
  values: (number | null)[],
  current: number | null,
  window = PERCENTILE_WINDOW,
): PercentileInfo | null {
  if (current === null || !Number.isFinite(current)) return null
  const tail = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .slice(-window)
  if (tail.length < MIN_PERCENTILE_SAMPLES) return null
  const sorted = [...tail].sort((a, b) => a - b)
  // 用「≤ 当前值」的个数：与分位带的读法一致（当前值落在 P80 以上 ⇒ rank ≥ 80）
  let below = 0
  for (const v of sorted) {
    if (v <= current) below++
    else break
  }
  return {
    n: tail.length,
    p20: quantileSorted(sorted, 0.2),
    p50: quantileSorted(sorted, 0.5),
    p80: quantileSorted(sorted, 0.8),
    rank: (below / sorted.length) * 100,
  }
}

/** 便捷入口：直接给「整条序列」，用它的最后一个有效值当 current。 */
export function percentileOfLatest(
  values: (number | null)[],
  window = PERCENTILE_WINDOW,
): PercentileInfo | null {
  return percentileInfo(values, lastValue(values), window)
}
