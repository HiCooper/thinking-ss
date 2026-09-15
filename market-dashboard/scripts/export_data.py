#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""导出「大盘看板」数据 → public/data.json

序列（全部按 A 股交易日对齐，单位：亿元 / % / 点）：
  1. 两市成交额           交易所官方 EOD（stock_sse_deal_daily + stock_szse_summary），逐日抓取 + 本地缓存
  2. 沪深流通市值         **同一对接口顺带取到**（零额外请求）→ 用于把杠杆与成交额做规模归一
  3. 国债收益率           美国 10Y / 中国 10Y（新浪全球国债 bond.finance.sina.com.cn/hq/gb/daily）
  4. 融资融券             沪深两融余额（akshare macro_china_market_margin_sh/sz）
  5. 韩国 KOSPI 收盘      东财 index_global_hist_em（代理间歇拦截；失败则该列全 null）
  6. 科创50 收盘          腾讯日 K（sh000688）

派生字段：
  margin_rz_ratio = 融资余额 / 沪深流通市值 × 100   （杠杆率，跨时间可比）
  turnover_ratio  = 成交额   / 沪深流通市值 × 100   （全市场换手率）

用法（必须用带 akshare 的 venv）：
  $SKILLS/ashare-data/.venv/bin/python scripts/export_data.py [--days 250]

说明：
  - 官方接口一次只取一天，250 天 ≈ 50 秒；缓存 scripts/.turnover_cache.json 存
    [沪成交, 深成交, 沪流通市值, 深流通市值]，老版 2 元缓存会自动重取。
  - 收益率按 A 股日历**前值填充**（海外休市沿用上一收盘）。
  - 任一字段缺失写 null，前端图表需能容忍。
