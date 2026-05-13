#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/.tauri-smoke"
LOG_FILE="$LOG_DIR/tauri-dev.log"
PID_FILE="$LOG_DIR/tauri-dev.pid"
APP_NAME="anvil-review"
PORT=5173

mkdir -p "$LOG_DIR"
: > "$LOG_FILE"

kill_existing() {
  pkill -f "$ROOT/node_modules/.bin/tauri dev" 2>/dev/null || true
  pkill -f "$ROOT/node_modules/.bin/vite --host 127.0.0.1 --port $PORT" 2>/dev/null || true
  pkill -f "target/debug/$APP_NAME" 2>/dev/null || true
  rm -f "$PID_FILE"
}

cleanup() {
  if [[ "${TAURI_SMOKE_KEEP:-0}" == "1" ]]; then
    echo "Keeping Tauri app running. Log: $LOG_FILE"
    return
  fi

  kill_existing
}

fail() {
  echo "smoke failed: $*" >&2
  echo "log: $LOG_FILE" >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  exit 1
}

wait_for_log() {
  local pattern="$1"
  local seconds="$2"
  local waited=0

  until rg -q "$pattern" "$LOG_FILE" 2>/dev/null; do
    if (( waited >= seconds )); then
      fail "timed out waiting for log pattern: $pattern"
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

kill_existing
sleep 1

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "port $PORT is already in use after cleanup"
fi

(
  cd "$ROOT"
  RUST_BACKTRACE=full npm run dev
) >"$LOG_FILE" 2>&1 &
echo "$!" > "$PID_FILE"

trap cleanup EXIT

wait_for_log "VITE v" 30
wait_for_log "Running.*target/debug/$APP_NAME" 60
wait_for_log 'Anvil webview windows after setup: \["main"\]' 30

APP_PID=""
for _ in {1..30}; do
  APP_PID="$(pgrep -f "target/debug/$APP_NAME" | head -n 1 || true)"
  if [[ -n "$APP_PID" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$APP_PID" ]]; then
  fail "app process never appeared"
fi

sleep 5
if ! kill -0 "$APP_PID" 2>/dev/null; then
  fail "app process exited during startup"
fi

if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "vite is not listening on $PORT"
fi

echo "smoke passed: pid=$APP_PID webview=main port=$PORT"
echo "log: $LOG_FILE"
