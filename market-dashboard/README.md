# 大盘看板（A 股）

一个 React + Vite + ECharts 的本地看板，用三张折线图跟踪 **两市成交额 / 10 年美债与中债 / 融资融券** 的走势。

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

页面从 `public/data.json` 读数据（静态文件，无需后端）。

## 三张图看什么

| 图 | 序列 | 用途 |
|---|---|---|
| **两市总成交额** | `turnover_total` + 20 日均线 | **量能**：显著高于均量=放量（趋势可信度高）；持续低于均量=缩量（反弹缺增量、破位易阴跌） |
| **国际市场联动** | `us10y`、`cn10y` + 美中利差(bp) | 全球贴现率方向：美债上行压估值（尤其高估值成长），美中利差走阔对应人民币与外资压力 |
| **融资融券** | `margin_rz`（左轴）、`margin_rq`（右轴） | **杠杆与拥挤度**：融资余额升=加杠杆（顺周期确认）；连降=资金撤离。融券余额量级小两个数量级，故用双轴 |

## 数据来源与口径

数据由 `scripts/export_data.py` 生成，全部按 **A 股交易日**对齐（约 250 个交易日 / 一年）：

| 字段 | 来源 | 口径说明 |
|---|---|---|
| `turnover_sh` / `turnover_sz` / `turnover_total` | 上交所 `stock_sse_deal_daily` + 深交所 `stock_szse_summary` | **官方日度**，单位**亿元**；`turnover_total` = 沪 + 深，**不含北交所**（北交所约 80–130 亿，占比 <1%） |
| `us10y` / `cn10y` | 新浪全球国债 `bond.finance.sina.com.cn/hq/gb/daily?symbol=US10YT\|CN10YT` | 单位 **%**；美股/欧股休市日按**前值填充**（沿用上一收盘） |
| `margin_rz` / `margin_rq` / `margin_total` | akshare `macro_china_market_margin_sh` + `_sz` | 单位**亿元**，**沪深两市**；交易所 T+1 公布，**最新一日可能为 null** |

### 为什么成交额要逐日抓

akshare 里**没有**现成的「两市成交额历史序列」：东财 K 线接口（`stock_zh_index_daily_em`）在本机被代理拦截，新浪/腾讯的指数日 K **只有成交量、没有成交额**（`stock_zh_index_daily_tx` 的 `amount` 列其实是手数）。所以只能按交易日逐日调官方接口 —— 250 天约 50 秒，脚本带缓存（`scripts/.turnover_cache.json`），**重复运行只补缺失日期**。

### 刷新数据

```bash
# 必须用带 akshare 的解释器（本机为 ashare-data skill 的 venv）
/Users/xueancao/Projects/QoderProjects/agents-silky/skills/ashare-data/.venv/bin/python scripts/export_data.py --days 250
```

想换窗口长度就用 `--days`（如 `--days 60` 看近三个月）。生成后刷新页面即可。

## 数据字段（`public/data.json`）

```json
{
  "generated_at": "2026-09-15 21:18 CST",
  "sources": "……",
  "range": { "start": "2025-09-04", "end": "2026-09-15", "trading_days": 250 },
  "rows": [
    {
      "date": "2026-09-15",
      "turnover_sh": 7648.4, "turnover_sz": 8494.6, "turnover_total": 16143.0,
      "us10y": 4.9829, "cn10y": 1.686,
      "margin_rz": null, "margin_rq": null, "margin_total": null
    }
  ]
}
```

**任何字段都可能是 `null`**（节假日、T+1 未公布、接口临时失败），前端图表需容忍。

## 项目结构

```
market-dashboard/
├── public/data.json          # 看板数据（由脚本生成）
├── scripts/export_data.py    # 数据导出脚本（含成交额逐日缓存）
└── src/                      # React 应用（三个 ECharts 折线图）
```

## 边界与已知限制

- **北交所未纳入成交额**（口径为沪深两市）。北证 50 当日成交额可在 `ashare-data/fetch turnover` 里单独看到。
- **两融是沪深合计**，且 T+1：当天收盘后当晚才公布，所以「最新交易日」的两融通常为空，图 3 会比图 1/2 少一个点属正常。
- 国债收益率**没有盘中实时**（本地接口均为 EOD）；要看盘中实时值需另取。
- 数据为第三方接口，**仅供研究**；接口字段偶有变动，重新生成数据时若某字段整体为空，先检查对应接口。
