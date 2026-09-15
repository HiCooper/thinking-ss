#!/usr/bin/env bash
# 一键启动看板。换一台电脑 clone 之后，只要 `npm start` 即可。
#
#   npm start                # 首次自动装依赖 → 起服务 → http://127.0.0.1:5183
#   PORT=5190 npm start      # 端口被占时换端口
#
# 前置：Node ≥ 18（Vite 5 要求）。**不需要 Python** —— 数据文件 public/data.json 随仓库提交。
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5183}"

# 1) Node 检查
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未找到 node。请先安装 Node 18+（推荐 20/22 LTS）：https://nodejs.org"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  echo "✗ Node 版本过低（当前 $(node -v)）：Vite 5 需要 Node ≥ 18"
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

# 4) 起服务（--port 覆盖 vite.config 的默认端口）
echo "▶ 打开 http://127.0.0.1:${PORT}"
exec npm run dev -- --port "${PORT}"
