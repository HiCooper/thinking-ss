/**
 * 每日复盘卡（通栏，摘要卡区的第一张）。
 *
 * 它替代原来的「趋势状态」卡：那张卡的档位、判定依据、市场宽度读数全部搬到这里，
 * 再补上企稳条件进度与观察线 —— 同一张卡同时回答「现在是什么环境」和「离切换还差什么」。
 *
 * 两层内容来源不同，要分清：
 *   - 骨架（档位 / 结论 / 证据 / 条件 / 观察线）由 `src/review.ts` 从 data.json **现算**，
 *     零新增取数、和图 1 共用 `trend.ts`，所以卡与图永远不会各说一套；
 *   - 最后一行「研判」是收盘流程里的 agent 写进 `review-notes.json` 的一句话。
 *     **只有 `as_of` 与本页复盘日是同一天才显示**，否则整行不渲染 ——
 *     数字是现算的、文字是攒下来的，两者错位时宁可空着，也不拿旧句子配今天的读数。
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchReviewNotes } from '../api'
import type { ReviewNote } from '../api'
import { fmtDateCN, fmtInt, fmtNum, fmtSigned, isNum, trendClass } from '../format'
import { reviewOf } from '../review'
import type { MarketRow } from '../types'

/**
 * 研判行下方的小字：把这句话引用的读数和当前算出的读数并排显示。
 * 文件名里的 `refs` 只做溯源记录，显示一律用现算值 —— 这样文字和数字永远同一时点，
 * 也不给「笔记里抄错的数字」上屏的机会。
 */
const REF_ROWS: { key: string; label: string; digits: number }[] = [
  { key: 'hs300', label: '收盘', digits: 2 },
  { key: 'ma20', label: 'MA20', digits: 2 },
  { key: 'turnover', label: '成交', digits: 1 },
  { key: 'leverage', label: '杠杆率', digits: 3 },
]

function refValue(r: ReturnType<typeof reviewOf>, key: string): number | null {
  if (key === 'hs300') return r.trend.close
  if (key === 'ma20') return r.trend.ma20
  if (key === 'turnover') return r.turnover.value
  return r.leverage.value
}

