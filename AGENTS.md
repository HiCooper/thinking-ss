# AGENTS.md

给在这个仓库里工作的编码 agent 的操作手册。

用户 clone 这个仓库通常只为了两件事：**把看板跑起来**、**把看板换成自己的持仓**。下面按这两个任务写。

| 目标 | 命令 |
|---|---|
| 跑起来 | `cd market-dashboard && npm start` → http://127.0.0.1:5183 |
| 端口被占 | `PORT=5190 npm start` |
| 只做类型检查 | `cd market-dashboard && npm run typecheck` |
| 换自己的持仓 | 编辑仓库根 `holdings.md` → `cd market-dashboard && npm run holdings:export` |
| 校验持仓文件 | `cd market-dashboard && python3 scripts/export_holdings.py --check` |
| 校验大盘数据 | `cd market-dashboard && npm run data:validate` |
| 收盘后与券商对账 | `cd market-dashboard && python3 scripts/reconcile_broker.py --today-pnl X --market-value Y`（参数可选，见 §B10） |

**唯一硬前置是 Node**（`^20.19.0 || >=22.12.0`，见 `.nvmrc`）。看板本身**不需要 Python、不需要联网** —— `public/data.json` 随仓库提交，开箱即有行情数据。

> ### ⚠️ 隐私：持仓数据不入库
>
> 以下文件**已被仓库根 `.gitignore` 忽略**，只在本地存在，处理方式同 `.env`：
> `holdings.md`（真实持仓）、`market-dashboard/public/holdings.json`（它生成的快照）、
> `market-dashboard/public/holdings-history.json`（账户每日收益记录）、
> `market-dashboard/public/realized-trades.json`（已清仓卖出记录，供每日快照记账）、
> `market-dashboard/public/cash.json`（账户可用现金余额）、
> `calibration-log.md`（校准日志，里面有持仓成本价与组合金额）。
> 仓库里只有模板 **`holdings.example.md`**。
>
> 因此：
> - **不要**用 `git add -f` 强行把这些文件提交上去；
> - **不要**把真实持仓数字写进任何会被提交的文件（`holdings.example.md`、`AGENTS.md`、
>   `README.md`、`calibration-log.md`…）—— 所有示例一律用**编造数字**；
> - 发现上述文件里出现真实份额/成本/市值时，**先脱敏再提交**，并提醒用户历史里可能也有。
>
> 直接后果：**clone 下来没有持仓数据是预期状态**，持仓看板会显示「暂无持仓数据」并给出
> 两条命令指引。不要把它当成 bug 去"修"（比如凭空造一份 holdings.json）。

---

## 1. 仓库结构：能动什么，别动什么

```
.
├── .gitignore               ← 隐私规则就写在这里（持仓文件 + 校准日志）
├── holdings.example.md      ← 持仓文件模板（随仓库分发，全是假数据）
├── AGENTS.md                ← 本文件
├── market-dashboard/        ← 看板本体（React + Vite + ECharts）。改东西基本都在这里
├── calibration-log.md       ← 行情判断的校准日志。**本地文件，不入库**
├── 2026-09-15-A股前瞻报告.md
├── research-2026-09-14-market-facts.md
└── glh_live.py / m1-m2-* / update_m1m2.py

holdings.md                       ← 真实持仓。**本地文件，不入库**
calibration-log.md                ← 校准日志（含持仓成本）。**本地文件，不入库**
market-dashboard/public/holdings.json ← 上者生成的快照。**本地文件，不入库**
market-dashboard/public/holdings-history.json ← 账户每日收益记录。**本地文件，不入库**
```

- **用户说「跑看板」「加个功能」→ 只动 `market-dashboard/`。**
- `calibration-log.md`（本地、不入库）、研究报告、`glh_live.py`、`m1-m2-*` 是**行情分析产物**，与看板无关。用户没点名就不要改。
- `holdings.md` 是**用户的本地隐私数据**（已被 `.gitignore` 忽略）：只在任务 B（导入持仓）里动，
  且**任何时候都不要提交它**（含真实持仓与金额）。

