#!/usr/bin/env python3
"""收盘后与券商 App 对账。

把「券商报过来的几个总数」和「看板自算的同一口径」摆在一起，直接看差额，不靠临场算。

用法（先跑 ``npm run holdings:snapshot`` 记完当日水位再对账）::

    # 券商数字全给，逐项对照
    python3 scripts/reconcile_broker.py --market-value 123456.78 --cash 12345.67 \
        --today-pnl -234.56 --pnl -89012.34

    # 只给一两项也行（没给的项就只显示看板自算值）
    python3 scripts/reconcile_broker.py --today-pnl -234.56

口径约定（与券商 App 对齐，改这里前先看 .agents/skills/holdings-trade-bookkeeping/SKILL.md）：

- **持仓市值**  = Σ 份额 × 收盘价
- **浮动盈亏**  = 持仓市值 − Σ 份额 × 成本价
- **今日盈亏**  = Σ 份额 ×(收盘价 − 昨收) **＋ 当日卖出相对昨收的已实现**
  （券商是「当日累计」口径：卖掉的部分今天也产生了盈亏，会计入当日。
   只看剩余份额会让减仓当天正好差一半）
- **账户总值**  = 持仓市值 + 可用资金

常用对账阈值：金额绝对差 > 1 元 或 相对差 > 0.1% 就报警（费率/四舍五入之外的差异
都是口径问题，不是精度问题）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")

def prefix_of(code: str) -> str:
    """按 A 股代码规则推断交易所前缀：5/6 开头沪市（ETF 5xxxxx、股票 6xxxxx），
    其余（1/0/3 开头）深市。

    **刻意不写死持仓代码表**——那只基金代码属于持仓信息，不该进仓库；
    而且写死了别人 clone 下来就用不了。规则推断对场内 ETF / 股票都够用。
    """
    return "sh" if code[:1] in "56" else "sz"


def load_json(path: str, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fetch_close_prices(codes: list[str]) -> dict[str, dict]:
    """批量抓收盘价。返回 code → {name, price, prev_close}。"""
    syms = [prefix_of(c) + c for c in codes]
    url = "https://hq.sinajs.cn/list=" + ",".join(syms)
    req = urllib.request.Request(url, headers={"Referer": "https://finance.sina.com.cn"})
    txt = urllib.request.urlopen(req, timeout=20).read().decode("gbk")
    out: dict[str, dict] = {}
    for line in txt.strip().split("\n"):
        if '="' not in line:
            continue
        sym = line.split("hq_str_")[1].split("=")[0]
        f = line.split('"')[1].split(",")
        if len(f) < 4:
            continue
        code = sym[2:]
        try:
            # 新浪字段：f[1]=今开 f[2]=昨收 f[3]=现价（收盘后即收盘价）
            out[code] = {"name": f[0], "prev_close": float(f[2]), "price": float(f[3])}
        except ValueError:
            continue
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="与券商 App 对账")
    ap.add_argument("--market-value", type=float, help="券商：持仓市值")
    ap.add_argument("--cash", type=float, help="券商：可用资金")
    ap.add_argument("--today-pnl", type=float, help="券商：今日盈亏")
    ap.add_argument("--pnl", type=float, help="券商：持仓盈亏（浮动盈亏）")
    ap.add_argument("--total", type=float, help="券商：总资产（可选）")
    ap.add_argument("--tol", type=float, default=1.0, help="金额告警阈值，默认 1 元")
    args = ap.parse_args()

    holdings = load_json(os.path.join(PUB, "holdings.json"))
    if not holdings:
        print("✗ 没有 public/holdings.json，先跑 npm run holdings:export")
        return 1
    rows = holdings.get("rows", [])
    trades_file = load_json(os.path.join(PUB, "realized-trades.json"), {}) or {}
    cash_file = load_json(os.path.join(PUB, "cash.json"))

    import datetime

    today = (
        datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
    ).strftime("%Y-%m-%d")

    # 当日卖出，按 code 汇总两个口径：
    #   day    — 相对昨收（进「今日盈亏」，day_realized 缺失时用 (收盘价−昨收) 兜底）
    #   vs_cost — 相对摊薄成本（进「总盈亏」，pnl_vs_cost 缺失时用 (卖出价−成本) 兜底）
    # 两者差的就是这笔交易从头到尾的累计亏损，混用会让总盈亏差出一个量级。
    sold_day: dict[str, float] = {}
    sold_cost: dict[str, float] = {}
    for t in trades_file.get("trades", []):
        if t.get("date") != today:
            continue
        code = str(t.get("code"))
        shares = float(t.get("shares") or 0)
        dr = t.get("day_realized")
        sold_day[code] = sold_day.get(code, 0.0) + (float(dr) if dr is not None else 0.0)
        vc = t.get("pnl_vs_cost")
        if vc is not None:
            sold_cost[code] = sold_cost.get(code, 0.0) + float(vc)
        else:
            sold_cost[code] = sold_cost.get(code, 0.0) + shares * (
                float(t.get("price") or 0) - float(t.get("cost") or 0)
            ) - float(t.get("fee") or 0)

    codes = [r["code"] for r in rows] + [c for c in sold_day if c not in {r["code"] for r in rows}]
    px = fetch_close_prices(codes)

    mv = cost = today_base = 0.0
    missing = []
    credited = set()
    for r in rows:
        q = px.get(r["code"])
        if not q:
            missing.append(r["code"])
            continue
        shares = float(r["shares"])
        mv += shares * q["price"]
        cost += shares * float(r["cost"])
        row_today = shares * (q["price"] - q["prev_close"])
        if r["code"] in sold_day:
            row_today += sold_day[r["code"]]
            credited.add(r["code"])
        today_base += row_today

    # 清仓的（已不在持仓里）由这里兜底，与前端 portfolioTotals 同一判据
    outside = sum(v for k, v in sold_day.items() if k not in credited)
    today_pnl = today_base + outside
    pnl = mv - cost
    # 与券商「持仓收益」同口径的项：纯浮动 + 当日已实现（**相对成本**）。
    # 券商（两融）的「持仓收益」包含当日卖出的已实现盈亏，拿纯浮动去对会差出一大截、
    # 不是错误。真正该对的是这一行。等价形式：市值 + 卖出净额 − 原始总成本。
    realized_total = sum(sold_cost.values())
    cash_bal = float(cash_file.get("balance")) if cash_file else None
    total = mv + cash_bal if cash_bal is not None else None

    board = {
        "持仓市值": mv,
        "持仓成本": cost,
        "总盈亏(浮+当日已实现)": pnl + realized_total,
        "浮动盈亏(纯持仓)": pnl,
        "今日盈亏": today_pnl,
        "可用资金": cash_bal,
        "账户总值": total,
    }
    broker = {
        "持仓市值": args.market_value,
        "持仓成本": None,
        "总盈亏(浮+当日已实现)": args.pnl,
        "浮动盈亏(纯持仓)": None,
        "今日盈亏": args.today_pnl,
        "可用资金": args.cash,
        "账户总值": args.total,
    }

    print(f"对账日期 {today}（北京时间）  取到收盘价 {len(px)}/{len(codes)} 只")
    if missing:
        print(f"⚠️ 没取到报价：{', '.join(missing)}（未计入，差额会偏）")
    print()
    print(f"{'项':<10}{'看板自算':>16}{'券商':>16}{'差额':>14}   判定")
    print("-" * 62)
    bad = 0
    for k, bv in board.items():
        if bv is None:
            print(f"{k:<10}{'—':>16}{'—':>16}{'—':>14}   （缺 cash.json）")
            continue
        gv = broker[k]
        if gv is None:
            print(f"{k:<10}{bv:>16,.2f}{'（未报）':>16}{'':>14}")
            continue
        diff = bv - gv
        rel = abs(diff) / abs(gv) * 100 if gv else 0
        ok = abs(diff) <= args.tol or rel <= 0.1
        if not ok:
            bad += 1
        print(
            f"{k:<10}{bv:>16,.2f}{gv:>16,.2f}{diff:>14,.2f}   "
            f"{'✓' if ok else '✗ 超阈值'}"
        )
    print()

    if sold_day:
        print("当日卖出（已并入今日盈亏 / 总盈亏）：")
        for c, v in sold_day.items():
            tag = "减仓·并入行内" if c in credited else "清仓·总额兜底"
            print(
                f"  {c} {px.get(c, {}).get('name', '')}  当日 {v:+,.2f}｜"
                f"相对成本 {sold_cost.get(c, 0.0):+,.2f}  [{tag}]"
            )
        print()

    if bad:
        print(f"✗ {bad} 项对不上。按这个顺序排查：")
        print("  1. 今日盈亏差一半 → 券商是「当日累计」口径（含卖出部分），看板已按此实现；")
        print("     若仍差，检查 realized-trades.json 的 day_realized 是否填成了相对成本。")
        print("  2. 可用资金对不上 → 券商「可用」通常不含未交收的在途资金，「总资产」才含；")
        print("     卖出当日先拿「总资产」对 cash.json，次日再用「可用」。")
        print("  3. 市值差一点点 → 收盘价取的源不同（新浪 vs 券商），几分钱正常；")
        print("     差得多就是 holdings.md 的份额没同步改。")
        return 2

    print("✓ 已报项全部在阈值内" if any(v is not None for v in broker.values()) else "✓ 看板自算完成（未报券商数字）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
