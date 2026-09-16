#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""导出「大盘看板」数据 → public/data.json（**增量更新，本地优先**）

设计原则
--------
1. **优先读取已下载数据**：所有序列都有本地缓存，窗口内的历史**永不重复下载**。
   - `scripts/.turnover_cache.json`：逐日官方「成交额 + 流通市值」（最贵，2 次请求/天）
   - `scripts/.series_cache.json`  ：其余序列（国债 2 条、两融 2 条、KOSPI、科创50）+ 交易日历
2. **增量**：只抓「缓存里没有的日期」。窗口滑动（如每天跑 `--days 250`）时通常只需抓 1 天。
   缓存只增不减 —— 所以以后想把窗口放宽到 `--days 500`，也只会补缺失的那部分。
3. **断网兜底**：某个在线源失败时，自动退回本地缓存（该列不会突然变空），并写入报告。
4. **`--offline`**：完全不联网，纯用本地缓存重建 data.json（用于校验/演示/网络故障时）。

用法（必须用带 akshare 的 venv；一般直接用 `npm run data:refresh`）：
  $SKILLS/akshare-data/.venv/bin/python scripts/export_data.py [--days 250] [--offline]

输出：public/data.json，并在最后打印**本次增量报告**（新增哪些日期、各序列新增多少条）。
"""
import argparse
import json
import sys
import time
import warnings
from datetime import datetime
from pathlib import Path

warnings.filterwarnings("ignore")

# 第三方依赖**延迟导入**：--offline 只用仓库里的缓存，不需要 akshare/pandas/requests。
# 这样「换一台机器、没装 akshare」也能纯离线重建 data.json。
try:
    import requests
except ImportError:                      # pragma: no cover
    requests = None
try:
    import pandas as pd
except ImportError:                      # pragma: no cover
    pd = None
try:
    import akshare as ak
except ImportError:                      # pragma: no cover
    ak = None

_MISSING_HINT = """✗ 缺少第三方依赖「{mod}」——只有**联网更新数据**才需要它。
  任选其一：
    · npm run data:setup                    # 在项目下建 .venv-data 并安装 akshare/pandas/requests
    · npm run data:refresh -- --offline      # 纯用仓库里的本地缓存重建（不需要任何第三方依赖）
    · DASH_PY=/path/to/python npm run data:refresh"""


def _require(mod, obj):
    if obj is None:
        print(_MISSING_HINT.format(mod=mod), file=sys.stderr)
        sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data.json"
HERE = Path(__file__).resolve().parent
TURNOVER_CACHE = HERE / ".turnover_cache.json"
SERIES_CACHE = HERE / ".series_cache.json"
UA = {"User-Agent": "Mozilla/5.0", "Referer": "https://stock.finance.sina.com.cn/"}

report = []


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def load_json(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return default
    return default


def save_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


# ---------------- 交易日历 ----------------
def tx_daily(symbol, n):
    """腾讯日 K → [(日期, 收盘), ...]。"""
    _require("requests", requests)
    url = f"https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param={symbol},day,,,{n + 60}"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20).json()
    return [(x[0], float(x[2])) for x in r["data"][symbol]["day"]]


def resolve_calendar(n, sc, offline):
    if not offline:
        try:
            days = [d for d, _ in tx_daily("sh000001", n)][-n:]
            sc["calendar"] = days                      # 缓存日历，供 offline 使用
            return days, "腾讯 sh000001 日K（在线）"
        except Exception as e:
            log(f"[日历] 在线取数失败（{type(e).__name__}），退回本地缓存日历")
    cal = sc.get("calendar") or []
    if not cal:
        log("✗ 本地缓存里也没有交易日历，无法继续（请先联网跑一次）")
        sys.exit(1)
    return cal[-n:], "本地缓存"


# ---------------- 通用：序列级「本地优先 + 兜底」 ----------------
def merge_series(sc, key, fresh):
    """把新抓到的 {date: value} 并入本地缓存（同日期新值覆盖），返回 (合并结果, 新增条数)。"""
    old = sc.get(key) or {}
    before = len(old)
    old.update({d: v for d, v in fresh.items() if v is not None})
    sc[key] = old
    return old, len(old) - before


def series_with_cache(sc, key, label, fetcher, offline):
    """先尝试抓取；成功则并入缓存；失败/离线则用缓存。返回 (完整序列, 报告行)。"""
    if offline:
        old = sc.get(key) or {}
        line = f"{label:12s} 离线：用本地缓存 {len(old)} 条"
        log("[序列] " + line)
        return old, line
    try:
        fresh = fetcher()
    except Exception as e:
        old = sc.get(key) or {}
        line = f"{label:12s} 抓取失败（{type(e).__name__}）→ 退回本地缓存 {len(old)} 条"
        log("[序列] " + line)
        return old, line
    merged, added = merge_series(sc, key, fresh)
    line = f"{label:12s} 在线 {len(fresh)} 条 → 新增 {added} 条，缓存共 {len(merged)} 条"
    log("[序列] " + line)
    return merged, line


# ---------------- 逐日官方：成交额 + 流通市值 ----------------
def official_one(date):
    """→ (沪成交亿, 深成交亿, 沪流通市值亿, 深流通市值亿)。"""
    _require("akshare", ak)
    d = date.replace("-", "")
    sse = ak.stock_sse_deal_daily(date=d)
    pick = lambda row: float(sse.loc[sse["单日情况"] == row, "股票"].iloc[0])
    sh_amt, sh_float = pick("成交金额"), pick("流通市值")          # 均为亿元
    szse = ak.stock_szse_summary(date=d)
    sz_row = szse.loc[szse["证券类别"] == "股票"].iloc[0]
    return (round(sh_amt, 1), round(float(sz_row["成交金额"]) / 1e8, 1),
            round(sh_float, 1), round(float(sz_row["流通市值"]) / 1e8, 1))


def build_official(days, cache, offline):
    if offline:
        ok = sum(1 for d in days if isinstance(cache.get(d), list) and len(cache[d]) == 4)
        log(f"[成交额/流通市值] 离线：命中缓存 {ok}/{len(days)} 天")
        return {d: (cache[d] if isinstance(cache.get(d), list) and len(cache[d]) == 4 else None) for d in days}

    todo = [d for d in days if not (isinstance(cache.get(d), list) and len(cache[d]) == 4)]
    cached = len(days) - len(todo)
    log(f"[成交额/流通市值] 增量：命中缓存 {cached} 天，需抓取 {len(todo)} 天（约 {len(todo) * 0.2:.0f} 秒）")
    t0 = time.time()
    failed = []
    for i, d in enumerate(todo, 1):
        try:
            cache[d] = list(official_one(d))
        except Exception:
            failed.append(d)
            cache[d] = None                      # 记下失败，避免每次重试拖慢
        if i % 25 == 0 or i == len(todo):
            log(f"  {i}/{len(todo)}  {d}  已用 {time.time() - t0:.0f}s")
    ok = sum(1 for d in days if isinstance(cache.get(d), list) and len(cache[d]) == 4)
    line = (f"成交额/流通市值  命中缓存 {cached} 天｜新抓 {len(todo) - len(failed)} 天"
            f"｜失败 {len(failed)} 天｜窗口内有效 {ok}/{len(days)} 天")
    log("[逐日官方] " + line)
    report.append(line)
    if failed:
        report.append("  抓取失败日期：" + "、".join(failed[:10]) + ("…" if len(failed) > 10 else ""))
    return {d: (cache[d] if isinstance(cache.get(d), list) and len(cache[d]) == 4 else None) for d in days}


# ---------------- 各序列抓取器（均返回 {date: value}） ----------------
def fetch_sina_bond(symbol):
    _require("requests", requests)
    data = requests.get(f"https://bond.finance.sina.com.cn/hq/gb/daily?symbol={symbol}",
                        headers=UA, timeout=20).json()["result"]["data"]
    return {x["d"]: float(x["c"]) for x in data}


def fetch_margin(field):
    _require("akshare", ak)
    _require("pandas", pd)

    def side(df):
        df = df[["日期", field]].copy()
        df["日期"] = pd.to_datetime(df["日期"]).dt.strftime("%Y-%m-%d")
        df[field] = pd.to_numeric(df[field], errors="coerce") / 1e8      # 元 → 亿元
        return dict(zip(df["日期"], df[field].round(1)))
    m = side(ak.macro_china_market_margin_sh())
    for k, v in side(ak.macro_china_market_margin_sz()).items():
        m[k] = round(m.get(k, 0) + v, 1)
    return m


def fetch_kospi():
    """新浪全球指数（gi.finance.sina.com.cn）；东财 index_global_hist_em 走 push2his 会被代理挡，仅兜底。"""
    _require("akshare", ak)
    _require("pandas", pd)
    try:
        df = ak.index_global_hist_sina(symbol="首尔综合指数")
        dates, closes = df["date"], df["close"]
    except Exception:
        df = ak.index_global_hist_em(symbol="韩国KOSPI")
        dates, closes = df["日期"], df["最新价"]
    return dict(zip(pd.to_datetime(dates).dt.strftime("%Y-%m-%d"),
                    pd.to_numeric(closes, errors="coerce").round(2)))


def fetch_star50():
    return {d: round(c, 2) for d, c in tx_daily("sh000688", 400)}


# ---------------- 前值填充 ----------------
def fill_forward(series, days):
    """按 A 股日历前值填充（海外休市沿用上一收盘；窗口起点之前取最近一个已知值）。"""
    last, out = None, {}
    for d in sorted(series):
        if d < days[0]:
            last = series[d]
    for d in days:
        if d in series:
            last = series[d]
        out[d] = last
    return out


# ---------------- 主流程 ----------------
def main():
    ap = argparse.ArgumentParser(description="增量导出看板数据（本地优先）")
    ap.add_argument("--days", type=int, default=250, help="窗口交易日数量（默认 250）；缓存只增不减，放宽窗口只会补缺失部分")
    ap.add_argument("--offline", action="store_true", help="完全不联网，纯用本地缓存重建 public/data.json")
    args = ap.parse_args()

    t_start = time.time()
    cache = load_json(TURNOVER_CACHE, {})
    sc = load_json(SERIES_CACHE, {})

    days, cal_src = resolve_calendar(args.days, sc, args.offline)
    log(f"窗口：{days[0]} ~ {days[-1]}（{len(days)} 个交易日）｜日历来源：{cal_src}")
    report.append(f"窗口 {days[0]} ~ {days[-1]}（{len(days)} 个交易日）｜日历来源：{cal_src}")

    official = build_official(days, cache, args.offline)

    defs = [
        ("us10y", "美国10Y国债", lambda: fetch_sina_bond("US10YT")),
        ("cn10y", "中国10Y国债", lambda: fetch_sina_bond("CN10YT")),
        ("margin_rz", "融资余额", lambda: fetch_margin("融资余额")),
        ("margin_rq", "融券余额", lambda: fetch_margin("融券余额")),
        ("kospi", "韩国KOSPI", fetch_kospi),
        ("star50", "科创50", fetch_star50),
    ]
    series, lines = {}, []
    for key, label, fn in defs:
        s, line = series_with_cache(sc, key, label, fn, args.offline)
        series[key] = s
        lines.append(line)
    report.extend(lines)

    save_json(TURNOVER_CACHE, cache)
    save_json(SERIES_CACHE, sc)

    us10y = fill_forward(series["us10y"], days)
    cn10y = fill_forward(series["cn10y"], days)
    kospi = fill_forward(series["kospi"], days)

    rows = []
    for d in days:
        o = official.get(d)
        sh, sz, sh_f, sz_f = o if o else (None, None, None, None)
        total = round(sh + sz, 1) if (sh is not None and sz is not None) else None
        float_cap = round(sh_f + sz_f, 1) if (sh_f is not None and sz_f is not None) else None
        rz_d, rq_d = series["margin_rz"].get(d), series["margin_rq"].get(d)
        rows.append({
            "date": d,
            "turnover_sh": sh, "turnover_sz": sz, "turnover_total": total,
            "float_mktcap": float_cap,
            "turnover_ratio": round(total / float_cap * 100, 3) if (total and float_cap) else None,
            "us10y": us10y.get(d), "cn10y": cn10y.get(d),
            "margin_rz": rz_d, "margin_rq": rq_d,
            "margin_total": round(rz_d + rq_d, 1) if (rz_d is not None and rq_d is not None) else None,
            "margin_rz_ratio": round(rz_d / float_cap * 100, 3) if (rz_d is not None and float_cap) else None,
            "kospi": kospi.get(d), "star50": series["star50"].get(d),
        })

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M") + " CST",
        "sources": "成交额与流通市值=上交所/深交所官方日度（stock_sse_deal_daily + stock_szse_summary）；"
                   "国债收益率=新浪全球国债（US10YT/CN10YT，按A股日历前值填充）；"
                   "两融=沪深交易所宏观序列（akshare macro_china_market_margin_sh/sz）；"
                   "KOSPI=新浪 index_global_hist_sina（东财兜底）；科创50=腾讯日K。"
                   "金额单位：亿元；收益率单位：%；指数单位：点；比率为 %。",
        "range": {"start": days[0], "end": days[-1], "trading_days": len(days)},
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    n = lambda k: sum(1 for r in rows if r[k] is not None)
    size_kb = OUT.stat().st_size / 1024
    log(f"已写出 {OUT}（{size_kb:.1f} KB，耗时 {time.time() - t_start:.1f}s）")
    log("  非空：" + "｜".join(f"{k} {n(k)}" for k in
        ("turnover_total", "float_mktcap", "us10y", "cn10y", "margin_total",
         "margin_rz_ratio", "turnover_ratio", "kospi", "star50")))

    # ---- 增量报告（stdout，给 npm run data:refresh 用） ----
    print("─" * 68)
    print(f"数据更新完成 · {datetime.now():%Y-%m-%d %H:%M:%S}｜耗时 {time.time() - t_start:.1f}s"
          f"｜{'离线模式（纯本地缓存）' if args.offline else '增量模式'}")
    print("─" * 68)
    for line in report:
        print("  " + line)
    print(f"  输出 public/data.json：{size_kb:.1f} KB，{len(rows)} 行"
          f"（非空：成交额 {n('turnover_total')}｜两融 {n('margin_total')}｜KOSPI {n('kospi')}）")
    print("  提示：页面每 30 秒自检一次数据版本，更新后会自动加载，无需手动刷新。")


if __name__ == "__main__":
    main()