`market-dashboard/` 内部：

| 路径 | 作用 |
|---|---|
| `src/components/Dashboard.tsx` | 大盘看板装配（实时面板 + 摘要卡 + 6 图） |
| `src/components/HoldingsBoard.tsx` | 持仓看板装配（两层取数） |
| `src/holdings.ts` | 持仓解析 / 取数 / 逐只与分组计算 |
| `src/api.ts` | 大盘数据的取数与 normalize |
| `plugin/localApi.ts` | 本地接口插件：`/api/spot`、`/api/holdings`、`/api/data-version` |
| `scripts/export_data.py` | 大盘日频数据导出（含逐日缓存） |
| `scripts/export_holdings.py` | `holdings.md` → `public/holdings.json`（两者都不入库） |
| `scripts/record_holdings_snapshot.py` | 收盘后追加一笔**账户级**收益记录 → `public/holdings-history.json`（不入库）。清仓/减仓时读 `public/realized-trades.json` 把卖出净额计入市值、已实现盈亏计入当日盈亏（否则清仓当天市值凭空缩水） |
| ↑ 的自动检查 | `npm start` 会调 `--if-due`：仅在「已收盘且今天没记录」时补记，盘中/非交易日跳过 |
| `public/data.json` | 大盘日频数据（随仓库提交） |
| `public/holdings.json` | 持仓快照（由脚本生成，**别手改**；**本地文件，不入库**） |
| `public/holdings-history.json` | 账户每日收益记录（`npm run holdings:snapshot` 累积；**本地文件，不入库**） |
| `public/realized-trades.json` | 已清仓卖出记录（**手工维护**，供上者记账；**本地文件，不入库**） |
| `public/cash.json` | 账户可用现金余额（**手工维护**，现金卡用；**本地文件，不入库**）。口径见 §B9 |

---

## 2. 任务 A：让看板跑起来

### A1. 检查前置

```bash
node -v && npm -v
```

要求 `^20.19.0 || >=22.12.0`（Vite 8 的硬要求）。不满足时：

- 有 nvm：`nvm install && nvm use`（`.nvmrc` 已写 22.12.0）
- 无 nvm：引导装 Node 22 LTS（https://nodejs.org），**不要**用系统包管理器装过老的版本

`npm start` 自己会再校验一次 Node 版本，不满足会直接报错并给出可操作提示（不是栈回溯）。

### A2. 启动

```bash
cd market-dashboard
npm start
```

`scripts/start.sh` 依次做四件事，**不需要你手动分步**：

1. 校验 Node 版本；
2. `node_modules` 不存在就 `npm ci`（按 `package-lock.json` 精确还原，首次约 20–60 秒）；
3. 确认 `public/data.json` 存在（缺失会给生成命令）；
4. 起 vite dev server，绑 `127.0.0.1`，端口 **5183**（`strictPort`，被占会直接失败而不是静默换端口）。

长驻进程要用**后台任务**跑，不要让它阻塞你的回合。

