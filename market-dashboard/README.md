# 大盘看板（A 股）

一个 React + Vite + ECharts 的本地看板：**实时面板 + 5 张折线图**，跟踪量能、利率、杠杆与跨市场联动。

## 换一台电脑：一键启动

前置只有一个：**Node `^20.19.0 || >=22.12.0`**（Vite 8 要求，推荐 22 LTS，见 `.nvmrc`）。**不需要 Python** —— 行情数据 `public/data.json` 与两个本地缓存都随仓库提交，开箱即有数据。

```bash
git clone <repo-url> && cd market-dashboard
npm start                      # 首次自动 npm ci 装依赖 → 起服务
```

打开 **http://127.0.0.1:5183**。端口被占就换一个：

```bash
PORT=5190 npm start
```

`npm start` 会依次做三件事：检查 Node 版本 → 缺 `node_modules` 就 `npm ci`（按 `package-lock.json` 精确还原，首次约 20–60 秒）→ 起 dev server。之后启动是秒级。

> **启动不需要 Python、不需要联网**：数据文件在仓库里，`/api/spot` 的实时数据由 Vite 插件在本地代理（无 Node 服务时该面板自动降级为提示，5 张历史图照常）。

### 只有「更新数据」才需要 akshare（可选）

```bash
npm run data:setup                    # 一次性：在项目下建 .venv-data/ 并安装 akshare
npm run data:refresh                  # 增量更新（联网，只抓缓存里没有的日期）
npm run data:refresh -- --offline      # 完全不联网，用仓库里的缓存重建 data.json
```

`scripts/refresh.sh` 按 **`$DASH_PY` → `./.venv-data` → `$SKILLS/ashare-data/.venv` → `python3`** 的顺序找解释器，**无任何硬编码路径**；找不到 akshare 时给的是可操作提示（装环境 / 改用 `--offline`），不是一堆栈。

### 其他命令

```bash
npm run build      # 类型检查（tsc --noEmit）+ 构建到 dist/
npm run preview    # 预览构建产物（同样绑定 PORT，默认 5183）
npm run typecheck  # 只做类型检查
npm run data:validate   # 校验 public/data.json 的字段与派生比率
```

> **实时面板需要服务端**：`/api/spot` 由 Vite 插件在本地代理新浪接口（浏览器直连会被 CORS 挡）。
> 所以实时数据在 `npm run dev` / `npm run preview` 下可用；把 `dist/` 静态托管到别处（无 Node 服务）时，
> 实时面板会**降级成一条提示**，五张历史图不受影响。

## 看什么

**顶部实时面板**（每 30 秒自动刷新，可暂停）：**三张跨市场报价卡** —— 富时中国 A50 期货、韩国 KOSPI、**纳指期货（NQ）**；下方一行是 5 个 A 股指数 chips（上证 / 深成 / 创业板 / 科创50 / 北证50，各带实时价与涨跌幅）。每张报价卡片的排版是「**数值 + 涨跌幅同一行**（涨跌幅紧跟数值），**下一行占满内容宽度的内联 SVG 迷你分时图**」（高 20px，末值 ≥ 昨结→红、否则绿，hover 显示「A50 分时 17:01→21:43 +0.31%」这样的口径与区间涨跌幅）；卡片右上角是各自报价时点，顶部标注「盘前 / 交易中 / 午间休市 / 已收盘」。

> **卡片尺寸不变**（实测）：把涨跌幅并入数值行省掉了一整行，正好抵消迷你图占用的高度 ——
> 1440px 下高度 **Δ0.00**；1080 / 640px 下甚至比加图前略矮（**−2.15px / −1.00px**）。
> 1440px 下这三张卡的高度本就由「两市成交额」卡（含 5 个 chips）在 grid 里撑高，自身内容更矮，故外部高度完全不变。

> **成交额只在一处显示**：顶部摘要卡的「两市成交额」（官方 EOD 口径，带金额日变动）。
> 实时面板原先那张「两市成交额合计」卡已删除 —— 它与摘要卡只差 0.1%（口径差异），
> 盘中又容易被误读（一个是最新官方收盘、一个是今日实时累计），属于重复展示。
> `/api/spot` 仍返回 `cn.total / cn.sh / cn.sz / cn.bj50`，需要时可随时恢复展示。

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

## 数据热更新（跑完数据脚本不用手动 F5）

`GET /api/data-version` 返回 `data.json` 的 `{ "mtime": 1789480340469, "size": 78615 }`（文件不存在 → `{ "mtime": 0, "size": 0 }`，响应带 `Cache-Control: no-store`）。
App 层每 **30s** 轮询它（与实时面板同频）：`mtime`/`size` 一变就重新走 `fetchMarketData('/data.json')`（复用既有解析与 normalize），**静默**换掉图表数据，同时弹一条 2.6s 后淡出的「数据已更新 · 21:52」提示（`position: fixed`，不参与布局、不改任何尺寸）。

闭环：**跑一次 `scripts/export_data.py` → 页面 ≤30s 自己刷新出新图**（实测改写后 27s 生效，还原后 30s 生效）。

- dev 下探测 `public/data.json`；preview 下探测构建产物 `dist/data.json`（页面实际读的那份），缺失时退回 `public/data.json`。
- 静态托管（没有 `/api`）时该接口 404 → 前端**静默忽略**：不弹错误、不影响图表、不打断任何轮询；页面上的手动「重新加载」按钮照旧可用。

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

### 更新数据（**增量，一条命令**）

```bash
npm run data:refresh                # 增量更新（默认 250 个交易日窗口）+ 自动校验
npm run data:refresh -- --days 400  # 放宽窗口（缓存只增不减，只会补缺失的日期）
npm run data:refresh -- --offline   # 完全不联网，纯用本地缓存重建 data.json
npm run data:validate               # 只校验，不取数
```

