#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""重新生成 m1-m2-data.js：近 N 个月 M1/M2 同比，供 m1-m2-trend.html 复用。

运行（用 skill 自带的 akshare 虚拟环境，系统 python 没装 akshare）：
    /Users/xueancao/Projects/QoderProjects/agents-silky/skills/ashare-data/.venv/bin/python update_m1m2.py [月数]

默认取最近 36 个月；可传参，如 `... update_m1m2.py 48`。
输出写到本脚本同目录下的 m1-m2-data.js，覆盖旧数据。
"""
import re
import os
import sys

import akshare as ak

MONTHS = int(sys.argv[1]) if len(sys.argv) > 1 else 36
REDEF = "2025-01"  # M1 口径调整月份，用于图上竖线标注

df = ak.macro_china_money_supply()

# akshare 返回最新在前；取最近 MONTHS 行再反转成时间升序
recent = df.head(MONTHS).iloc[::-1]

def parse_month(s: str) -> str:
    m = re.match(r"(\d{4})年(\d{1,2})月", s)
    return f"{m.group(1)}-{int(m.group(2)):02d}"

rows = []
for _, r in recent.iterrows():
    rows.append(
        '  {{"d":"{}","m1":{:.1f},"m2":{:.1f}}}'.format(
            parse_month(r["月份"]),
            float(r["货币(M1)-同比增长"]),
            float(r["货币和准货币(M2)-同比增长"]),
        )
    )

body = ",\n".join(rows)
out = (
    "// 自动生成：近 {} 个月货币供应量同比（%）。\n"
    "// 运行 `/Users/xueancao/Projects/QoderProjects/agents-silky/skills/ashare-data/.venv/bin/python update_m1m2.py` 重新生成，勿手改。\n"
    "window.M1M2_DATA = [\n{}\n];\n"
    'window.M1M2_REDEF = "{}"; // M1 口径调整月份（旧口径/新口径分界）\n'
).format(MONTHS, body, REDEF)

here = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(here, "m1-m2-data.js")
with open(path, "w", encoding="utf-8") as f:
    f.write(out)

print(f"已写入 {path}（{MONTHS} 个月，{recent.iloc[0]['月份']} → {recent.iloc[-1]['月份']}）")
