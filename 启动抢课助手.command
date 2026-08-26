#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"

if [[ ! -d node_modules ]]; then
  echo "首次运行，正在安装本地依赖…"
  npm install
fi

echo "正在启动学校抢课助手…"
/usr/bin/caffeinate -dimsu node src/server.js &
ASSISTANT_PID=$!

cleanup() {
  kill "$ASSISTANT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

READY=0
for ATTEMPT in {1..20}; do
  if /usr/bin/curl -fsS "http://127.0.0.1:43127/api/state" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done

if [[ "$READY" -ne 1 ]]; then
  echo "启动失败：本地控制面板没有响应。请保留此窗口并截图其中的错误信息。"
  wait "$ASSISTANT_PID"
  exit 1
fi

echo "启动成功。请保持这个终端窗口打开。"
echo "控制面板：http://127.0.0.1:43127"
open -a "Google Chrome" "http://127.0.0.1:43127"
wait "$ASSISTANT_PID"
