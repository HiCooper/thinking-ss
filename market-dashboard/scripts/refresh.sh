#!/usr/bin/env bash
# 增量更新看板数据：优先读本地缓存，只抓缺失的部分；失败自动退回缓存。
#
#   npm run data:refresh                # 默认 250 个交易日窗口（约一年）
#   npm run data:refresh -- --days 400  # 放宽窗口（缓存只增不减，只补缺失日期）
#   npm run data:refresh -- --offline   # 完全不联网，纯用本地缓存重建 data.json
#
# 解释器查找顺序（换机器也能用，**无硬编码路径**）：
#   $DASH_PY  →  ./scripts/.python-path（机器本地，不入库）  →  ./.venv-data  →  $SKILLS/ashare-data 的 venv  →  python3
# 没有 akshare 时：--offline 仍可用（只读仓库里的缓存）；联网更新会给出可操作的提示。
set -euo pipefail
cd "$(dirname "$0")/.."

find_py() {
  if [ -n "${DASH_PY:-}" ] && [ -x "${DASH_PY}" ]; then echo "${DASH_PY}"; return; fi
  # 机器本地指定（**不入库**，一行路径）：免去每次设 DASH_PY，也避免重复装一份 akshare
  if [ -f "./scripts/.python-path" ]; then
    local p
    p="$(head -1 ./scripts/.python-path | tr -d '[:space:]')"
    if [ -n "${p}" ] && [ -x "${p}" ]; then echo "${p}"; return; fi
  fi
  if [ -x "./.venv-data/bin/python" ]; then echo "./.venv-data/bin/python"; return; fi
  if [ -n "${SKILLS:-}" ] && [ -x "${SKILLS}/ashare-data/.venv/bin/python" ]; then
    echo "${SKILLS}/ashare-data/.venv/bin/python"; return
  fi
  if command -v python3 >/dev/null 2>&1; then echo "python3"; return; fi
  echo ""
}

PY="$(find_py)"
if [ -z "${PY}" ]; then
  echo "✗ 找不到 Python。更新数据才需要它，二选一："
  echo "    · 装 Python 3.9+ 后：npm run data:setup"
  echo "    · 纯离线重建（无需 akshare）：npm run data:refresh -- --offline"
  echo "  提示：启动看板本身不需要 Python，直接 npm start。"
  exit 1
fi
echo "解释器：${PY}"

OFFLINE=0
for a in "$@"; do [ "$a" = "--offline" ] && OFFLINE=1; done
if [ "${OFFLINE}" -eq 0 ] && ! "${PY}" -c "import akshare" >/dev/null 2>&1; then
  echo "⚠️  该解释器没有 akshare，联网更新会失败。任选其一："
  echo "    · npm run data:setup                      # 项目下建 .venv-data 并安装（推荐）"
  echo "    · npm run data:refresh -- --offline        # 只用仓库里的本地缓存重建"
  echo "    · DASH_PY=/path/to/python npm run data:refresh"
  echo "    · 或把解释器路径写进 ./scripts/.python-path（一行，不入库）"
  exit 1
fi

"${PY}" scripts/export_data.py "$@"

echo
"${PY}" scripts/validate_data.py