"""
import argparse
import json
import sys
import time
import warnings
from datetime import datetime
from pathlib import Path

warnings.filterwarnings("ignore")

import akshare as ak
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data.json"
CACHE = Path(__file__).resolve().parent / ".turnover_cache.json"
UA = {"User-Agent": "Mozilla/5.0", "Referer": "https://stock.finance.sina.com.cn/"}


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ---------- 交易日历 / 腾讯日K ----------
def tx_daily(symbol, n):
    """腾讯日 K → [(日期, 收盘), ...]（最近 n 根）。"""
    url = f"https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param={symbol},day,,,{n + 60}"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20).json()
    rows = r["data"][symbol]["day"]
    return [(x[0], float(x[2])) for x in rows]


def trading_days(n):
    return [d for d, _ in tx_daily("sh000001", n)][-n:]


# ---------- 两市成交额 + 流通市值（官方，逐日 + 缓存） ----------
def load_cache():
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text())
        except Exception:
            return {}
    return {}


def save_cache(cache):
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0))


def official_one(date):
    """→ (沪成交亿, 深成交亿, 沪流通市值亿, 深流通市值亿)。"""
    d = date.replace("-", "")
    sse = ak.stock_sse_deal_daily(date=d)
    pick = lambda row: float(sse.loc[sse["单日情况"] == row, "股票"].iloc[0])
    sh_amt, sh_float = pick("成交金额"), pick("流通市值")          # 均为亿元
    szse = ak.stock_szse_summary(date=d)
    sz_row = szse.loc[szse["证券类别"] == "股票"].iloc[0]
    sz_amt = float(sz_row["成交金额"]) / 1e8                       # 元 → 亿元
    sz_float = float(sz_row["流通市值"]) / 1e8                     # 元 → 亿元
    return round(sh_amt, 1), round(sz_amt, 1), round(sh_float, 1), round(sz_float, 1)


def build_official(days):
    cache = load_cache()
    todo = [d for d in days if not (isinstance(cache.get(d), list) and len(cache[d]) == 4)]
    log(f"[成交额/流通市值] 需抓取 {len(todo)} 天（缓存命中 {len(days) - len(todo)} 天），约 {len(todo) * 0.2:.0f} 秒")
    t0 = time.time()
    for i, d in enumerate(todo, 1):
        try:
            cache[d] = list(official_one(d))
        except Exception:
            cache[d] = None                      # 记录失败，避免每次重试拖慢
        if i % 25 == 0 or i == len(todo):
            log(f"  {i}/{len(todo)}  {d}  已用 {time.time() - t0:.0f}s")
    save_cache(cache)
    ok = sum(1 for d in days if isinstance(cache.get(d), list) and len(cache[d]) == 4)
    log(f"[成交额/流通市值] 完成：{ok}/{len(days)} 天有值")
    return {d: (cache[d] if isinstance(cache.get(d), list) and len(cache[d]) == 4 else None) for d in days}


# ---------- 国债收益率 ----------
def build_bonds(days):
    out = {}
    for sym, key in (("US10YT", "us10y"), ("CN10YT", "cn10y")):
        data = requests.get(f"https://bond.finance.sina.com.cn/hq/gb/daily?symbol={sym}",
                            headers=UA, timeout=20).json()["result"]["data"]
        m = {x["d"]: float(x["c"]) for x in data}
        last = None
        for d in sorted(m):                       # 窗口起点之前的最近值作为前值填充起点
            if d < days[0]:
                last = m[d]
        filled = {}
        for d in days:
            if d in m:
                last = m[d]
            filled[d] = round(last, 4) if last is not None else None
        out[key] = filled
        log(f"[国债] {sym}: 实际有值 {sum(1 for d in days if d in m)} 天")
    return out


# ---------- 融资融券 ----------
def build_margin(days):
    def side(df):
        df = df[["日期", "融资余额", "融券余额"]].copy()
        df["日期"] = pd.to_datetime(df["日期"]).dt.strftime("%Y-%m-%d")
        for c in ("融资余额", "融券余额"):
            df[c] = pd.to_numeric(df[c], errors="coerce") / 1e8      # 元 → 亿元
        return df.set_index("日期")

    m = side(ak.macro_china_market_margin_sh()).add(side(ak.macro_china_market_margin_sz()), fill_value=0)
    log(f"[两融] 覆盖 {len(m)} 天，最新 {max(m.index)}")
    return m["融资余额"].round(1).to_dict(), m["融券余额"].round(1).to_dict()


# ---------- 韩国 KOSPI（东财源，可能被代理挡） ----------
def build_kospi(days):
    try:
        df = ak.index_global_hist_sina(symbol="首尔综合指数")
        dates = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
        m = dict(zip(dates, pd.to_numeric(df["close"], errors="coerce")))
        got = sum(1 for d in days if d in m)
        log(f"[KOSPI] 来源=新浪(gi.finance.sina.com.cn)，实际有值 {got}/{len(days)} 天")
        # 韩国与 A 股交易日高度重叠，缺的少量用前值填充
        last, filled = None, {}
        for d in sorted(m):
            if d < days[0]:
                last = m[d]
        for d in days:
            if d in m:
                last = m[d]
            filled[d] = round(last, 2) if last is not None else None
        return filled
    except Exception as e:
        log(f"[KOSPI] 新浪源失败（{type(e).__name__}），退回东财")
        try:
            df = ak.index_global_hist_em(symbol="韩国KOSPI")
            dates = pd.to_datetime(df["日期"]).dt.strftime("%Y-%m-%d")
            m = dict(zip(dates, pd.to_numeric(df["最新价"], errors="coerce")))
            last, filled = None, {}
            for d in sorted(m):
                if d < days[0]:
                    last = m[d]
            for d in days:
                if d in m:
                    last = m[d]
                filled[d] = round(last, 2) if last is not None else None
            log(f"[KOSPI] 来源=东财，实际有值 {sum(1 for d in days if d in m)}/{len(days)} 天")
            return filled
        except Exception as e2:
            log(f"[KOSPI] 两源均失败（{type(e2).__name__}）→ 该列全为 null")
            return {d: None for d in days}


# ---------- 科创50 ----------
def build_star50(days):
    m = dict(tx_daily("sh000688", len(days) + 10))
    log(f"[科创50] 实际有值 {sum(1 for d in days if d in m)}/{len(days)} 天")
    return {d: (round(m[d], 2) if d in m else None) for d in days}


# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=250, help="交易日数量（默认 250，约一年）")
    args = ap.parse_args()

    days = trading_days(args.days)
    log(f"日历：{days[0]} ~ {days[-1]}（{len(days)} 个交易日）")

    official = build_official(days)
    bonds = build_bonds(days)
    rz, rq = build_margin(days)
    kospi = build_kospi(days)
    star50 = build_star50(days)

    rows = []
    for d in days:
        o = official.get(d)
        sh, sz, sh_f, sz_f = o if o else (None, None, None, None)
        total = round(sh + sz, 1) if (sh is not None and sz is not None) else None
        float_cap = round(sh_f + sz_f, 1) if (sh_f is not None and sz_f is not None) else None
        rz_d, rq_d = rz.get(d), rq.get(d)
        rows.append({
            "date": d,
            "turnover_sh": sh, "turnover_sz": sz, "turnover_total": total,
            "float_mktcap": float_cap,
            "turnover_ratio": round(total / float_cap * 100, 3) if (total and float_cap) else None,
            "us10y": bonds["us10y"].get(d), "cn10y": bonds["cn10y"].get(d),
            "margin_rz": rz_d, "margin_rq": rq_d,
            "margin_total": round(rz_d + rq_d, 1) if (rz_d is not None and rq_d is not None) else None,
            "margin_rz_ratio": round(rz_d / float_cap * 100, 3) if (rz_d is not None and float_cap) else None,
            "kospi": kospi.get(d), "star50": star50.get(d),
        })

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M") + " CST",
        "sources": "成交额与流通市值=上交所/深交所官方日度（stock_sse_deal_daily + stock_szse_summary）；"
                   "国债收益率=新浪全球国债（US10YT/CN10YT，按A股日历前值填充）；"
                   "两融=沪深交易所宏观序列（akshare macro_china_market_margin_sh/sz）；"
                   "KOSPI=东财 index_global_hist_em（代理偶发拦截）；科创50=腾讯日K。"
                   "金额单位：亿元；收益率单位：%；指数单位：点；比率为 %。",
        "range": {"start": days[0], "end": days[-1], "trading_days": len(days)},
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    n = lambda k: sum(1 for r in rows if r[k] is not None)
    log(f"已写出 {OUT}")
    log("  非空：" + "｜".join(f"{k} {n(k)}" for k in
        ("turnover_total", "float_mktcap", "us10y", "cn10y", "margin_total",
         "margin_rz_ratio", "turnover_ratio", "kospi", "star50")))


if __name__ == "__main__":
    main()
