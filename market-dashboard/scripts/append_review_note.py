#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「今天盘面怎么看」这一句话落到 `public/review-notes.json`（每日复盘卡的研判行）。

分工要说清楚，这是这个脚本存在的全部理由：

  · 复盘卡的**骨架**（档位 / 结论 / 证据 / 企稳条件 / 观察线）由前端 `src/review.ts`
    从 `public/data.json` 现算，不经过这里。
  · 这里只写**主观那一行**。而且连它引用的数字也不让作者手填 —— `refs` 一律由脚本
    从 data.json 复算（MA20/MA60 的算法与 `src/calc.ts` 的 `movingAverage` 逐字对齐，
    分位与 `src/stats.ts` 的百分位排名对齐）。作者能改的只有文字，改不了读数。

校验（不过就直接拒写，不产生半成品文件）：
  1. `as_of` 必须等于「沪深300 收盘 + MA20 + MA60 都有效」的最近一个交易日。
     不等于就**不会显示**（前端只渲染 as_of 与复盘日完全一致的那条），写了等于没写，
     所以在这里就拦掉，而不是等到页面上发现。
  2. 研判必须至少含一个数字 —— 用来挡住「情绪偏弱」「风险较大」这类形容词结案。
  3. 长度 ≤ `MAX_JUDGMENT_CHARS`，超过就报错：这张卡是核心总结，不是报告。
  4. 不得出现持仓与账户口径的词（含「数字 + 元」）：本文件随仓库提交，
     口径同 `data.json`；账户级的判断请在会话里说，不要写进会入库的文件。

同一 `as_of` 重跑**覆盖**该条（幂等，与 `record_holdings_snapshot.py` 同一约定）。
历史条目只增不删：这份文字序列以后是校准「判断准不准」的原始记录。

用法（一般在收盘流程里由 agent 调用）：
    python3 scripts/append_review_note.py --judgment "……"
    python3 scripts/append_review_note.py --status
    python3 scripts/append_review_note.py --judgment "……" --check   # 只校验不落盘
