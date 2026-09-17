#!/usr/bin/env python3
"""导出**分组相对强弱**：各组相对沪深300 的累计超额收益。

回答的问题
----------
大盘看板回答「今天该不该下场」，这张图回答「**该站在哪条腿上**」。
组间相对强弱的量级常常大于指数本身的振幅（实测 2026-09-14 → 09-17 三天：
半导体/算力 +4.61%、宽基 0.00%、港股中概软件 −0.93%、行业主题 −1.53%，
组间差 6.1pp），这是行业趋势交易里真正决定盈亏的那个维度。

口径
----
- **组内等权归一**：每个成员按窗口首日归一到 1，再对成员取算术平均 —— 即一个等权、
  首日再平衡的组指数。不用市值加权：这些 ETF 的规模与「这组的强弱」无关。
- **不做复权**（腾讯 `fqkline` 末位参数留空）：要的是真实成交价走势，与看板其他地方一致。
- **基准**：沪深300（`sh000300`）。
- `excess[%] = (组净值 / 基准净值 − 1) × 100`，窗口首日恒为 0，>0 即跑赢基准。
- 只收**整段窗口都有价**的成员（停牌/新上市导致缺口的一律剔除并打印），
  这样组指数不需要任何前值填充，序列干净、可复现。

输出 `public/groups.json`（**本地文件，不入库**）：它由 `holdings.json` 的分组派生，
等于间接暴露持仓结构，与 holdings.json 同级别的隐私。

用法
----
    python3 scripts/export_group_rs.py              # 导出（覆盖）
    python3 scripts/export_group_rs.py --status     # 只看当前文件的状态
    python3 scripts/export_group_rs.py --window 60  # 换窗口（交易日数，默认 120）
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # market-dashboard/
HOLDINGS = ROOT / "public" / "holdings.json"
OUT = ROOT / "public" / "groups.json"

DEFAULT_WINDOW = 120
BENCHMARK_CODE = "000300"
BENCHMARK_NAME = "沪深300"
# ⚠️ 指数的交易所前缀**不能**按 tencent_symbol() 的「首位数字」规则推：
#    000300 首位是 0，那套规则会给出 sz000300（不存在），接口返回 code=0 但 data 里没有 day 数组——
#    报错信息完全看不出是代码写错了。指数的前缀是发行方决定的，这里写死。
BENCHMARK_SYMBOL = "sh000300"

# 腾讯日K：一次多取几根，保证在窗口之外还有余量可对齐
KLINE = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,,,{n},"


def beijing_now() -> datetime:
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


def fetch_closes(symbol: str, n: int, retries: int = 2) -> dict[str, float]:
    """取最近 n 根日K，返回 {日期: 收盘}。失败抛异常，由调用方决定是跳过还是终止。

    腾讯偶发返回空 `data`（实测同一 URL 几分钟内一次空一次正常），所以带一次重试 ——
    否则基准那一发失败会让整次导出白跑。
    """
    url = KLINE.format(sym=symbol, n=n)
    last = ""
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = json.load(resp)
            node = (payload.get("data") or {}).get(symbol) or {}
            bars = node.get("day") or node.get("qfqday") or []
            out: dict[str, float] = {}
            for b in bars:
                try:
                    out[str(b[0])] = float(b[2])        # [0]=日期 [2]=收盘
                except (IndexError, ValueError, TypeError):
                    continue
            if out:
                return out
            last = f"data 里没有 day 数组（code={payload.get('code')} msg={payload.get('msg')}）"
        except Exception as e:                                      # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
        if attempt < retries:
            time.sleep(0.8)
    raise ValueError(last or "未知错误")


SOURCE = (
    "腾讯 fqkline 日K收盘价（不复权）；组内成员各自按窗口首日归一到 1 后等权平均；"
    f"基准 {BENCHMARK_NAME}（{BENCHMARK_CODE}）"
)
NOTE = (
    "各组相对基准的累计超额收益（%），窗口首日恒为 0。"
    "由 holdings.json 的分组派生，**本地文件，不入库**。"
    "运行 `npm run groups:export` 更新。"
)


def load_holdings() -> dict:
    if not HOLDINGS.exists():
        die(
            f"找不到 {HOLDINGS.relative_to(ROOT.parent)}。\n"
            "  先建持仓：cp holdings.example.md holdings.md && npm run holdings:export"
        )
    try:
        return json.loads(HOLDINGS.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"{HOLDINGS.name} 不是合法 JSON：{e}")


def build(window: int) -> dict:
    h = load_holdings()
    groups = h.get("groups") or []
    rows = h.get("rows") or []
    if not groups or not rows:
        die("holdings.json 里没有 groups/rows —— 先跑 npm run holdings:export")

    # group id → 成员代码（去重，保持文件顺序）
    members: dict[str, list[str]] = {g["id"]: [] for g in groups}
    for r in rows:
        gid, code = r.get("group"), str(r.get("code") or "").strip()
        if gid in members and code and code not in members[gid]:
            members[gid].append(code)

    print(f"▶ 抓取基准 {BENCHMARK_NAME}（{BENCHMARK_CODE}）与 {len(rows)} 只成员的日K…")
    bench = fetch_closes(BENCHMARK_SYMBOL, window + 30)
    days = sorted(bench)[-window:]
    if len(days) < 30:
        die(f"基准只有 {len(days)} 个交易日，窗口太短，放弃")

    series: dict[str, dict[str, float]] = {}
    failed: list[str] = []
    for gid in members:
        for code in members[gid]:
            sym = tencent_symbol(code)
            try:
                series[code] = fetch_closes(sym, window + 30)
            except Exception as e:                                  # noqa: BLE001
                failed.append(f"{code}（{type(e).__name__}: {e}）")
                series[code] = {}

    out_groups = []
    for g in groups:
        gid = g["id"]
        covered, skipped = [], []
        for code in members[gid]:
            closes = series.get(code) or {}
            # 只收**整段窗口都有价**的成员：这样组指数不需要任何前值填充
            if all(d in closes for d in days):
                covered.append(code)
            else:
                skipped.append(code)
        if not covered:
            print(f"  ⚠ 组 {gid}（{g.get('name','')}）没有成员覆盖整段窗口，跳过")
            continue

        nav: list[float] = []
        for i, d in enumerate(days):
            acc = 0.0
            for code in covered:
                base = series[code][days[0]]
                acc += series[code][d] / base if base else 1.0
            nav.append(acc / len(covered))

        bn = [bench[d] / bench[days[0]] for d in days]
        excess = [round((nav[i] / bn[i] - 1) * 100, 3) for i in range(len(days))]

        tail = "" if not skipped else f"（剔除 {len(skipped)} 只窗口不完整：{','.join(skipped)}）"
        print(
            f"  · {gid} {g.get('name','')}：{len(covered)} 只等权，"
            f"窗口累计 {((nav[-1] - 1) * 100):+.2f}%，相对基准 {excess[-1]:+.2f}pp{tail}"
        )
        out_groups.append(
            {
                "id": gid,
                "name": g.get("name", gid),
                "members": covered,
                "excluded": skipped,
                "nav": [round(v, 6) for v in nav],
                "excess": excess,
            }
        )

    return {
        "generated_at": beijing_now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": SOURCE,
        "note": NOTE,
        "window": window,
        "as_of": days[-1] if days else None,
        "benchmark": {"code": BENCHMARK_CODE, "name": BENCHMARK_NAME, "nav": [round(v, 6) for v in bn]},
        "days": days,
        "groups": out_groups,
        "errors": failed,
    }


def cmd_status() -> None:
    if not OUT.exists():
        print("还没有 groups.json —— 跑 `npm run groups:export` 生成")
        return
    data = json.loads(OUT.read_text(encoding="utf-8"))
    days = data.get("days") or []
    print(f"文件：{OUT.relative_to(ROOT.parent)}")
    print(f"生成于：{data.get('generated_at') or '—'}　｜　窗口 {data.get('window')} 个交易日")
    print(f"区间：{days[0] if days else '—'} ~ {data.get('as_of') or '—'}")
    for g in data.get("groups") or []:
        ex = g.get("excess") or []
        label = f"{g['id']} {g.get('name', '')}"
        n = len(g.get("members") or [])
        if ex:
            print(f"  {label}：{n} 只，最新超额 {float(ex[-1]):+.2f}pp")
        else:
            print(f"  {label}：无数据")
    if data.get("errors"):
        print("  抓取失败：", "；".join(data["errors"]))


def main() -> None:
    ap = argparse.ArgumentParser(description="导出自选分组的相对强弱（相对沪深300）")
    ap.add_argument("--status", action="store_true", help="只看当前文件状态，不取数")
    ap.add_argument("--window", type=int, default=DEFAULT_WINDOW, help=f"窗口交易日数（默认 {DEFAULT_WINDOW}）")
    args = ap.parse_args()

    if args.status:
        cmd_status()
        return

    data = build(args.window)
    if not data["groups"]:
        die("没有任何分组可用（成员都缺窗口内的价？）")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ 已写入 {OUT.relative_to(ROOT.parent)}（{len(data['groups'])} 组 · {len(data['days'])} 个交易日 · 至 {data['as_of']}）")
    if data["errors"]:
        print(f"  ⚠ {len(data['errors'])} 只抓取失败：", "；".join(data["errors"]), file=sys.stderr)


if __name__ == "__main__":
    main()
