#!/usr/bin/env bash
# 增量更新看板数据：优先读本地缓存，只抓缺失的部分；失败自动退回缓存。
#
# 用法（在 market-dashboard/ 下）：
#   npm run data:refresh                # 默认 250 个交易日窗口（约一年）
#   npm run data:refresh -- --days 400  # 放宽窗口（缓存只增不减，只补缺失日期）
#   npm run data:refresh -- --offline   # 完全不联网，纯用本地缓存重建 data.json
#
# 说明：需要带 akshare 的解释器。查找顺序：$DASH_PY → $SKILLS/ashare-data 的 venv → 系统 python3。
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${DASH_PY:-}"
if [ -z "$PY" ]; then
  for cand in \
    "${SKILLS:-$HOME/Projects/QoderProjects/agents-silky/skills}/ashare-data/.venv/bin/python" \
    "/Users/xueancao/Projects/QoderProjects/agents-silky/skills/ashare-data/.venv/bin/python"; do
    [ -x "$cand" ] && PY="$cand" && break
  done
fi
[ -z "$PY" ] && PY="python3"

case "$PY" in
  */.venv/bin/python) echo "解释器：${PY}（akshare venv）" ;;
  *) echo "解释器：${PY}（警告：若未安装 akshare，在线抓取会失败；可用 --offline 只走本地缓存）" ;;
esac

"${PY}" scripts/export_data.py "$@"

echo
"${PY}" scripts/validate_data.py
