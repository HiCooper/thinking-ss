#!/usr/bin/env python3
"""记录**当日账户快照**，逐日累积成真实的收益走势。

与 `export_holdings.py` 的分工
------------------------------
    export_holdings.py : holdings.md --→ public/holdings.json      份额/成本（人工维护，低频变）
    本脚本             : holdings.json + 当日收盘价 --→ public/holdings-history.json
                                                                  账户每日市值/盈亏（一天一笔）

为什么必须逐日记录、不能事后回填
--------------------------------
账户的真实盈亏历史**无法从当前持仓反推**：份额是分批买入的，
用今天的份额去套过去的价格，只会得到一条"这一篮子的价格走势"，
而不是账户真的赚亏（实测这些持仓的成本价对应买入日散布在 3–153 个交易日之前）。

所以本脚本**只追加"当天"这一笔**，跑得越勤，曲线越完整。

用法
----
    python3 scripts/record_holdings_snapshot.py          # 记录最近一个交易日的收盘
    python3 scripts/record_holdings_snapshot.py --status  # 只看已积累多少天，不取数

**收盘后运行**（15:00 之后）。同一交易日重复运行会**覆盖**当天那条，不会重复追加，
所以收盘后多跑几次是安全的。非交易日运行会重新记录上一交易日，同样安全。

输出 `public/holdings-history.json`（**本地文件，不入库**，见仓库根 .gitignore）。
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # market-dashboard/
HOLDINGS = ROOT / "public" / "holdings.json"
HISTORY = ROOT / "public" / "holdings-history.json"

# 腾讯日K：一次取 5 根，够拿「最后一根」与「前一根」算当日盈亏。
# **必须用不复权（末位参数留空）**：算持仓市值要的是真实成交价，前复权（qfq）会在
# 除权日改写历史价、并与当日真实收盘价产生偏差（实测 159516/588000 两只差 0.002~0.004，
# 合计虚增市值 274 元）。不复权口径与看板用的新浪现价逐分对齐。
KLINE = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,,,5,"


# A 股收盘时间（与 plugin/localApi.ts 的 sessionOf 同一口径：15:00 之后算已收盘）
CLOSE_MINUTES = 15 * 60


def beijing_now() -> datetime:
    """北京时间。服务器时区不一定是 Asia/Shanghai，统一用 UTC+8 偏移。"""
    return datetime.now(timezone.utc) + timedelta(hours=8)


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def tencent_symbol(code: str) -> str:
    """6 位代码 → 腾讯符号。与 plugin/localApi.ts 的 sinaSymbol() 同规则。"""
    c = str(code).strip()
    if c[0] in "569":
        return f"sh{c}"
    if c[0] in "48":
        return f"bj{c}"
    return f"sz{c}"


def fetch_closes(symbol: str) -> list[tuple[str, float]]:
    """取最近 5 根日K，返回 [(日期, 收盘价), …]（升序）。"""
    url = KLINE.format(sym=symbol)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.load(resp)
    node = (payload.get("data") or {}).get(symbol) or {}
    bars = node.get("day") or node.get("qfqday") or []
    out: list[tuple[str, float]] = []
    for b in bars:
        try:
            out.append((str(b[0]), float(b[2])))       # [0]=日期 [2]=收盘
        except (IndexError, ValueError, TypeError):
            continue
    return out


SOURCE = "腾讯 fqkline 日K收盘价（不复权）× holdings.json 的份额/成本"
NOTE = (
    "每天收盘后运行 `npm run holdings:snapshot` 追加一笔（同一交易日重复运行会覆盖）。"
    "账户级汇总，不含逐只明细。**本地文件，不入库。**"
)


def load_history() -> dict:
    if not HISTORY.exists():
        return {"generated_at": "", "source": SOURCE, "note": NOTE, "days": []}
    try:
        data = json.loads(HISTORY.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"{HISTORY.name} 不是合法 JSON（{e}）。修好或删掉它再跑。")
    if not isinstance(data.get("days"), list):
        data["days"] = []
    # 元信息（口径说明）以当前脚本为准，避免旧文件一直带着过时的 source
    data["source"] = SOURCE
    data["note"] = NOTE
    return data


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true", help="只看已积累多少天，不取数")
    ap.add_argument(
        "--if-due",
        action="store_true",
        help="仅在「已收盘且今天还没记录」时补记一笔；否则静默跳过（供启动时自动检查用）",
    )
    args = ap.parse_args()

    if not HOLDINGS.exists():
        die(
            f"找不到 {HOLDINGS.relative_to(ROOT)}。\n"
            "  它是 `holdings.md` 导出的产物，先跑：\n"
            "      cd .. && cp holdings.example.md holdings.md   # 首次\n"
            "      npm run holdings:export"
        )

    history = load_history()

    if args.status:
        days = history["days"]
        print(f"■ 已积累 {len(days)} 个交易日")
        if days:
            print(f"  区间：{days[0]['date']} ~ {days[-1]['date']}")
            last = days[-1]
            print(f"  最新：市值 {last['market_value']:,.2f}｜浮动盈亏 {last['pnl']:+,.2f}（{last['pnl_pct']*100:+.2f}%）")
        else:
            print("  （还没有记录。收盘后跑一次 `npm run holdings:snapshot` 开始累积）")
        return

    # --if-due：先做两个「不联网就能判」的短路，避免白跑 22 次请求
    today = beijing_now().strftime("%Y-%m-%d")
    if args.if_due:
        last_rec = history["days"][-1]["date"] if history["days"] else None
        if last_rec == today:
            print(f"· 今日（{today}）已记录，无需补记")
            return
        now = beijing_now()
        if now.hour * 60 + now.minute < CLOSE_MINUTES:
            # 盘中/盘前绝不记：那时拿到的是实时价，不是收盘价，记下来就是错的
            print(f"· 尚未收盘（{now:%H:%M}），跳过；今天收盘后再跑一次即可")
            return
        print(f"· 今日（{today}）尚未记录且已收盘，尝试补记…")

    holdings = json.loads(HOLDINGS.read_text(encoding="utf-8"))
    rows = holdings.get("rows") or []
    if not rows:
        die(f"{HOLDINGS.name} 里没有持仓行")

    # 逐只取收盘价。按持仓算账户汇总，但**只输出账户级**数字。
    total_mv = 0.0
    total_cost = 0.0
    day_pnl = 0.0
    dates: set[str] = set()
    prev_dates: set[str] = set()
    failed: list[str] = []

    for r in rows:
        code, shares, cost = str(r["code"]), float(r["shares"]), float(r["cost"])
        try:
            bars = fetch_closes(tencent_symbol(code))
        except Exception as e:
            failed.append(f"{r['name']}（{code}）：{type(e).__name__}")
            continue
        if not bars:
            failed.append(f"{r['name']}（{code}）：无日K数据")
            continue

        date, close = bars[-1]
        dates.add(date)
        total_mv += shares * close
        total_cost += shares * cost
        # 当日盈亏用「该只自己的前一根收盘」算，这样即使记录有断档也准确
        if len(bars) >= 2:
            prev_dates.add(bars[-2][0])
            day_pnl += shares * (close - bars[-2][1])

    if failed:
        print("⚠️ 以下持仓取价失败，已从本次汇总中剔除：", file=sys.stderr)
        for f in failed:
            print(f"    {f}", file=sys.stderr)
    if not dates:
        die("所有持仓都取不到收盘价，未写入任何数据")

    if len(dates) > 1:
        die(
            f"各持仓的「最后交易日」不一致（{sorted(dates)}）——\n"
            "  通常是部分标的停牌或数据源滞后。为避免记出一个混合日期的快照，本次不写入。\n"
            "  稍后重试，或停牌期过后再跑。"
        )
    trade_date = dates.pop()
    prev_date = sorted(prev_dates)[-1] if prev_dates else None

    pnl = total_mv - total_cost
    prior_value = total_mv - day_pnl           # 昨收市值
    record = {
        "date": trade_date,
        "market_value": round(total_mv, 2),
        "cost": round(total_cost, 2),
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl / total_cost, 6) if total_cost > 0 else None,
        "day_pnl": round(day_pnl, 2),
        "day_pnl_pct": round(day_pnl / prior_value, 6) if prior_value > 0 else None,
        "prev_date": prev_date,
    }

    if args.if_due:
        last_rec = history["days"][-1]["date"] if history["days"] else None
        if trade_date == last_rec:
            print(f"· 最近交易日 {trade_date} 已记录（今天非交易日），无需补记")
            return
        if trade_date != today:
            print(f"· 今天（{today}）非交易日，最近交易日 {trade_date} 已记录，无需补记")
            return

    # 按交易日 upsert：同一交易日重复跑只覆盖，不追加
    days = [d for d in history["days"] if d.get("date") != trade_date]
    days.append(record)
    days.sort(key=lambda d: d["date"])
    history["days"] = days
    history["generated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    HISTORY.write_text(json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"✓ 已记录 {trade_date}（第 {len(days)} 个交易日）")
    print(f"  市值 {total_mv:>12,.2f}   成本 {total_cost:>12,.2f}   浮动盈亏 {pnl:>+12,.2f}（{pnl/total_cost*100:+.2f}%）")
    print(f"  当日盈亏 {day_pnl:>+10,.2f}（{day_pnl/prior_value*100:+.2f}%）" if prior_value > 0 else "")
    if len(failed):
        print(f"  ⚠️ {len(failed)} 只未纳入（见上），本次汇总不含它们")
    print(f"  产物：{HISTORY.relative_to(ROOT)}（本地文件，不入库）")


if __name__ == "__main__":
    main()
