import { useMemo } from 'react'
import { fmtNum, fmtPct, fmtSignedYuan, fmtYuan, trendClass } from '../format'
import { breakevenOf, dilutedView } from '../holdings'
import type { CashFile, HoldingCell, HoldingQuotesFile, PortfolioTotals } from '../holdings'

interface HoldingsSummaryProps {
  cells: HoldingCell[]
  totals: PortfolioTotals
  quotes: HoldingQuotesFile | null
  /** 账户可用现金。null = 还没维护 cash.json，此时不渲染现金卡（仍是四张竖排卡） */
  cash: CashFile | null
  /** 今日卖出净额（现金流入）。> 0 时在现金卡上说明这笔现金的来源 */
  realizedCash?: number
  /**
   * **累计**已实现盈亏（相对成本，跨全部卖出记录）。null = 从没卖过。
   * 两融券商的「持仓盈亏」是摊薄成本口径 = 我们的浮动盈亏 + 这一块，
   * 所以要在浮动盈亏卡上显式给出，否则拿券商数字对账会永远差一截。
   */
  realizedTotal?: number | null
}

interface Metric {
  key: string
  label: string
  value: string
  unit: string
  hint?: string
  trend?: number | null
  details: { label: string; text: string; trend?: number | null; title?: string }[]
}

/**
 * 持仓总览卡。沿用大盘看板的 `.summary-grid / .summary-card` 样式，保持两屏视觉一致。
 *
 * 约定：`holdings.ts` 里的比率一律是**小数**（-0.185），而 `fmtPct` 收的是**百分数**（-18.5），
 * 所以传给 fmtPct 之前统一 ×100。「距成本」的双向语义由 `breakevenOf` 统一判定。
 *
 * **这里没有「价格口径」卡**：报价时间、快照回退只数、降级原因已经在四处呈现，再占一张卡是重复——
 * 区块标题右侧的 `实时 · 时间` 标签、降级时的黄色提示条、明细表每行的快照小圆点、表格副标题说明。
 * 栅格是 4 列，四张指标卡正好一行，与大盘看板一致。
 *
 * **现金卡与它们同款（小卡）**，排在「持仓市值」之前，占栅格第 1 列。
 * 有现金时卡片是 5 张，所以这里给栅格加 `--five` 变 5 列，仍是一行；
 * 没维护 `cash.json` 时它不出现，退回 4 张 / 4 列。
 */