### A3. 自己验收，别只看日志说「成功了」

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5183/                # 期望 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5183/data.json       # 期望 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5183/holdings.json   # 期望 200
curl -s http://127.0.0.1:5183/api/holdings | head -c 200                        # 期望 JSON，不是 404
cd market-dashboard && npm run typecheck && npm run build                       # 都要过
```

有条件用无头浏览器时，再确认渲染结果（这是真正能证明「跑起来了」的检查）：

- 大盘看板：5 张摘要卡（第一张为**通栏趋势状态卡**：沪深300 × MA20/MA60 三态判定，判定逻辑在 `src/trend.ts`，与图 1 共用；附市场宽度读数——20日新高/新低家数与涨跌家数；其后固定顺序 **成交额 / 杠杆率 / 两融 / 10Y 美债**，四张都带 `NN% 分位` 角标；杠杆率与两融**必须相邻**，它们是同一分子的两种读法），6 张图（`canvas` 6 个，图 1 为沪深300 趋势图通栏：收盘价 + MA20/MA60，站上/跌破 MA20 以浅红/浅绿底色分段，**右轴为创20日新高/新低家数**；图 4/图 5 带分位灰带）、**8 张实时报价卡**（第一行风险资产 A50 / KOSPI / NQ / 恒生科技，第二行大宗与波动率 COMEX 黄金 / COMEX 白银 / WTI 原油 / **50ETF 期权 QVIX（中国波指）**——QVIX 走 `1.optbbs.com` 的 CSV（akshare QVIX 接口同源），**同站中证300股指序列已于 2026-05 停更**，只有 50ETF 线还活着；四等分自然落成两行、≤1080px 2 列、≤680px 单列）、底部固定指数条 5 个指数；右侧有**折叠快讯坞**（默认收起成窄竖条，仅重要快讯亮未读红点）
- 持仓看板：明细行数 = `holdings.json` 里的条数 + **3 张图**（图 1 账户收益走势｜图 2 分组结构｜图 3 个股盈亏排行）+ 总览卡 4 张。图**缺数据时都渲染引导而非空图**
- 控制台**无未捕获异常**

用 Chrome 无头 + CDP 自查时，**测试完把 Chrome 实例和端口进程杀掉**，别留在后台。

### A4. 故障对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| `✗ Node 版本过低` | Node < 20.19 或 22.12 | `nvm use`；`node -v` 复核 |
| `Error: Port 5183 is already in use` | 端口被占 | `PORT=5190 npm start`；或先找出并杀掉占用进程（注意 vite 会 fork，`lsof -ti :5183` 可能不止一个 PID） |
| `✗ 缺少 public/data.json` | 数据文件没拿到 | `npm run data:refresh -- --offline`（用仓库内缓存离线重建）；或 `npm run data:setup && npm run data:refresh` |
| 页面能开，但「实时行情」显示「实时接口不可用」 | 不是用 dev / preview 打开的（静态托管没有 Node 服务端） | 用 `npm start` 或 `npm run preview` 打开；静态托管下这是**预期降级**，不是 bug |
| 持仓看板提示「实时接口 /api/holdings 不可用」 | 不是用 dev / preview 打开的（静态托管没有 Node 服务端） | 用 `npm start` 或 `npm run preview` 打开；静态托管下这是**预期降级**，不是 bug |
| 持仓看板提示「已连通（盘前）…按昨收价计价」 | **正常状态**，不是故障：开盘前行情源把现价返回 0，此刻按昨收计价，今日盈亏按定义为 0 | 无需处理；开盘后自动切回实时价。**不要**因为看到这条就去重启服务（服务是好的） |
| `npm ci` 失败（网络） | 装依赖要联网 | 换网络 / 配镜像；不要退回 `npm install`（会破坏 lock 一致性） |
| `npm run holdings:export` 报 `No such file` | 在错误目录跑了，或 `python3` 不存在 | 必须在 `market-dashboard/` 下跑；Windows 上把 `python3` 换成 `python`（脚本只用标准库） |

---

## 3. 任务 B：把看板换成用户自己的持仓

### B1. 数据流（只有一条链）

```
holdings.md（人工维护，仓库根；本地文件不入库）
      │  npm run holdings:export  ← 只在改完 holdings.md 后跑
      ▼
market-dashboard/public/holdings.json（机器可读快照，**本地文件不入库**）
      │  页面加载时 fetch('holdings.json')
      ▼
持仓看板（份额/成本来自这里）
      ＋
/api/holdings（实时现价：交易中 5 秒轮询；**收盘后停止轮询**，睡到次日 09:15 自动恢复；也可点「立即刷新」手动拉）
      ▼
