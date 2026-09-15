# 大盘看板（A 股）

一个 React + Vite + ECharts 的本地看板：**实时面板 + 5 张折线图**，跟踪量能、利率、杠杆与跨市场联动。

## 快速开始

```bash
cd market-dashboard
npm install
npm run dev        # 开发服务器 → http://127.0.0.1:5183
npm run build      # 类型检查（tsc --noEmit）+ 构建到 dist/
npm run preview    # 预览构建产物（同样绑定 127.0.0.1:5183，strictPort）
npm run typecheck  # 只做类型检查
```

端口固定在 **5183**（见 `vite.config.ts`，`strictPort: true`），不会因占用而漂移。

> **实时面板需要服务端**：`/api/spot` 由 Vite 插件在本地代理新浪接口（浏览器直连会被 CORS 挡）。
> 所以实时数据在 `npm run dev` / `npm run preview` 下可用；把 `dist/` 静态托管到别处（无 Node 服务）时，
> 实时面板会**降级成一条提示**，五张历史图不受影响。

## 看什么

**顶部实时面板**（每 30 秒自动刷新，可暂停）：两市成交额（含沪/深/北证50 分项）、富时中国 A50 期货、韩国 KOSPI、**纳指期货（NQ）**，各带自己报价时点与「盘前 / 交易中 / 午间休市 / 已收盘」状态；**A50 / KOSPI / NQ 三张卡片的数值右侧有一条内联 SVG 迷你分时图**（高 20px，末值 ≥ 昨结→红、否则绿，hover 显示「A50 分时 17:01→21:43 +0.31%」这样的口径与区间涨跌幅）。

`GET /api/spot` 的返回契约（**任一子项抓取失败 → 该项置 `null`、原因写入 `errors`，接口始终 200**）：

```json
{
  "ts": "2026-09-15 21:44:05",
  "session": { "state": "closed", "label": "已收盘" },
  "cn": { "sh": 7639.8, "sz": 8487.3, "total": 16127.1, "bj50": 126.5,
          "indices": [{ "name": "上证指数", "code": "sh000001", "price": 3864.28, "chg_pct": -0.54 }] },
  "a50": { "price": 14315.8, "chg_pct": 0.31, "time": "21:44:01" },
  "nq":  { "price": 29132.2, "chg_pct": -0.07, "time": "21:44:05" },
  "korea": { "kospi": { "name": "韩国KOSPI指数", "price": 6627.26, "chg_pct": -0.85, "time": "14:32:30" },
             "kosdaq": { "name": "韩国高斯达克指数", "price": 812.41, "chg_pct": 0.7, "time": "14:33:00" } },
  "spark": {
    "a50":    { "points": [14274.33, "…"], "times": ["17:01", "…"], "base": 14271, "from": "17:01", "to": "21:43" },
    "nq":     { "points": [29174.76, "…"], "times": ["06:01", "…"], "base": 29152.25, "from": "06:01", "to": "21:43" },
    "kospi":  { "points": [6674.31, "…"], "times": ["08:00", "…"], "base": 6684.37, "from": "08:00", "to": "14:30" },
    "kosdaq": { "points": [808.3, "…"], "times": ["08:00", "…"], "base": 806.79, "from": "08:00", "to": "14:30" }
  },
  "errors": []
}
```

金额（`cn.sh/sz/total/bj50`）单位统一是**亿元**，保留 1 位小数；涨跌幅单位 **%**。
`spark.*` 各序列**等距抽稀到 ≤120 点**（保留首尾）；`points.length < 2` 时前端不渲染迷你图。
`korea.kosdaq` 与 `spark.kosdaq` **保留在 payload 里但面板不渲染**（KOSDAQ 缺共同因子，面板位置让给纳指期货；想恢复只改 `LiveStrip.tsx` 一行）。

