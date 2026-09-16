#!/usr/bin/env python3
"""把仓库根目录的 holdings.md 转成看板可读的 public/holdings.json。

设计原则
--------
`holdings.md` 是**唯一人工维护的持仓源文件**（人写的表格 + 备注），本脚本只做单向转换，
所以不存在「两份持仓数据各写各的」的漂移问题。

**隐私**：`holdings.md` 与本脚本的输出 `public/holdings.json` **都不入库**（见仓库根 `.gitignore`，
处理方式同 `.env`），仓库里只保留 `holdings.example.md` 模板。所以 clone 下来没有持仓数据，
首次使用要先 `cp holdings.example.md holdings.md`。

**成本价不用 md 里显示的现价/成本列**：那两列是行情软件四舍五入后的值（如 0.773），
用它反算总成本会引入几元误差。改用 App 的权威口径反推：

    成本价 = (市值 − 盈亏) / 份额

市值与盈亏是行情软件直接给出的、彼此自洽的一对数，反推出的成本价是精确值。

**盈亏可正可负**：盈利持仓直接填正的盈亏即可，脚本不做符号限制，看板按有符号口径展示
（红涨绿跌、贡献占比以「盈亏绝对额之和」为分母）。

只固化**份额与成本**（稳定事实）；`snapshot_price` 只是快照时点现价，供无实时接口时降级渲染。

用法
----
    python3 scripts/export_holdings.py            # 写入 public/holdings.json
    python3 scripts/export_holdings.py --check     # 只校验，不写文件
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # market-dashboard/
MD = ROOT.parent / "holdings.md"                       # 仓库根 holdings.md
OUT = ROOT / "public" / "holdings.json"

# md 里用到的两个特殊符号：全角减号（负数）与截断标记
MINUS = "\u2212"
TRUNC = "\u1d57"  # ᵗ


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def clean(cell: str) -> str:
    """去掉 markdown 强调符、截断标记、全角空格，并把全角减号归一成 ASCII。"""
    s = cell.strip().replace("**", "").replace(TRUNC, "").replace("\u00a0", " ")
    s = s.replace(MINUS, "-")
    return s.strip()


def num(cell: str) -> float:
    s = clean(cell).replace(",", "").replace("%", "")
    if s in ("", "—", "-"):
        die(f"遇到空数值单元格：{cell!r}")
    try:
        return float(s)
    except ValueError:
        die(f"无法解析数值：{cell!r}")


def split_row(line: str) -> list[str]:
    """拆一行 markdown 表格：| a | b | → ['a', 'b']"""
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    return [c.strip() for c in body.split("|")]


def is_sep(line: str) -> bool:
    """|---|:--:| 这种分隔行。"""
    cells = split_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c != "")


def parse_groups(text: str) -> list[dict]:
    """解析所有 `### A. 组名（5 条 · 市值 … · 盈亏 …）` 标题。"""
    groups: list[dict] = []
    for m in re.finditer(r"^###\s+([A-Z])\.\s*(.+?)\s*$", text, re.MULTILINE):
        gid, raw = m.group(1), m.group(2)
        name = raw.split("（")[0].split("(")[0].strip()
        groups.append({"id": gid, "name": name, "pos": m.start()})
    if not groups:
        die("holdings.md 里没有解析到任何 `### X. 组名` 分组标题")
    return groups


def parse_holdings(text: str, groups: list[dict]) -> list[dict]:
    """解析每个分组下的 7 列明细表（名称|份额|现价|成本|市值|盈亏|盈亏%）。"""
    rows: list[dict] = []
    for i, g in enumerate(groups):
        start = g["pos"]
        end = groups[i + 1]["pos"] if i + 1 < len(groups) else len(text)
        block = text[start:end]
        header_seen = False
        for line in block.splitlines():
            if not line.strip().startswith("|"):
                continue
            if is_sep(line):
                continue
            cells = split_row(line)
            if len(cells) < 7:
                continue
            if clean(cells[0]) == "名称":       # 表头
                header_seen = True
                continue
            if not header_seen:
                continue

            name, shares_s, price_s, _cost_s, mv_s, pnl_s, _pct_s = cells[:7]
            name = clean(name)
            shares = num(shares_s)
            price = num(price_s)
            market_value = num(mv_s)
            pnl = num(pnl_s)

            if shares <= 0:
                die(f"{name}：份额非正（{shares}）")
            # 市值必须与 份额×现价 自洽，否则说明读错了列
            expected_mv = shares * price
            if abs(expected_mv - market_value) > max(0.5, market_value * 0.005):
                die(
                    f"{name}：市值不自洽 —— md 写 {market_value:,.2f}，"
                    f"但 份额×现价 = {shares:,}×{price} = {expected_mv:,.2f}"
                )
            # 盈亏可正可负，不做符号限制。这里只拦「成本价算出来非正」这种物理上不可能的情况
            # （成本 = (市值 − 盈亏)/份额，若盈亏畸形大就会翻负）。
            cost = (market_value - pnl) / shares
            if cost <= 0:
                die(
                    f"{name}：由 市值/盈亏 反推出的成本价为 {cost:.6f}（非正），"
                    f"请核对 市值（{market_value:,.2f}）与 盈亏（{pnl:,.2f}）是否填错"
                )

            # 权威成本价：由 市值/盈亏 反推，避免使用四舍五入后的显示成本
            rows.append(
                {
                    "name": name,
                    "code": None,          # 由 code 映射表补齐
                    "group": g["id"],
                    "shares": int(shares) if float(shares).is_integer() else shares,
                    "cost": round(cost, 6),
                    "snapshot_price": price,   # 快照时点的现价，仅用于「无实时接口」时的降级渲染
                    "_mv_md": market_value,    # 仅用于校验，不写入输出
                    "_pnl_md": pnl,
                }
            )
    if not rows:
        die("没有解析到任何持仓明细行")
    return rows


def parse_codes(text: str) -> dict[str, tuple[str, str]]:
    """解析「截图名 → (全称, 代码)」映射表（| 截图名 | 已确认全称 | 代码 |）。

    同时用「截图名」和「全称」两个键指向同一结果，这样明细表里写的是截断名还是全称都能匹配上。
    显示时统一用**全称**（截断名带省略号，不该出现在看板上）。
    """
    codes: dict[str, tuple[str, str]] = {}
    for line in text.splitlines():
        if not line.strip().startswith("|") or is_sep(line):
            continue
        cells = split_row(line)
        if len(cells) != 3:
            continue
        key = clean(cells[0])
        # 去掉「（LOF，非 ETF）」这类括注
        full = re.split(r"[（(]", clean(cells[1]))[0].strip()
        code = clean(cells[2])
        if code == "代码" or not re.fullmatch(r"\d{6}", code):
            continue
        if not full or not key:
            continue
        codes[key] = (full, code)
        codes[full] = (full, code)
    return codes


def meta_value(text: str, label: str) -> str | None:
    """从引用块里取 `> **标签**：值` 这类元信息。"""
    m = re.search(rf"^>\s*\*\*{re.escape(label)}\*\*\s*[:：]\s*(.+?)\s*$", text, re.MULTILINE)
    return clean(m.group(1)) if m else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    args = ap.parse_args()

    if not MD.exists():
        die(
            f"找不到持仓源文件：{MD}\n"
            "  持仓是**本地隐私文件**，不随仓库分发（处理方式同 .env），clone 下来是没有的。\n"
            "  首次使用请在仓库根目录执行：\n"
            "      cp holdings.example.md holdings.md\n"
            "  然后填入自己的持仓（格式见模板内「如何填」与 AGENTS.md §B5），再重跑本脚本。"
        )
    text = MD.read_text(encoding="utf-8")

    groups = parse_groups(text)
    rows = parse_holdings(text, groups)
    codes = parse_codes(text)

    missing = [r["name"] for r in rows if r["name"] not in codes]
    if missing:
        die(
            "以下持仓在「代码」映射表里找不到，无法确定证券代码：\n  - "
            + "\n  - ".join(missing)
            + "\n请在 holdings.md 的代码映射表中补齐后重跑。"
        )
    for r in rows:
        full, code = codes[r["name"]]
        r["name"] = full          # 统一用确认过的全称，丢弃截断名
        r["code"] = code

    # 同一代码不允许重复（否则实时行情会串行）
    seen: dict[str, str] = {}
    for r in rows:
        if r["code"] in seen:
            die(f"代码 {r['code']} 重复出现：{seen[r['code']]} 与 {r['name']}")
        seen[r["code"]] = r["name"]

    total_mv = sum(r["_mv_md"] for r in rows)
    total_cost = sum(r["shares"] * r["cost"] for r in rows)
    total_pnl = sum(r["_pnl_md"] for r in rows)
    # 盈亏绝对额之和（gross）。所有「贡献占比」都以它为分母 —— 这样对盈亏混合的组合也成立：
    #   全浮亏时 gross == |total_pnl|，退化成分母就是总亏损，与旧口径完全一致。
    gross_pnl = sum(abs(r["_pnl_md"]) for r in rows)
    winners = sum(1 for r in rows if r["_pnl_md"] > 0)
    losers = sum(1 for r in rows if r["_pnl_md"] < 0)

    as_of = meta_value(text, "快照时间") or "—"
    account = meta_value(text, "账户") or "—"

    # 组合层的「距成本」：亏损时为回本需涨，盈利时为可回撤空间（见前端同名指标）
    def breakeven(mv: float, cost: float) -> float | None:
        return (cost - mv) / mv if mv > 0 else None

    group_meta = []
    for g in groups:
        members = [r for r in rows if r["group"] == g["id"]]
        mv = sum(r["_mv_md"] for r in members)
        cost = sum(r["shares"] * r["cost"] for r in members)
        pnl = sum(r["_pnl_md"] for r in members)
        group_meta.append(
            {
                "id": g["id"],
                "name": g["name"],
                "count": len(members),
                "market_value": round(mv, 2),
                "cost": round(cost, 2),
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl / cost, 6) if cost > 0 else None,
                "weight": round(mv / total_mv, 6) if total_mv > 0 else 0,
                # 有符号的盈亏贡献占比：该组净盈亏 / 全部持仓盈亏绝对额之和
                "pnl_contribution": round(pnl / gross_pnl, 6) if gross_pnl > 0 else 0,
                "breakeven_pct": (
                    round(breakeven(mv, cost), 6) if breakeven(mv, cost) is not None else None
                ),
            }
        )

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "as_of": as_of,
        "account": account,
        "source": f"holdings.md（{MD.name}）· 由 scripts/export_holdings.py 生成",
        "note": "成本与份额是权威值；snapshot_price 是快照时点现价，仅在无实时接口时用于降级渲染。",
        "totals": {
            "count": len(rows),
            "market_value": round(total_mv, 2),
            "cost": round(total_cost, 2),
            "pnl": round(total_pnl, 2),
            "pnl_pct": round(total_pnl / total_cost, 6) if total_cost > 0 else None,
            "gross_pnl": round(gross_pnl, 2),
            "winners": winners,
            "losers": losers,
            "breakeven_pct": (
                round(breakeven(total_mv, total_cost), 6)
                if breakeven(total_mv, total_cost) is not None
                else None
            ),
        },
        "groups": group_meta,
        "rows": [
            {
                "name": r["name"],
                "code": r["code"],
                "group": r["group"],
                "shares": r["shares"],
                "cost": r["cost"],
                "snapshot_price": r["snapshot_price"],
            }
            for r in rows
        ],
    }

    print(f"✓ 解析 {len(rows)} 条持仓 · {len(groups)} 个分组（盈利 {winners} · 亏损 {losers}）")
    print(
        f"  市值 {total_mv:>12,.2f}   成本 {total_cost:>12,.2f}   "
        f"浮动盈亏 {total_pnl:>+12,.2f}"
    )
    print(f"  快照 {as_of} · 账户 {account}")
    for g in group_meta:
        share = g["pnl_contribution"] * 100
        print(
            f"    {g['id']}. {g['name'][:18]:<20} {g['count']:>2} 条  "
            f"市值 {g['market_value']:>11,.0f} ({g['weight']*100:>5.1f}%)  "
            f"盈亏 {g['pnl']:>+10,.0f} ({share:>+5.1f}% 贡献)"
        )

    if args.check:
        print("（--check：未写入文件）")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ 已写入 {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