市值 / 浮动盈亏 / 距成本 = 运行时现算
```

**唯一该手改的是 `holdings.md`**（本地文件，不入库；首次从模板复制）。`holdings.json` 是生成物，
手改会在下次导出时被覆盖。两个文件都**只在本地**，仓库里只有 `holdings.example.md`。
页面**不会**实时刷新份额与成本——用户改动持仓后必须重跑导出，再刷新页面。

### B2. 向用户索要什么

前提：仓库根目录已有 `holdings.md`。若没有（刚 clone），先 `cp holdings.example.md holdings.md`。

最小输入只有 4 项，其余都能算或能查：

| 字段 | 必需 | 说明 |
|---|---|---|
| 名称 | ✅ | 券商 App 里显示的名字，截断也行（如 `恒生科技ETF华…`） |
| 份额 | ✅ | 持股数量 |
| 成本价 | ✅ | 摊薄成本 / 持仓成本价 |
| 代码 | ⭕ | 若知道最好；不知道由你查（见 B3），**绝不靠猜** |
| 现价 / 市值 / 盈亏 | ❌ | 由你抓现价后计算（见 B4）；盈亏可正可负 |

获取方式按可靠性排序：

1. **券商导出的 CSV / Excel**（最可靠，让用户导出后把文件给你或贴内容）
2. 用户直接粘贴的文本列表
3. 券商 App 截图 —— **只有你能读图时才用**；读不了就明确告诉用户「请改成文字/CSV」，不要靠猜图里的数字

### B3. 查代码（零依赖，禁止猜代码）

用新浪 suggest 接口：给名称，返回代码。**不需要 Python、不需要装任何东西。**

```bash
KEY=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "恒生科技ETF华泰柏瑞")
curl -s "https://suggest3.sinajs.cn/suggest/type=&key=${KEY}" | iconv -f gbk -t utf-8
```

返回形如：

```
var suggestvalue="恒生科技ETF华泰柏瑞,203,513130,sh513130,恒生科技ETF华泰柏瑞,…;…";
```

每段逗号分隔，字段含义：

| 下标 | 含义 |
|---|---|
| 0 | 名称 |
| 1 | 类型码（`203` 沪 ETF、`22` 深 ETF、`23` LOF、`25` QDII、`201`/`21` 场外基金） |
| **2** | **6 位证券代码** |
| **3** | **带交易所前缀的符号**（`sh513130` / `sz159516`） |

选取规则：**优先第 4 段是 `sh…` / `sz…` 的那条**（场内可交易）；`of…` 是场外基金，没有场内价格，不要选。

**硬规则**：

- 名称有歧义（多个候选）时，**把候选列给用户让他确认**，不要自己挑一个。
- 查不到代码时，**回头问用户**。猜错代码的后果是看板显示另一只基金的价格，而且不会报错——这是最隐蔽的错误。
- 名称已被 App 截断（带 `…`）时，用截断名去掉 `…` 再查，通常能命中；suggest 会顺带返回全称。

### B4. 抓现价（零依赖）

把 B3 得到的符号拼成一次批量请求（**一次请求覆盖全部持仓**）：

```bash
curl -s -H "Referer: https://finance.sina.com.cn" \
  "https://hq.sinajs.cn/list=sh588000,sz159516,sh513130" | iconv -f gbk -t utf-8
