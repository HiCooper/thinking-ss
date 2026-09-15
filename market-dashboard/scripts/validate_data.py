#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验 public/data.json 是否满足看板的数据契约（改数据源后先跑这个）。

用法：python3 scripts/validate_data.py
退出码：0 = 通过；1 = 有问题（并打印具体原因）
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data.json"

NUM_KEYS = ["turnover_sh", "turnover_sz", "turnover_total",
            "us10y", "cn10y", "margin_rz", "margin_rq", "margin_total"]
RANGES = {                      # (下限, 上限) 用于捕捉单位错误（万元/元 误当 亿元 之类的量级错）
    "turnover_sh": (500, 60000), "turnover_sz": (500, 60000), "turnover_total": (1000, 100000),
    "us10y": (-2, 20), "cn10y": (-2, 20),
    "margin_rz": (3000, 60000), "margin_rq": (0, 5000), "margin_total": (3000, 60000),
}
MIN_ROWS = 60


def main() -> int:
    errs, warns = [], []
    if not DATA.exists():
        print(f"✗ 缺少 {DATA}，先跑 scripts/export_data.py")
        return 1
    d = json.loads(DATA.read_text(encoding="utf-8"))

    for k in ("generated_at", "sources", "rows"):
        if k not in d:
            errs.append(f"顶层缺字段 {k}")
    rows = d.get("rows")
    if not isinstance(rows, list) or not rows:
        print("✗ rows 不是非空数组")
        return 1
    if len(rows) < MIN_ROWS:
        errs.append(f"行数 {len(rows)} < {MIN_ROWS}，窗口太短")

    dates = [r.get("date") for r in rows]
    if dates != sorted(dates):
        errs.append("rows 未按日期升序")
    if len(set(dates)) != len(dates):
        errs.append("存在重复日期")
    bad_date = [x for x in dates if not (isinstance(x, str) and len(x) == 10 and x[4] == "-")]
    if bad_date:
        errs.append(f"日期格式异常（应为 YYYY-MM-DD）：{bad_date[:3]}")

    for key in NUM_KEYS:
        vals = [r.get(key) for r in rows]
        unknown = [v for v in vals if not (v is None or isinstance(v, (int, float)))]
        if unknown:
            errs.append(f"{key} 存在非数值且非 null 的值：{unknown[:3]}")
        nums = [v for v in vals if isinstance(v, (int, float))]
        if not nums:
            errs.append(f"{key} 全为 null —— 该数据源整体没取到，检查接口")
            continue
        lo, hi = RANGES[key]
        out = [v for v in nums if not (lo <= v <= hi)]
        if out:
            errs.append(f"{key} 有 {len(out)} 个值超出合理区间 [{lo}, {hi}]，疑单位错误：{out[:3]}")
        if len(nums) < len(rows) * 0.5:
            warns.append(f"{key} 仅 {len(nums)}/{len(rows)} 天有值（缺失超过一半），确认是否符合预期")

    # 一致性：合计 ≈ 沪 + 深
    for r in rows:
        sh, sz, tt = r.get("turnover_sh"), r.get("turnover_sz"), r.get("turnover_total")
        if None not in (sh, sz, tt) and abs((sh + sz) - tt) > 1.0:
            errs.append(f"{r['date']} 成交额合计 ≠ 沪+深（{tt} vs {sh}+{sz}）")
            break

    print(f"文件：{DATA}")
    print(f"区间：{d.get('range', {}).get('start')} ~ {d.get('range', {}).get('end')}，{len(rows)} 行")
    for key in NUM_KEYS:
        n = sum(1 for r in rows if isinstance(r.get(key), (int, float)))
        last = next((r[key] for r in reversed(rows) if isinstance(r.get(key), (int, float))), None)
        print(f"  {key:<15} 有值 {n:>3}/{len(rows)}  最新 {last}")
    for w in warns:
        print(f"⚠ {w}")
    for e in errs:
        print(f"✗ {e}")
    print("✓ 校验通过" if not errs else f"✗ 校验失败（{len(errs)} 项）")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