"""
import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data.json"
OUT = ROOT / "public" / "review-notes.json"

MAX_JUDGMENT_CHARS = 80
PERCENTILE_WINDOW = 250
MIN_PERCENTILE_SAMPLES = 20

# 随仓库提交的文件里不允许出现的账户/持仓口径词。
# 命中即拒写 —— 这不是精度问题，是隐私问题（口径见 AGENTS.md 的「隐私」块）。
PRIVACY_WORDS = (
    "份额", "成本价", "摊薄", "清仓", "浮亏", "已实现", "盈亏",
    "账户", "现金", "可用资金", "持仓", "总市值",
)
AMOUNT_IN_YUAN = re.compile(r"\d[\d,，.]*\s*元")
HAS_NUMBER = re.compile(r"\d")


def beijing_now():
    return datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=8)))


def load_rows():
    if not DATA.exists():
        sys.exit(f"✗ 缺少 {DATA.relative_to(ROOT.parent)} —— 先跑 npm run data:refresh")
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    return payload.get("rows") or []


def moving_average(values, window):
    """与 src/calc.ts 的 movingAverage 一致：null 不占窗口，攒够 window 个有效值才出值。"""
    out, buf = [None] * len(values), []
    for i, v in enumerate(values):
        if isinstance(v, (int, float)):
            buf.append(v)
        if len(buf) >= window:
            out[i] = sum(buf[-window:]) / window
    return out


def percentile_rank(values, current):
    """与 src/stats.ts 一致：尾部 N 个有效值里「≤ current」的占比；样本不足返回 None。"""
    if not isinstance(current, (int, float)):
        return None
    tail = [v for v in values if isinstance(v, (int, float))][-PERCENTILE_WINDOW:]
    if len(tail) < MIN_PERCENTILE_SAMPLES:
        return None
    return round(sum(1 for v in tail if v <= current) / len(tail) * 100, 1)


def review_anchor(rows):
    """复盘日 = 收盘 + MA20 + MA60 都有效的最近一行。

    必须与 src/trend.ts 的 `trendStateOf` 逐字一致 —— 前端卡片显示的日期就是它，
    这里多要求一个字段，就会在某个成交额缺失的日子算出更早的日期，
    于是研判写进了文件却永不显示（前端按 as_of === 卡片日期匹配）。
    """
    closes = [r.get("hs300") for r in rows]
    ma20, ma60 = moving_average(closes, 20), moving_average(closes, 60)
    for i in range(len(rows) - 1, -1, -1):
        if isinstance(closes[i], (int, float)) and isinstance(ma20[i], (int, float)) \
                and isinstance(ma60[i], (int, float)):
            return i, closes[i], ma20[i], ma60[i]
    return None, None, None, None


def build_refs(rows):
    """复算研判所依赖的读数。前端显示时也用同一份现算值，这里的 refs 只作溯源。"""
    i, close, ma20, ma60 = review_anchor(rows)
    if i is None:
        return None
    def col(key):
        return [r.get(key) for r in rows]
    def latest(key):
        for j in range(len(rows) - 1, -1, -1):
            v = rows[j].get(key)
            if isinstance(v, (int, float)):
                return j, v
        return None, None
    rz_j, rz = latest("margin_rz")
    rz_prev = next((rows[j].get("margin_rz") for j in range(rz_j - 1, -1, -1)
                    if isinstance(rows[j].get("margin_rz"), (int, float))), None) if rz_j else None
    lev_j, lev = latest("margin_rz_ratio")
    _, t = latest("turnover_total")
    return {
        "as_of": rows[i]["date"],
        "hs300": close,
        "ma20": round(ma20, 2),
        "ma60": round(ma60, 2),
        "dev_ma20_pct": round((close - ma20) / ma20 * 100, 2),
        "turnover_total": t,
        "turnover_pct_rank": percentile_rank(col("turnover_total"), t),
        "margin_rz": rz,
        "margin_rz_diff": round(rz - rz_prev, 1) if isinstance(rz, (int, float)) and isinstance(rz_prev, (int, float)) else None,
        "margin_rz_as_of": rows[rz_j]["date"] if rz_j is not None else None,
        "margin_rz_ratio": lev,
        "leverage_pct_rank": percentile_rank(col("margin_rz_ratio"), lev),
        "adv_count": latest("adv_count")[1],
        "dec_count": latest("dec_count")[1],
        "breadth_high20": latest("breadth_high20")[1],
        "breadth_low20": latest("breadth_low20")[1],
        "us10y": latest("us10y")[1],
    }


def check(judgment, as_of, refs):
    errs = []
    if not judgment or not judgment.strip():
        errs.append("研判为空")
    text = (judgment or "").strip()
    if len(text) > MAX_JUDGMENT_CHARS:
        errs.append(f"研判 {len(text)} 字，超过上限 {MAX_JUDGMENT_CHARS} 字"
                    "（这张卡只要核心总结；长分析请在会话里说）")
    if not HAS_NUMBER.search(text):
        errs.append("研判里没有绑定任何数字 —— 「情绪偏弱」这类形容词结案是被禁止的")
    hit = [w for w in PRIVACY_WORDS if w in text]
    if hit:
        errs.append(f"研判含账户/持仓口径词 {hit}：本文件随仓库提交，只能谈指数与市场")
    if AMOUNT_IN_YUAN.search(text):
        errs.append("研判里出现「数字 + 元」的金额：同上，账户金额不要写进入库文件")
    if refs is None:
        errs.append("data.json 里凑不齐「收盘 + MA20 + MA60」三要素，无法定复盘日")
    elif as_of != refs["as_of"]:
        errs.append(f"as_of={as_of} 不等于当前复盘日 {refs['as_of']} —— "
                    "前端只渲染 as_of 与复盘日一致的那条，写成别的日期不会显示，也不会报错")
    return errs


def main():
    ap = argparse.ArgumentParser(description="写入每日复盘的研判行（只写文字，读数由脚本复算）")
    ap.add_argument("--judgment", help="一句话研判，≤80 字，必须绑定读数")
    ap.add_argument("--as-of", help="研判所属交易日；默认取 data.json 的复盘日")
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    ap.add_argument("--status", action="store_true", help="打印当前复盘日与已有研判的匹配情况")
    args = ap.parse_args()

    rows = load_rows()
    refs = build_refs(rows)
    anchor = refs["as_of"] if refs else None

    notes = []
    if OUT.exists():
        raw = json.loads(OUT.read_text(encoding="utf-8"))
        notes = raw.get("notes") if isinstance(raw, dict) else raw
        notes = notes if isinstance(notes, list) else []

    if args.status:
        latest_note = notes[-1].get("as_of") if notes else None
        print(f"复盘日（data.json）：{anchor or '—'}")
        print(f"最新研判（review-notes.json）：{latest_note or '暂无'}")
        print("研判行显示：" + ("✓ 匹配" if anchor and latest_note == anchor else "✗ 不匹配，卡片留空"))
        return 0

    if args.judgment is None:
        sys.exit("✗ 需要 --judgment（或用 --status 看当前状态）")

    as_of = args.as_of or anchor
    errs = check(args.judgment, as_of, refs)
    if errs:
        print("✗ 校验未通过，未写入：", file=sys.stderr)
        for e in errs:
            print(f"  · {e}", file=sys.stderr)
        return 1

    entry = {
        "as_of": as_of,
        "judgment": args.judgment.strip(),
        "refs": refs,
        "written_at": beijing_now().strftime("%Y-%m-%d %H:%M CST"),
    }
    replaced = any(n.get("as_of") == as_of for n in notes)
    notes = [n for n in notes if n.get("as_of") != as_of] + [entry]
    notes.sort(key=lambda n: n.get("as_of") or "")

    if args.check:
        print(f"✓ 校验通过（--check，未写文件）｜as_of={as_of}｜{len(entry['judgment'])} 字")
        return 0

    payload = {
        "generated_at": beijing_now().strftime("%Y-%m-%d %H:%M CST"),
        "source": "每日收盘流程由 agent 追加；judgment 是主观文字，refs 由本脚本从 data.json 复算",
        "note": "研判行只在 as_of 等于复盘日时显示；直接跑 export_data.py 不会生成这里的内容，"
                "那是正常状态（卡片显示「未写入」），不是故障。",
        "notes": notes,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{'覆盖' if replaced else '写入'} {OUT.relative_to(ROOT.parent)}｜as_of={as_of}"
          f"｜共 {len(notes)} 条")
    print(f"  研判：{entry['judgment']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