```

返回 `var hq_str_sh588000="科创50ETF华夏,1.638,1.638,1.710,…";`，字段序：

| 下标 | 含义 |
|---|---|
| 0 | 名称 |
| 1 | 今开 |
| 2 | **昨收** |
| **3** | **现价** |
| 4 / 5 | 最高 / 最低 |
| 8 / 9 | 成交量（股）/ 成交额（元） |

**停牌时现价是 `0.00`**，此时不要拿 0 当价格：用昨收兜底，并在给用户的回复里说明该只停牌。

### B5. 写出 `holdings.md`

**模板已随仓库分发：`holdings.example.md`**（内含骨架 + 「如何填」要点速查，全是假数据）。先复制：

```bash
cp holdings.example.md holdings.md     # 在仓库根目录执行
```

模板本身**能直接跑通** `npm run holdings:export`，所以照着它改不会走偏。**不要在别处再抄一份骨架**——
模板只有这一个来源，避免两处漂移。下面是脚本会逐条校验的契约。

格式契约（`scripts/export_holdings.py` 会逐条校验）：

1. **分组标题必须是 `### 单个大写字母. 组名`**（如 `### A. 半导体`）。分组不是装饰——持仓看板「图 2 分组结构」直接依赖它，**没有分组这张图就没意义**。按用户的实际结构分 2–5 组（按主题/资产类别，别按基金公司分）。
2. 每个分组下的明细表必须有 **7 列且顺序固定**：`名称 | 份额 | 现价 | 成本 | 市值 | 盈亏 | 盈亏%`；表头第一格必须是 `名称`（**其余列名不校验**，叫 `浮亏` 还是 `盈亏` 都能解析）。
3. **`市值` 必须等于 `份额 × 现价`**（容差 0.5%）。脚本用它校验有没有读错列——用 B4 抓到的现价自己算一遍，别直接抄 App 上可能被截断的数字。
4. **`成本` 与 `盈亏%` 两列脚本不读**（只给人看），可以填粗略值。因为脚本用 `成本 = (市值 − 盈亏) / 份额` **反推精确成本价**——App 显示的 `0.773` 是四舍五入值，拿它算总成本会差几元。
5. `盈亏` 列**可正可负**（盈利填正数），全角 `−` 与 ASCII `-` 都能解析；看板按有符号口径展示，详见 §5。
6. **代码映射表的第 1 列必须与明细表里的名称逐字一致**（或者用第 2 列的全称匹配，脚本对两列都认）。代码必须是 6 位数字。
7. 每条持仓都要能在映射表里找到代码，且**代码不能重复**——否则脚本报错并列明缺哪几只。

### B6. 生成 + 校验

```bash
cd market-dashboard
npm run holdings:export                    # 写入 public/holdings.json
python3 scripts/export_holdings.py --check  # 只校验不写文件
```

脚本会打印逐组小计与合计。**把这份输出贴给用户看**，让他确认对不对。

### B7. 验收：三个交叉验证（别省）

1. **总额对齐**：脚本打印的「市值合计」要和用户券商的「总市值」一致（允许因价格时点差几个百分点）。差异大 → 份额或代码错了。
2. **只数对齐**：脚本说解析了 N 条，N 要等于用户实际持仓只数。少了 → 有一行格式不合规被跳过（脚本会报错，不会静默丢）。
3. **页面渲染**：启动看板 → 切到「我的持仓看板」→ 确认明细行数 = N、总览卡「持仓市值」对得上、控制台无异常。

`npm run holdings:export` 是**幂等**的：重复跑结果一样，可以放心重跑。

### B8. 导入之后的买入/卖出怎么记（有固化 skill）

用户随后的每笔买卖，走仓库内已固化的 skill：

```
.agents/skills/holdings-trade-bookkeeping/SKILL.md
```

它把口径写死了：卖出**不改**摊薄成本价、改份额必须同步改市值与盈亏、
卖出必须追加 `public/realized-trades.json`（不写则清仓当天市值凭空缩水，且不报错）、
买入才是加权摊薄，附命令清单与收工自查。**用户说「卖出 XX 多少份额、什么价位」时先加载它，别临场发挥。**

> **换机器 clone 后要重建一次软链**，否则本机不会自动发现这个 skill
> （WorkBuddy 只自动扫描 `.workbuddy/skills/`，而 `.workbuddy/` 整体不入库）：
>
> ```bash
> mkdir -p .workbuddy/skills && ln -s ../../.agents/skills/holdings-trade-bookkeeping .workbuddy/skills/
> ```

### B9. 现金卡：可用现金放哪、为什么不算进盈亏

`public/cash.json`（**手工维护，本地不入库**）存账户可用现金，看板据此渲染一张**通栏**现金卡
（排在四张持仓指标卡之前，先给「还剩多少子弹」，再看持仓），并给出**账户总值 = 持仓市值 + 现金**。

```json
{ "as_of": "2026-01-15", "balance": 12345.67 }
```

`as_of` 是余额日期，`balance` 是可用现金。**没有这个文件 = 还没维护过，现金卡不渲染**（退回四张竖排卡），
这是正常状态，不要为了"让它显示"去造一个。