| 图 | 序列 | 用途 |
|---|---|---|
| **图 1 两市总成交额** | `turnover_total` + 20 日均线 | **量能**：显著高于均量=放量（趋势可信度高）；持续低于均量=缩量（反弹缺增量、破位易阴跌） |
| **图 2 国际市场联动** | `us10y`、`cn10y` + 美中利差(bp) | 全球贴现率方向：美债上行压估值，利差走阔对应人民币与外资压力 |
| **图 3 融资融券** | `margin_rz`（左轴）、`margin_rq`（右轴） | **杠杆绝对水平**：融资余额升=加杠杆；融券量级小两个数量级，故双轴 |
| **图 4 杠杆率与换手率** | `margin_rz_ratio`、`turnover_ratio` | **规模归一后的拥挤度**：融资余额/流通市值（杠杆率）、成交额/流通市值（换手率）——绝对值会被市值增长稀释，比率才能跨时间比较 |
| **图 5 跨市场科技情绪** | `star50`、`kospi`（起点=100 归一） | 韩国是 A 股半导体/算力的**第一顺位跨市场读数**（韩国 08:00 开盘、领先 A 股约 1.5 小时）；两条线的**背离**＝ A 股科技相对强弱的独立信号 |

图表区是**两列网格**：图 1｜图 2、图 3｜图 4 各一行，**图 5 跨两列**（`grid-column: span 2`）；窗口 < 1080px 时全部回落为单列。同一行的两张卡片等高（`align-items: stretch`）；ECharts 由 `ResizeObserver` 观察容器宽度自动 `resize()`，并排变窄不会拉伸或裁切。

任一序列整列为 `null` 时**不画空线**，而是在**图内写明该序列不可用**（单条缺失 → 右上角；两条都缺 → 正中，用 ECharts `graphic` 文字，已在 `src/echarts.ts` 注册 `GraphicComponent`）。

## 数据来源与口径

数据由 `scripts/export_data.py` 生成，全部按 **A 股交易日**对齐（约 250 个交易日 / 一年）：

| 字段 | 来源 | 口径 |
|---|---|---|
| `turnover_sh/sz/total` | 上交所 `stock_sse_deal_daily` + 深交所 `stock_szse_summary` | **官方日度**，亿元；`total` = 沪+深，**不含北交所** |
| `float_mktcap` | **同一对接口**（`流通市值` 行） | 沪深流通市值合计，亿元 —— 零额外请求 |
| `turnover_ratio` | 派生 | 成交额 / 流通市值 × 100（%），全市场换手率 |
| `us10y` / `cn10y` | 新浪全球国债 `US10YT` / `CN10YT` | %；海外休市日**前值填充** |
| `margin_rz/rq/total` | akshare `macro_china_market_margin_sh` + `_sz` | 亿元，**沪深两市**；T+1 公布，**最新一日常为 null** |
| `margin_rz_ratio` | 派生 | 融资余额 / 流通市值 × 100（%），杠杆率 |
| `kospi` | 新浪 `index_global_hist_sina("首尔综合指数")` | 点；韩国休市日（8/250 天）前值填充 |
| `star50` | 腾讯日 K（`sh000688`） | 点 |

实时面板（`/api/spot`）走新浪：沪深北证 50 成交额取 **`hq.sinajs.cn` 全量字段 [9]（元）**；A50 取 `hf_CHA50CFD`、纳指期货取 `hf_NQ`（两者字段序一致：`[0]最新 [6]时间 [7]昨结`）；韩国取 `b_KOSPI`/`b_KOSDAQ`（涨跌幅直接用 `[3]`）。迷你图分时另走两条：期货 `GlobalFuturesService.getGlobalFuturesMinLine?symbol=CHA50CFD|NQ`（JSONP，**表头行 [1] = 昨结**，数据行 `[0]=HH:MM [1]=价`），韩国 `gi.finance.sina.com.cn/hq/min`（`[0]=HH:MM [1]=价`，**昨收只在首行 [5]**）。

### 为什么成交额要逐日抓

