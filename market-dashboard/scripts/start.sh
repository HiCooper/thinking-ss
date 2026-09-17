#!/usr/bin/env bash
# 一键启动看板。换一台电脑 clone 之后，只要 `npm start` 即可。
#
#   npm start                # 首次自动装依赖 → 起服务 → http://127.0.0.1:5183
#   PORT=5190 npm start      # 端口被占时换端口
#
# 前置：Node ^20.19.0 || >=22.12.0（Vite 8 要求）。**不需要 Python** —— 数据文件 public/data.json 随仓库提交。
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5183}"

# 1) Node 检查
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未找到 node。请先安装 Node 22 LTS（或 ≥20.19）：https://nodejs.org"
  exit 1
fi
# 与 package.json 的 engines.node 保持一致：^20.19.0 || >=22.12.0
NODE_OK="$(node -p 'const [maj, min] = process.versions.node.split(".").map(Number);
  (maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19)) ? "1" : "0"')"
if [ "${NODE_OK}" != "1" ]; then
  echo "✗ Node 版本过低（当前 $(node -v)）：Vite 8 需要 ^20.19.0 || >=22.12.0"
  exit 1
fi
echo "▶ Node $(node -v)｜npm $(npm -v)"

# 2) 依赖：缺 node_modules 就装（有 lock 时用 npm ci，保证版本一致）
if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then
    echo "▶ 首次运行：npm ci（依据 package-lock.json 精确还原）"
    npm ci
  else
    echo "▶ 首次运行：npm install"
    npm install
  fi
fi

# 3) 数据文件（随仓库提交，正常一定存在）
if [ ! -f public/data.json ]; then
  echo "✗ 缺少 public/data.json。"
  echo "  在线生成：npm run data:setup && npm run data:refresh"
  echo "  纯离线重建：npm run data:refresh -- --offline（需仓库里的 scripts/.series_cache.json）"
  exit 1
fi

# 4) 日收益记录检查（收盘后自动补记；盘中/已记录/非交易日都会跳过）
#    放后台跑：常见情形 0.3s，但需要补记时要取 22 只收盘价（约 5–8s），
#    不能让它拖慢启动。失败不影响看板（手动 npm run holdings:snapshot 即可）。
if command -v python3 >/dev/null 2>&1; then
  (
    python3 scripts/record_holdings_snapshot.py --if-due 2>&1 \
      | sed 's/^/  [收益记录] /'
  ) &
fi

# 6) 起服务（--port 覆盖 vite.config 的默认端口）
echo "▶ 打开 http://127.0.0.1:${PORT}"
exec npm run dev -- --port "${PORT}"