**更新是增量的**：脚本先读本地缓存，**只抓缓存里没有的日期**。每天跑一次通常只需抓 1 天，全程约 2–4 秒：

```
数据更新完成 · 2026-09-15 21:49:08｜耗时 2.4s｜增量模式
  窗口 2025-09-04 ~ 2026-09-15（250 个交易日）｜日历来源：腾讯 sh000001 日K（在线）
  成交额/流通市值  命中缓存 250 天｜新抓 0 天｜失败 0 天｜窗口内有效 250/250 天
  美国10Y国债      在线 1000 条 → 新增 0 条，缓存共 1000 条
  …
```

**三层保障**：

| 机制 | 说明 |
|---|---|
| **本地优先** | 所有序列都有本地缓存；窗口内的历史永不重复下载 |
| **断网兜底** | 某个在线源失败时自动退回本地缓存（该列不会突然变空），并在报告里写明「抓取失败 → 退回本地缓存」 |
| **`--offline`** | 完全不联网，纯用缓存重建 `data.json`（实测 0 秒；交易日历也走本地缓存） |

**本地数据集**（两个缓存文件，都在库里，可直接复用）：

| 文件 | 内容 | 现状 |
|---|---|---|
| `scripts/.turnover_cache.json` | 逐日官方「成交额 + 流通市值」（最贵：2 次请求/天） | 250 天 ≈ 13 KB，**只增不减** |
| `scripts/.series_cache.json` | 国债 2 条、两融 2 条、KOSPI、科创50、交易日历 | 约 244 KB（两融含 2010 年以来全历史），**只增不减** |

两个缓存都**不做裁剪**：窗口滑动时最老的日期会滑出 `data.json`，但**仍留在缓存里**——所以以后想放宽窗口（`--days 400`）只会补缺失的那部分，不会重下。

> 解释器：脚本需要带 akshare 的 Python。查找顺序 `$DASH_PY` → `$SKILLS/ashare-data` 的 venv → 系统 `python3`；找不到 venv 时会警告，此时只有 `--offline` 可用。

页面每 30 秒自检一次数据版本（`/api/data-version` 比对 `data.json` 的 mtime/size），**更新完数据页面会自动加载新数据**，不用手动刷新。


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

## 依赖与安全

`npm audit` → **found 0 vulnerabilities**（2026-09-15 升级后）。

| 包 | 版本 | 备注 |
|---|---|---|
| vite | **8.3.0** | 由 5.4.21 升级；构建耗时从 ~4s 降到 **不到 1s** |
| @vitejs/plugin-react | 6.1.1 | 随 vite 升级 |
| echarts | **6.1.0** | 按需注册（`echarts/core`）在 v6 下**无需改代码**；产物比 v5 大约 4.5% |
| typescript / react | 5.9.3 / 18.3.1 | 未变 |

这次升级清掉了三条告警：`vite` **high**（GHSA-4w7w-66w2-5vf9，Optimized Deps `.map` 路径穿越）、
`echarts` moderate（GHSA-fgmj-fm8m-jvvx，XSS）、`esbuild` moderate（GHSA-67mh-4wv8-2f99，随 vite 一并解决）。

**Node 要求随之提高**：vite 8 需要 **`^20.19.0 || >=22.12.0`**（见 `package.json` 的 `engines` 与 `.nvmrc`；
`npm start` 会先检查版本并给出可操作提示）。

> **浏览器基线也提高了**：vite 8 的 `build.target` 默认由 `'modules'` 变为 **`baseline-widely-available`**，
> 产物 CSS 会输出 `@media (width<=1080px)` 这类新语法（需要 **Chrome 104+ / Safari 16.4+**）。
> 语义等价，本项目未改配置；若要兼容更老的浏览器，在 `vite.config.ts` 里显式设置 `build.target`。
>
> **打包器换成 Rolldown 了**：vite 8 内置 rolldown 1.2.8 取代 rollup + esbuild ——
> 这也是 esbuild 那条告警「消失」而非「修复」的原因（整包已不在依赖树里）。副作用是构建更快
> （~4s → 0.6–1.7s）；JS 产物 +4.5% 全部来自 echarts 6。

## 边界与已知限制

- **北交所未纳入成交额历史**（成交额口径为沪深两市）；北交所只有**指数**在实时面板的 chips 里（北证50），没有单独的成交额展示（原先那张卡的成交额分项已随去重一并移除）。
- **两融是沪深合计且 T+1**：当天收盘后当晚才公布，所以最新交易日的两融通常为空（图 3/4 会少一个点，属正常）。
- **A50 / 纳指期货没有历史序列**：`futures_global_hist_em` 走 `push2his`，本机代理连不上——两者只在实时面板出现（现价 + 日内迷你图），这符合它们的用途（夜盘/盘前的**当下读数**，不是历史线）。
- **面板上的跨市场科技读数用纳指期货（NQ）而不是 KOSDAQ**：KOSDAQ 是韩国本土中小成长股、与 A 股半导体/算力缺共同因子；NQ 是全球科技风险偏好的锚且近 24 小时连续交易（实测分时 06:01→21:43，而韩国 14:30 就定格）。KOSDAQ 数据仍在 payload 里，未渲染。
- **KOSDAQ 没有历史序列**：新浪全球指数符号表只有「首尔综合指数」，KOSDAQ 仅实时。
- **国债收益率没有盘中实时**（本地接口均为 EOD）。
- **东财系接口在本机间歇性被代理拦截**（`push2his` / `push2` 等）：所以 KOSPI 历史优先走新浪；若某次生成数据时某列整体为空，先看该列的日志行用了哪个源。
- 数据为第三方接口，**仅供研究**。