export default function DailyReviewCard({ rows, dataKey }: { rows: MarketRow[]; dataKey: string }) {
  const r = useMemo(() => reviewOf(rows), [rows])
  const [note, setNote] = useState<ReviewNote | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    fetchReviewNotes(ctl.signal)
      .then((list) => {
        const hit = [...list].reverse().find((n) => n.as_of === r.date)
        setNote(hit ?? null)
      })
      .catch(() => {
        /* 取不到就当没写：研判是可选层，缺它不影响骨架 */
      })
    return () => ctl.abort()
    // dataKey 变了说明 data.json 重写，同时可能追加了新研判，一起重取
  }, [dataKey, r.date])

  if (!r.ready) {
    return (
      <article className="card review">
        <header className="review__head">
          <span className="review__title">每日复盘</span>
        </header>
        <p className="review__pending">
          沪深300 的收盘价与 MA20/MA60 或两市成交额尚未同时取得有效值，样本不足以出结论 ——
          此时本卡不给任何判断，只保留这个状态。
        </p>
      </article>
    )
  }

  return (
    <article className="card review">
      <header className="review__head">
        <span className="review__title">每日复盘</span>
        <span className={`review__state num ${trendClass(r.trend.trend)}`}>
          {r.trend.state ?? '—'}
        </span>
        <span className="review__date num" title="本卡所有读数所属的交易日">
          {r.date ? fmtDateCN(r.date) : '—'}
        </span>
        {r.pending ? (
          <span className="review__flag" title={`今日 ${r.latestDate} 的当日 K 线未定稿，故复盘仍停在上一交易日`}>
            今日（{r.latestDate}）盘中 · 未定稿
          </span>
        ) : null}
        <span className="review__spacer" />
        <span className="review__progress num" title="三条企稳条件里已满足的条数（分母只算读数齐全的）">
          企稳 {r.progress}
        </span>
      </header>

      <div className="review__row">
        <span className="review__k">结论</span>
        <span className="review__t">{r.trend.basis}</span>
      </div>

      <div className="review__row">
        <span className="review__k">证据</span>
        <span className="review__t review__ev">
          <span title="两市成交额（交易所官方口径）及其在 250 日窗口里的百分位">
            <b className={`num ${trendClass(r.turnover.diff)}`}>{fmtInt(r.turnover.value)} 亿</b>
            <i>
              成交 · {isNum(r.turnover.rank) ? `${r.turnover.rank.toFixed(1)}% 分位` : '分位样本不足'}
              {isNum(r.turnover.p20) ? `（P20 ${fmtNum(r.turnover.p20, 0)}）` : ''}
            </i>
          </span>
          <span title="全市场涨/跌家数（快照口径，无历史接口，从启用日起逐日累积）；创新高/新低家数">
            <b className="num">
              {fmtInt(r.adv)} / {fmtInt(r.dec)}
            </b>
            <i>
              涨跌家数 · 新高/新低 {fmtInt(r.high20)} / {fmtInt(r.low20)}
            </i>
          </span>
          <span title="融资余额 / 流通市值。两融 T+1 公布，最新一笔可能落后复盘日一个交易日">
            <b className={`num ${trendClass(r.marginRz.diff)}`}>{fmtNum(r.leverage.value, 3)}%</b>
            <i>
              杠杆率 · {isNum(r.leverage.rank) ? `${r.leverage.rank.toFixed(1)}% 分位` : '分位样本不足'}
              {' · 融资环比 '}
              {isNum(r.marginRz.diff) ? `${fmtSigned(r.marginRz.diff, 1)} 亿` : '—'}
              {r.marginRz.date && r.marginRz.date !== r.date ? `（${r.marginRz.date}）` : ''}
            </i>
          </span>
        </span>
      </div>

      <div className="review__row">
        <span className="review__k">条件</span>
        <span className="review__t">
          <span className="review__cond">
            {r.conditions.map((c) => (
              <span key={c.text} title={c.title}>
                <em className={`review__dot${c.met === true ? ' is-met' : c.met === false ? ' is-unmet' : ''}`} />
                {c.text}
              </span>
            ))}
          </span>
          <span className="review__watch" title={`近 20 个有效收盘（不含 ${r.date ?? '复盘日'}）的最低点${r.watch.date ? `，出现在 ${r.watch.date}` : ''}`}>
            减仓观察：{r.watch.text}
            {isNum(r.watch.distPct) ? `（${r.date ?? '复盘日'} 收盘距其 ${fmtNum(Math.abs(r.watch.distPct), 2)}%）` : ''}
          </span>
        </span>
      </div>

      {note ? (
        <div className="review__row is-judge">
          <span className="review__k">研判</span>
          <span className="review__t">
            <span className="review__judge">{note.judgment}</span>
            <span className="review__refs num" title="这句研判引用的读数，按当前数据重算后并排显示（研判文件里的 refs 只作溯源记录）">
              {REF_ROWS.map((x) => {
                const v = refValue(r, x.key)
                return `${x.label} ${isNum(v) ? fmtNum(v, x.digits) : '—'}`
              }).join('｜')}
              {note.written_at ? ` · 写入 ${note.written_at}` : ''}
            </span>
          </span>
        </div>
      ) : (
        <div className="review__row">
          <span className="review__k">研判</span>
          <span className="review__t review__notes-missing">
            未写入 —— 研判只在收盘流程（数据更新 + 校验都通过）里由 agent 追加，直接跑{' '}
            <code>npm run data:refresh</code> 时留空。本次 {r.date ?? '复盘日'} 没有配套研判，此格空着，不拿别的交易日的话配这一天的读数。
          </span>
        </div>
      )}
    </article>
  )
}
