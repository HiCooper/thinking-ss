#!/usr/bin/env bash
# 为新机器准备「数据更新」用的 Python 环境（只装 akshare 等取数依赖）。
#
#   npm run data:setup          # 在项目下建 .venv-data/ 并安装 akshare
#   PYTHON=/usr/bin/python3.11 npm run data:setup   # 指定解释器
#
# 说明：**启动看板不需要这一步** —— public/data.json 与本地缓存都随仓库提交。
# 只有要「联网抓新数据」时才需要 akshare；若只想用仓库里已有的数据重建，用
#   npm run data:refresh -- --offline
set -euo pipefail
cd "$(dirname "$0")/.."

PY_BIN="${PYTHON:-python3}"
if ! command -v "${PY_BIN}" >/dev/null 2>&1; then
  echo "✗ 未找到 ${PY_BIN}。请安装 Python 3.9+（macOS: brew install python；或用 python.org 安装包）"
  echo "  提示：仅启动看板不需要 Python，直接 npm start 即可。"
  exit 1
fi
echo "▶ 使用 ${PY_BIN}（$(${PY_BIN} -V 2>&1)）"

if [ ! -d .venv-data ]; then
  echo "▶ 创建项目本地虚拟环境 .venv-data/"
  "${PY_BIN}" -m venv .venv-data
fi

echo "▶ 安装依赖（akshare / pandas / requests）…"
./.venv-data/bin/python -m pip install --quiet --upgrade pip
./.venv-data/bin/python -m pip install --quiet --upgrade "akshare>=1.18" pandas requests

./.venv-data/bin/python - <<'PY'
import akshare, pandas, requests, sys
print(f"✓ akshare {akshare.__version__}｜pandas {pandas.__version__}｜requests {requests.__version__}")
print(f"✓ 解释器 {sys.executable}")
PY
echo
echo "✓ 完成。之后 npm run data:refresh 会自动优先使用 ./.venv-data"