akshare 里**没有**现成的「两市成交额历史序列」：东财 K 线（`stock_zh_index_daily_em`）在本机被代理拦截，新浪/腾讯的指数日 K **只有成交量、没有成交额**（`stock_zh_index_daily_tx` 的 `amount` 列其实是手数）。所以只能按交易日逐日调官方接口——250 天约 **50 秒**，脚本带缓存（`scripts/.turnover_cache.json`，存 4 元组：沪/深成交额 + 沪/深流通市值），**重复运行只补缺失日期**。

### 刷新数据

```bash
# 必须用带 akshare 的解释器（本机为 ashare-data skill 的 venv）
/Users/xueancao/Projects/QoderProjects/agents-silky/skills/ashare-data/.venv/bin/python scripts/export_data.py --days 250
python3 scripts/validate_data.py      # 校验字段与派生比率（含量级区间检查）
```

`--days` 可换窗口长度（如 `--days 60`）。生成后刷新页面即可。

## 数据字段（`public/data.json`）

```json
{
  "generated_at": "2026-09-15 21:40 CST",
  "sources": "……",
  "range": { "start": "2025-09-04", "end": "2026-09-15", "trading_days": 250 },
  "rows": [
    {
      "date": "2026-09-15",
      "turnover_sh": 7648.4, "turnover_sz": 8494.6, "turnover_total": 16143.0,
      "float_mktcap": 971982.4, "turnover_ratio": 1.661,
      "us10y": 4.9829, "cn10y": 1.686,
      "margin_rz": null, "margin_rq": null, "margin_total": null, "margin_rz_ratio": null,
      "kospi": 6627.26, "star50": 1551.96
    }
  ]
}
```

**任何字段都可能是 `null`**（节假日、T+1 未公布、接口临时失败），前端图表需容忍。

## 项目结构

```
market-dashboard/
├── public/data.json            # 看板数据（由脚本生成）
├── plugin/localApi.ts          # 本地实时接口插件（/api/spot：快照 + 分时；dev 与 preview 双挂载）
├── scripts/export_data.py      # 数据导出（含成交额/流通市值逐日缓存）
├── scripts/validate_data.py    # 数据契约校验
└── src/
    ├── components/LiveStrip.tsx              # 实时面板（30s 自动刷新 / 可暂停）
    ├── components/Sparkline.tsx              # 卡片内的内联 SVG 迷你分时图
    ├── components/TurnoverChart.tsx          # 图 1 两市总成交额
    ├── components/YieldChart.tsx             # 图 2 国际市场联动（国债收益率）
    ├── components/MarginChart.tsx            # 图 3 融资融券
    ├── components/LeverageTurnoverChart.tsx  # 图 4 杠杆率与换手率
    └── components/CrossMarketChart.tsx       # 图 5 跨市场科技情绪（科创50 vs KOSPI）
```

## 边界与已知限制

- **北交所未纳入成交额历史**（口径为沪深两市）；实时面板里用「北证50」单列。
- **两融是沪深合计且 T+1**：当天收盘后当晚才公布，所以最新交易日的两融通常为空（图 3/4 会少一个点，属正常）。
- **A50 / 纳指期货没有历史序列**：`futures_global_hist_em` 走 `push2his`，本机代理连不上——两者只在实时面板出现（现价 + 日内迷你图），这符合它们的用途（夜盘/盘前的**当下读数**，不是历史线）。
- **面板上的跨市场科技读数用纳指期货（NQ）而不是 KOSDAQ**：KOSDAQ 是韩国本土中小成长股、与 A 股半导体/算力缺共同因子；NQ 是全球科技风险偏好的锚且近 24 小时连续交易（实测分时 06:01→21:43，而韩国 14:30 就定格）。KOSDAQ 数据仍在 payload 里，未渲染。
- **KOSDAQ 没有历史序列**：新浪全球指数符号表只有「首尔综合指数」，KOSDAQ 仅实时。
- **国债收益率没有盘中实时**（本地接口均为 EOD）。
- **东财系接口在本机间歇性被代理拦截**（`push2his` / `push2` 等）：所以 KOSPI 历史优先走新浪；若某次生成数据时某列整体为空，先看该列的日志行用了哪个源。
- 数据为第三方接口，**仅供研究**。