export default function HoldingsSummary({
  cells,
  totals,
  quotes,
  cash,
  realizedCash = 0,
  realizedTotal = null,
}: HoldingsSummaryProps) {
  const metrics = useMemo<Metric[]>(() => {
    const pnlPct100 = totals.pnlPct * 100
    const todayPct100 = totals.todayPnlPct === null ? null : totals.todayPnlPct * 100
    const be = breakevenOf(totals)

    /**
     * **总盈亏 = 浮动盈亏 + 累计已实现**（券商两融「摊薄成本」口径）。
     *
     * 有卖出记录时，下面那张卡的主数字用这个，不用纯浮动：
     * 纯浮动会**系统性低估亏损**——卖得越多，已实现亏损越多，低估越严重。
     * 而这个是券商 App 上显示的那位，可以直接对账。
     */
    /** 摊薄成本视图（券商两融口径）。从没卖过时为 null，此时卡片退回纯浮动口径 */
    const dv = dilutedView(totals, realizedTotal ?? null)
    const hasRealized = dv !== null
    const realizedVal = realizedTotal ?? 0
    const totalPnl = dv?.totalPnl ?? totals.pnl
    const dilutedCost = dv?.dilutedCost ?? totals.costValue
    const totalPct100 = (dv?.pct ?? totals.pnlPct) * 100
    /** 回本需涨也按摊薄成本算，否则会与主数字自相矛盾（亏 9 万却说只需涨 24%） */
    const beKind: 'recover' | 'cushion' = dv
      ? dv.breakevenPct > 0
        ? 'recover'
        : 'cushion'
      : be.kind
    const bePct = dv ? Math.abs(dv.breakevenPct) : be.pct
    /**
     * 账户总值 = 持仓市值 + 可用现金。
     * 没维护现金时为 null —— 此时「总仓位」无从计算（不知道现金多少，就不能说有多满）。
     */
    const accountValue =
      cash && Number.isFinite(cash.balance) ? totals.marketValue + cash.balance : null

    /**
     * 可用现金（通栏）。只在 cash.json 存在且余额有效时渲染。
     *
     * ⚠️ 现金**不并进市值/浮动盈亏**——并进去的话，账户里原有的现金会被当成利润
     * （盈亏 = 总值 − 总投入，而总投入里没有对应的期初本金科目）。所以它只在这里展示，
     * 外加作为「今日盈亏率」的分母使用（见 holdings.ts 的 portfolioTotals）。
     */
    const cashCard: Metric[] =
      cash && Number.isFinite(cash.balance)
        ? [
            {
              key: 'cash',
              label: '可用现金',
              value: fmtYuan(cash.balance),
              unit: '元',
              // 小卡横向空间有限，日期只留月日
              hint: `更新于 ${cash.as_of.slice(5)}`,
              // 现金既不是赚也不是亏，不上红绿
              trend: null,
              details: [
                {
                  label: '账户总值',
                  text: fmtYuan(accountValue ?? totals.marketValue),
                  title: '持仓市值 + 可用现金（资产口径，不是盈亏口径里的那个市值）',
                },
                {
                  label: '占总资产',
                  text: fmtPct(
                    accountValue && accountValue > 0 ? (cash.balance / accountValue) * 100 : 0,
                  ),
                  title:
                    '可用现金 / 账户总值。防守档时这个比例是要盯的数。注意现金不计入浮动盈亏 —— 并进去会让账户里原有的现金被算成利润',
                },
                ...(realizedCash > 0
                  ? [
                      {
                        label: '今日卖出',
                        text: `+${fmtYuan(realizedCash)}`,
                        title: '今日卖出所得净额，已经包含在上面的可用现金里',
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []

    return [
      ...cashCard,
      {
        key: 'mv',
        label: '持仓市值',
        value: fmtYuan(totals.marketValue),
        unit: '元',
        hint: `${totals.count} 只`,
        trend: totals.todayPnl,
        details: [
          {
            label: '今日盈亏',
            text: totals.todayPnl === null ? '—' : `${fmtSignedYuan(totals.todayPnl)} 元`,
            trend: totals.todayPnl,
            title:
              '按现价相对昨收计算。**减仓标的含当日卖出部分的已实现盈亏**（券商当日累计口径：' +
              '卖了的那部分今天也产生了盈亏，会计入当日）；清仓标的同样计入。未拿到实时报价的持仓不参与',
          },
          { label: '较持仓成本', text: fmtPct(pnlPct100), trend: totals.pnl },
          // 总仓位 = 持仓市值 / 账户总值。没维护 cash.json 就算不出来（不知道现金多少
          // 就不能说有多满），此时这一项不显示，而不是假装满仓 100%。
          ...(accountValue !== null && accountValue > 0
            ? [
                {
                  label: '总仓位',
                  text: fmtPct((totals.marketValue / accountValue) * 100),
                  title:
                    `持仓市值 / 账户总值（持仓市值 + 可用现金 ${fmtYuan(cash?.balance ?? 0)}）。` +
                    '与现金卡的「占总资产」互补，两者相加为 100%',
                },
              ]
            : []),
        ],
      },
      {
        key: 'cost',
        label: '持仓成本',
        value: fmtYuan(totals.costValue),
        unit: '元',
        // 成本是既成事实，不随盈亏涨跌上色
        trend: null,
        details: [
          {
            label: beKind === 'recover' ? '回本需涨' : '可回撤',
            // 亏损时带符号（+22.7% 表示还需上涨）；盈利时是「安全垫」，不加正号更自然
            text: beKind === 'recover' ? fmtPct(bePct * 100) : `${fmtNum(bePct * 100, 1)}%`,
            // 中性：需涨/可跌是两个方向的「缺口」，用红绿都会被误读成当日涨跌
            trend: null,
            title: hasRealized
              ? '（摊薄成本额 − 市值）/ 市值：市值涨到这里，加上手上的现金正好等于累计投入本金。' +
                '分母用摊薄成本而不是原成本，才和「总盈亏」那张卡对得上'
              : be.kind === 'recover'
                ? '（成本 − 市值）/ 市值：现有持仓要回到成本价所需要的涨幅'
                : '组合整体已高于成本，这是回到成本前可承受的回撤幅度',
          },
          /**
           * 摊薄成本额 = 持仓成本 − 累计已实现。券商两融卖出后把已实现盈亏摊进剩余持仓的成本价，
           * 所以它的成本比我们的高（亏着卖 → 成本被摊高）。「总盈亏」卡的盈亏率用的就是这个分母，
           * 放在这里是为了让那个率可以被复算，不变成黑箱。
           */
          ...(hasRealized
            ? [
                {
                  label: '摊薄后',
                  text: fmtYuan(dilutedCost),
                  title:
                    '券商两融口径的持仓成本额 = 持仓成本 − 累计已实现。' +
                    '卖出亏损会把它摊高，卖出盈利会摊低。' +
                    '市值涨到这个数 + 手上的现金 = 累计投入本金（真正回本）',
                },
              ]
            : []),
          {
            label: '亏损 / 盈利',
            text: `${totals.losers} / ${totals.winners} 只`,
          },
        ],
      },
      {
        key: 'pnl',
        /**
         * 主数字用「总盈亏」（浮动 + 累计已实现），浮动那块降级到明细里。
         * 见上面 `hasRealized` 处的说明：纯浮动会系统性低估亏损。
         */
        label: hasRealized ? '总盈亏' : '浮动盈亏',
        value: fmtSignedYuan(hasRealized ? totalPnl : totals.pnl),
        unit: '元',
        hint: hasRealized ? '含已实现' : undefined,
        trend: hasRealized ? totalPnl : totals.pnl,
        details: [
          {
            label: '盈亏率',
            text: fmtPct(hasRealized ? totalPct100 : pnlPct100),
            trend: hasRealized ? totalPnl : totals.pnl,
            title: hasRealized
              ? `总盈亏 / 摊薄成本额（${fmtYuan(dilutedCost)}）。券商两融口径：卖出把已实现盈亏` +
                '摊进剩余持仓的成本价，所以它 = 持仓成本 − 累计已实现。' +
                '这个率与券商 App 上的持仓盈亏率同源，可以直接对'
              : '浮动盈亏 / 持仓成本',
          },
          ...(hasRealized
            ? [
                {
                  label: '其中浮动',
                  text: fmtSignedYuan(totals.pnl),
                  trend: totals.pnl,
                  title: '当前还持有的份额，按原成本价算的浮动盈亏（不含已卖出的部分）',
                },
                {
                  label: '其中已实现',
                  text: fmtSignedYuan(realizedVal),
                  trend: realizedVal,
                  title:
                    '累计卖出相对成本的盈亏（含费）。券商把它摊进了剩余持仓的成本价，' +
                    '所以这笔钱已经体现为成本变高，不会再单独出现在券商的持仓盈亏里',
                },
              ]
            : []),
          {
            label: '最大亏损',
            text: totals.worst ? `${totals.worst.name} ${fmtSignedYuan(totals.worst.pnl)}` : '—',
            trend: totals.worst ? totals.worst.pnl : null,
            title: totals.worst
              ? `${totals.worst.name}（${totals.worst.code}）浮动盈亏 ${fmtSignedYuan(totals.worst.pnl)} 元`
              : '当前没有亏损中的持仓',
          },
          // 全仓皆亏时「最大盈利 —」只是噪音，这一行仅在真有盈利持仓时出现
          ...(totals.best
            ? [
                {
                  label: '最大盈利',
                  text: `${totals.best.name} ${fmtSignedYuan(totals.best.pnl)}`,
                  trend: totals.best.pnl,
                  title: `${totals.best.name}（${totals.best.code}）浮动盈亏 ${fmtSignedYuan(totals.best.pnl)} 元`,
                },
              ]
            : []),
        ],
      },
      {
        key: 'today',
        label: '今日盈亏',
        value: totals.todayPnl === null ? '—' : fmtSignedYuan(totals.todayPnl),
        unit: '元',
        trend: totals.todayPnl,
        hint: quotes ? quotes.session.label : undefined,
        details: [
          {
            label: '较昨收',
            text: fmtPct(todayPct100),
            trend: totals.todayPnl,
            title: '今日盈亏 / 昨收市值（除期初），与券商口径一致，也与图 3 记录的当日收益率同式',
          },
          {
            label: '涨 / 跌',
            text: `${cells.filter((c) => (c.chgPct ?? 0) > 0).length} / ${
              cells.filter((c) => (c.chgPct ?? 0) < 0).length
            } 只`,
          },
        ],
      },
    ]
  }, [cells, totals, quotes, cash, realizedCash, realizedTotal])

  return (
    // 有现金卡时是 5 张，用 5 列栅格让它们仍然排成一行；
    // 没维护 cash.json 就退回 4 张、4 列（与大盘看板一致）。
    <div className={`summary-grid${metrics.length > 4 ? ' summary-grid--five' : ''}`}>
      {metrics.map((m) => (
        <article className="card summary-card" key={m.key}>
          <div className="summary-card__label">
            {m.label}
            {m.hint ? <span className="summary-card__hint">{m.hint}</span> : null}
          </div>
          <div className={`summary-card__value num ${trendClass(m.trend)}`}>
            <span className="summary-card__number">{m.value}</span>
            {m.unit ? <span className="summary-card__unit">{m.unit}</span> : null}
          </div>
          <dl className="summary-card__details">
            {m.details.map((d) => (
              <div className="summary-card__detail" key={d.label}>
                <dt>{d.label}</dt>
                <dd className={`num ${trendClass(d.trend)}`} title={d.title}>
                  {d.text}
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  )
}
