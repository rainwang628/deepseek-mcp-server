#!/bin/bash
# 部署后构建钩子，由 projs/deploy.sh 在部署根执行（cwd = services/deepseek-mcp-server）。
# 产物写 dist/，dist/ 不进源码仓库、不参与同步，只属于部署根。
set -euo pipefail

[ -f package.json ] || { echo "当前目录不是 deepseek-mcp-server 部署根" >&2; exit 1; }
[ -d node_modules ] || { echo "缺少 node_modules：先在部署根执行 npm ci" >&2; exit 1; }
command -v npm >/dev/null || { echo "找不到 npm" >&2; exit 1; }

npm run build
printf '构建完成：dist/src 下 %s 个 js\n' "$(find dist/src -name '*.js' | wc -l | tr -d ' ')"