> #### ⚠️ 现金**不进**市值与浮动盈亏 —— 这是刻意的，别"好心"合并
>
> 账户总值若含现金，而总投入（持仓成本）里没有对应的**期初本金**科目，
> 多出来的现金会被算成利润：余额里原有的那部分现金会凭空变成盈利，
> 让浮亏看起来比实际小。**这不是精度问题，是符号级错误。**
> 所以现金目前只用于两处：
> 1. 现金卡展示（金额、占总资产比、账户总值）；
> 2. 「今日盈亏率」的**分母**：昨收账户权益 = 当前市值 + 现金 − 今日盈亏
>    （`holdings.ts` 的 `portfolioTotals`）。有 `cash.json` 时用它，没有才退回卖出净额。
>
> 想真正把现金并进口径，得先有「期初本金 + 出入金流水」，那是账本翻转的活（见 §3 结尾的讨论）。

**维护时机**：每次买入/卖出后，按券商 App 的「可用资金」更新它——与跑
`npm run holdings:export` 同一拍。卖出会让它变多、买入变少，忘了更新则现金占比失真。
记账 skill（B8）里已把这一步列为收工自查项。

---

### B10. 收盘后与券商 App 对账

**口径分歧是这里最常见的 bug，不是数据错误**。对账前先跑 `npm run holdings:snapshot`（15:05 后），
再让脚本把「券商报的总数」和「看板自算的同一口径」摆在一起：

```bash
cd market-dashboard
python3 scripts/reconcile_broker.py --market-value 123456.78 --cash 12345.67 \
    --today-pnl -234.56 --pnl -89012.34       # 示例数字，换成券商 App 上的真实值
```

参数是券商 App 上的数字，**给几个对几个**（没给的项只显示看板自算值）。阈值 1 元 / 0.1%，
超了会按下面三条顺序给排查建议。

> #### 三条口径（对账前必须知道）
>
> 1. **今日盈亏是「当日累计」**：券商按**卖出前**份额算，卖掉的部分今天也产生盈亏、会计入当日。
>    所以减仓当天 `剩余份额×(现价−昨收) + 卖出份额×(成交价−昨收)` 才等于券商数字，
>    只看剩余份额**正好差一半**。
> 2. **可用资金 ≠ 总资产**：券商「可用」通常不含未交收的在途资金。卖出当日先拿**总资产**
>    对 `cash.json`，次日再用「可用」。
> 3. **`day_realized` 填相对昨收，不是相对成本**（详见 B8 的 skill）。填错会让今日盈亏
>    凭空多几千且不报错。
> 4. **券商（两融）「持仓盈亏」是摊薄成本口径 = 我们的浮动盈亏 + 累计已实现（相对成本）**。
>    卖出时券商把已实现盈亏摊进剩余持仓的成本价，且**不会还原**，所以这一块逐笔累积、
>    永久存在，差额只会越来越大。
>    **看板主数字已经用这个口径**：卡片叫「总盈亏」，副标「含已实现」，
>    `其中浮动 / 其中已实现` 两行给出拆分，`realized-trades.json` 为空时退回「浮动盈亏」。
>    直接拿它对券商，别去改我们的成本价（成本价仍然卖出不变，那是另一条铁律）。
>    连带影响：「盈亏率」的分母是**摊薄成本额**（= 持仓成本 − 累计已实现），
>    「回本需涨」也按摊薄成本算——否则会与主数字自相矛盾（亏 9 万却说只需涨 24%）。
>    实现见 `holdings.ts` 的 `dilutedView()`，总览卡与页脚共用，不要各写一套。

脚本原理：读 `holdings.json` 拿份额/成本 + 抓收盘价 + 读 `realized-trades.json` 当日流水 + 读
`cash.json`，自算六个指标再逐项比对。它**不改任何文件**，只读。

---

## 4. 硬约束（别踩的坑）

