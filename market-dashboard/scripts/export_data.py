#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""导出「大盘看板」数据 → public/data.json

三组序列（全部按 A 股交易日对齐）：
  1. 两市成交额（亿元）—— 交易所官方 EOD（stock_sse_deal_daily + stock_szse_summary），逐日抓取 + 本地缓存
  2. 国债收益率（%）—— 美国 10Y / 中国 10Y（新浪全球国债端点 bond.finance.sina.com.cn/hq/gb/daily）
  3. 融资融券（亿元）—— 沪深两融余额（akshare macro_china_market_margin_sh/sz）

用法（必须用 ashare-data 的 venv 跑，因为需要 akshare）：
  $SKILLS/ashare-data/.venv/bin/python scripts/export_data.py [--days 250]

说明：
  - 官方成交额接口一次只能取一天，250 天 ≈ 100 秒；缓存存在 scripts/.turnover_cache.json，
    重复运行只补缺失日期。
  - 收益率按 A 股日历**前值填充**（美股/欧股休市日沿用上一收盘），符合分析师习惯。
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


# ---------- 1) A 股交易日历 ----------
def trading_days(n):
    """最近 n 个交易日（含今日），来自腾讯上证指数日 K。"""
    url = f"https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=sh000001,day,,,{n + 60}"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20).json()
    days = [x[0] for x in r["data"]["sh000001"]["day"]]
    return days[-n:]


# ---------- 2) 两市成交额（官方，逐日 + 缓存） ----------
def load_cache():
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text())
        except Exception:
            return {}
    return {}


def save_cache(cache):
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0))


def turnover_one(date):
    """date: 'YYYY-MM-DD' → (沪亿, 深亿)。"""
    d = date.replace("-", "")
    sh = ak.stock_sse_deal_daily(date=d)
    sh_amt = float(sh.loc[sh["单日情况"] == "成交金额", "股票"].iloc[0])       # 已是亿元
    sz = ak.stock_szse_summary(date=d)
    sz_amt = float(sz.loc[sz["证券类别"] == "股票", "成交金额"].iloc[0]) / 1e8  # 元 → 亿元
    return sh_amt, sz_amt


def build_turnover(days):
    cache = load_cache()
    todo = [d for d in days if d not in cache]
    log(f"[成交额] 需抓取 {len(todo)} 天（命中缓存 {len(days) - len(todo)} 天），约 {len(todo) * 0.4:.0f} 秒")
    t0 = time.time()
    for i, d in enumerate(todo, 1):
        try:
            sh, sz = turnover_one(d)
            cache[d] = [round(sh, 1), round(sz, 1)]
        except Exception:
            cache[d] = None      # 记录失败，避免每次重试拖慢
        if i % 20 == 0 or i == len(todo):
            log(f"  {i}/{len(todo)}  {d}  已用 {time.time() - t0:.0f}s")
    save_cache(cache)
    ok = sum(1 for d in days if cache.get(d))
    log(f"[成交额] 完成：{ok}/{len(days)} 天有值")
    return {d: cache.get(d) for d in days}


# ---------- 3) 国债收益率 ----------
def bond_series(symbol, days):
    url = f"https://bond.finance.sina.com.cn/hq/gb/daily?symbol={symbol}"
    data = requests.get(url, headers=UA, timeout=20).json()["result"]["data"]
    return {x["d"]: float(x["c"]) for x in data}


def build_bonds(days):
    out = {}
    for sym, key in (("US10YT", "us10y"), ("CN10YT", "cn10y")):
        m = bond_series(sym, days)
        # 按 A 股日历前值填充（休市沿用上一收盘）
        last = None
        filled = {}
        # 先取窗口之前最近的一个值作为起点
        for d in sorted(m):
            if d < days[0]:
                last = m[d]
        for d in days:
            if d in m:
                last = m[d]
            filled[d] = round(last, 4) if last is not None else None
        out[key] = filled
        log(f"[国债] {sym}: 实际有值 {sum(1 for d in days if d in m)} 天，前值填充后 {sum(1 for v in filled.values() if v is not None)} 天")
    return out


# ---------- 4) 融资融券 ----------
def build_margin(days):
    def side(df):
        df = df[["日期", "融资余额", "融券余额"]].copy()
        df["日期"] = pd.to_datetime(df["日期"]).dt.strftime("%Y-%m-%d")
        for c in ("融资余额", "融券余额"):
            df[c] = pd.to_numeric(df[c], errors="coerce") / 1e8      # 元 → 亿元
        return df.set_index("日期")

    sh, sz = side(ak.macro_china_market_margin_sh()), side(ak.macro_china_market_margin_sz())
    m = sh.add(sz, fill_value=0)
    rz = m["融资余额"].round(1).to_dict()
    rq = m["融券余额"].round(1).to_dict()
    log(f"[两融] 覆盖 {len(rz)} 天，最新 {max(rz) if rz else '—'}")
    return rz, rq


# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=250, help="交易日数量（默认 250，约一年）")
    args = ap.parse_args()

    days = trading_days(args.days)
    log(f"日历：{days[0]} ~ {days[-1]}（{len(days)} 个交易日）")

    turnover = build_turnover(days)
    bonds = build_bonds(days)
    rz, rq = build_margin(days)

    rows = []
    for d in days:
        t = turnover.get(d)
        total = round(t[0] + t[1], 1) if t else None
        rows.append({
            "date": d,
            "turnover_sh": t[0] if t else None,
            "turnover_sz": t[1] if t else None,
            "turnover_total": total,
            "us10y": bonds["us10y"].get(d),
            "cn10y": bonds["cn10y"].get(d),
            "margin_rz": rz.get(d),
            "margin_rq": rq.get(d),
            "margin_total": round(rz[d] + rq[d], 1) if d in rz and d in rq else None,
        })

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M") + " CST",
        "sources": "成交额=上交所/深交所官方日度（stock_sse_deal_daily + stock_szse_summary）；"
                   "国债收益率=新浪全球国债（US10YT/CN10YT，按A股日历前值填充）；"
                   "两融=沪深交易所宏观序列（akshare macro_china_market_margin_sh/sz）。金额单位：亿元；收益率单位：%",
        "range": {"start": days[0], "end": days[-1], "trading_days": len(days)},
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    filled = lambda k: sum(1 for r in rows if r[k] is not None)
    log(f"已写出 {OUT}")
    log(f"  非空：成交额 {filled('turnover_total')}｜美债 {filled('us10y')}｜中债 {filled('cn10y')}｜两融 {filled('margin_total')}")


if __name__ == "__main__":
    main()