- **不要手改 `public/holdings.json` 或 `public/data.json`**，它们是生成物。
- **不要猜证券代码**。宁可不做，也不要让看板显示错的价格。
- **不要为了让脚本通过而伪造数字**（比如把盈亏符号改掉、把市值凑成 `份额×现价`）。脚本的校验就是用来抓这类问题的；过不了就说明源数据有问题，回去问用户。
- **不要动 `market-dashboard/dist/`**：它在 `.gitignore` 里，是构建产物。
- **改完跑 `npm run typecheck`**（`npm run build` 已包含）。`tsconfig` 开了 `strict` + `noUnusedLocals`。
- **绝不提交 `holdings.md`、`public/holdings.json`、`public/holdings-history.json`、
  `public/realized-trades.json`、`public/cash.json`、`calibration-log.md`**：
  它们含真实持仓、成本、金额与分组构成，
  已被 `.gitignore` 忽略。不要用 `git add -f` 绕过；也不要把真实数字抄进任何会入库的文件
  （示例一律用编造数据）。**这些文件曾误入历史并被 `git filter-branch` 清除过一次，别再犯。**
- **不要自动 git commit / push**，除非用户明确要求。

---

## 5. 盈亏口径：有符号，不假定方向

持仓看板**不假定盈亏方向**——盈利、亏损、持平都能正确展示。要点：

- `export_holdings.py` **不对盈亏做符号限制**；盈利持仓在 `holdings.md` 里直接填正数即可。
  它只拦一种物理上不可能的情况：由 `成本 = (市值 − 盈亏)/份额` 反推出的成本价非正。
- 明细表第 6 列（`盈亏`）与第 7 列（`盈亏%`）脚本**都不读**，列名也是纯展示（叫 `浮亏` 还是 `盈亏` 都能解析）。
- **红涨绿跌**沿用 A 股习惯：盈利为红、亏损为绿，数字与条形一致。
- **「贡献占比」的分母是盈亏绝对额之和**（`Σ|盈亏|`），不是净盈亏，所以盈亏混合时也成立：
  亏损组为负、盈利组为正；全浮亏时它就退化成「占总亏损的比例」。
- **「距成本」是双向的**：同一个 `(成本 − 市值)/市值`，
  亏损仓读作「需涨 X% 才回本」，盈利仓读作「可跌 X% 才回到成本（安全垫）」。
  判定统一走 `src/holdings.ts` 的 `breakevenOf()`，总览卡、明细表、图表 tooltip 都用它，避免三处说法不一致。
- **组合整体盈利时**，总览卡的「回本需涨」自动变成「可回撤」，「最大亏损」旁边会多一项「最大盈利」。

改这块代码时的注意点：

| 位置 | 注意 |
|---|---|
| `src/format.ts` | **金额（元）一律精确到分**，走 `fmtYuan` / `fmtSignedYuan`；**不要**用 `fmtNum` / `fmtSigned` 直接格式化金额（那是展示偏好，金额位数是口径）。份额、单价（元/份）、收益率、`亿元`（成交额/两融/流通市值）与图表坐标轴刻度都不适用 |
| `src/stats.ts` | 历史分位（百分位排名 + P20/P50/P80）。窗口取尾部 250 个**非 null** 值，样本 < 20 返回 `null`（小样本分位数是噪音）。分位带走 `chartTheme.percentileBand()`，用 `markArea`/`markLine` 而不是加数据线 |
| `src/components/SummaryCards.tsx` | 四张卡，**顺序固定：成交额 → 杠杆率 → 两融 → 10Y 美债**。① 「最新交易日」已删（与小字说明重复）——不要把只有日期的卡加回来；② 科创50 也已删（底部常驻指数条里已有实时的）——**加任何卡前先确认底部条 / 实时面板 / 图里没有同一个读数**。杠杆率与两融**必须相邻**：同一分子的绝对规模 vs 相对拥挤度，实测分位相反（44% vs 73%），拆开就看不出对照。杠杆率的分子分母必须取**同一行**（跨日取会算出一个不存在的比率） |
| `scripts/export_data.py` | **日K来源的列（`kospi` / `star50`）必须过 `kline_ok()`**：盘中刷新会拿到没走完的当日 K 线（实测 09:32 把 1623.06 写成当日值，真实收盘 1606.29）。当日不到 `KLINE_FINAL_MINUTES`（15:05）就置 `null`，与两融同一约定。新增日K来源的列时**照做**。**指数序列还必须过 `clean_index()`**：上游会把最新一根的收盘写成 `0`（实测 2026-09-23 KOSPI，OHLC 与成交量都正常、只有 `c="0"`），而 `merge_series` 只跳过 `None`，`0` 会进缓存并盖掉已经修好的值 —— 入缓存前必须剔除 `≤0` 与 `NaN`。上游已修好、代码里仍暂留的逐日修正见 `KOSPI_REPAIR` |
| `src/holdings.ts` | `GroupStat.pnlContribution` 是**有符号**的；新增派生指标时保持对正负都成立 |
| `src/components/HoldingsStructureChart.tsx` | 发散条形图：`yAxis.axisLine.onZero = false` 让类目名贴左（否则压在负向条上），0 处靠 `markLine` 标出 |
| `src/components/HoldingsPnlChart.tsx` | `xAxis` 的 `min/max` 必须同时覆盖正负；配色用 `chartTheme.pnlColor()` |
| `src/components/HoldingsPnlTrendChart.tsx` | 持仓图 1，**当日**口径双轴：左轴 `day_pnl`（刻度**直接用「元」**、千分位整数 + `元` 后缀，**不要再折成「万」**——日盈亏量级就在千元上下，「0.62万」既多一次心算又和 tooltip 的「+6,210.29 元」对不上）、右轴 `day_pnl_pct`（分母是昨收市值，**不要**换成累计 `pnl`/`pnl_pct`）。两者都可为 `null`（首日无前收）——`connectNulls: false` 断线、量程计算要先滤 null、全 null 时用 `graphicNotice` 在图内提示 |
| `src/components/HoldingsTable.tsx` | 「距成本」的文案与颜色、发散微条方向（`.holdings-pnlbar__fill.is-loss/.is-gain`） |

---

## 6. 可选：让「历史行情（日频）」能更新

**只有想抓新数据时才需要这一步。** 看板本身不需要。

```bash
cd market-dashboard
npm run data:setup      # 一次性：建 .venv-data/ 并装 akshare
npm run data:refresh    # 增量更新（联网，只抓缓存里没有的日期）
npm run data:validate   # 校验结果
```

- `scripts/refresh.sh` 按 `$DASH_PY` → `scripts/.python-path` → `./.venv-data` → `$SKILLS/akshare-data/.venv` → `python3` 的顺序找解释器（后两个是本机路径，新机器上通常不存在，会落到 `python3`）。
- 没有 akshare 时给的是可操作提示（装环境 / 改用 `--offline`），不是栈回溯。
- 完全离线重建：`npm run data:refresh -- --offline`（用仓库里的 `scripts/.turnover_cache.json` 与 `.series_cache.json`）。
- 数据是**增量**的：每天跑一次通常只抓 1 天，2–4 秒。跑完页面 ≤30 秒自动加载新数据（`/api/data-version` 轮询比对 mtime/size）。

> 仓库**没有任何 CI / 部署配置**（没有 Actions、没有 Pages 设置），看板只在本地 `npm start` 跑。
> 不要凭空新增 CI、Actions 或部署流水线——用户没要求就不加。
> 同理也不要新增桌面版 / Electron / 打包相关的东西：曾有过 `electron/` + `electron-builder.yml`
> + `desktop:pack`（macOS dmg），已整体删除（依赖树里也清掉了 electron 与 esbuild），
> 现在**纯 Web 项目**。

---

## 7. 参考

- `market-dashboard/README.md` —— 看板的完整设计与口径说明（数据来源、字段含义、图表读法、边界）。改看板前先读它。
- `holdings.example.md` 的「如何填」—— 持仓文件的字段口径速查。
- `calibration-log.md`（本地）—— 行情判断的原始校准记录；提炼层在 skill 仓库。
