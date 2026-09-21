#!/usr/bin/env bash
# p5.js PreviewViewer launcher for macOS/Linux
# Usage: ./start-viewer.sh
# Stop with Ctrl+C.

set -u

cd "$(dirname "$0")"

PORT=8125
URL="http://127.0.0.1:${PORT}/viewer/"
LOG_FILE="${TMPDIR:-/tmp}/preview-viewer-http-server.log"
SERVER_PID=""
BROWSER_PID=""
BROWSER_PROFILE=""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[ERROR] curl not found."
  exit 1
fi

echo "Starting local server..."
echo "Log: ${LOG_FILE}"

npx --yes http-server . -p "${PORT}" -c-1 >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

cleanup() {
  if [ -n "${BROWSER_PID}" ]; then
    kill "${BROWSER_PID}" 2>/dev/null || true
  fi
  if [ -n "${SERVER_PID}" ]; then
    kill "${SERVER_PID}" 2>/dev/null || true
  fi
  if [ -n "${BROWSER_PROFILE}" ]; then
    rm -rf "${BROWSER_PROFILE}"
  fi
}
trap cleanup INT TERM EXIT

READY=0
for i in $(seq 1 60); do
  if curl -fsS "${URL}" >/dev/null 2>&1; then
    READY=1
    break
  fi

  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "[ERROR] Local server stopped unexpectedly."
    cat "${LOG_FILE}"
    exit 1
  fi

  sleep 1
done

if [ "${READY}" -ne 1 ]; then
  echo "[ERROR] Server did not become ready within 60 seconds."
  cat "${LOG_FILE}"
  exit 1
fi

echo "Viewer is ready: ${URL}"

if [ "$(uname -s)" = "Darwin" ]; then
  # Directly launch the browser binary. This avoids macOS 'open' reusing an
  # existing browser process and dropping the --kiosk argument.
  BROWSER=""
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "${HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
    if [ -x "${candidate}" ]; then
      BROWSER="${candidate}"
      break
    fi
  done

  if [ -n "${BROWSER}" ]; then
    BROWSER_PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/preview-viewer-chrome.XXXXXX")"
    "${BROWSER}" \
      --kiosk \
      --start-fullscreen \
      --no-first-run \
      --disable-session-crashed-bubble \
      --user-data-dir="${BROWSER_PROFILE}" \
      "${URL}" >/dev/null 2>&1 &
    BROWSER_PID=$!
    echo "Kiosk browser started. Exit with Cmd+Q or Ctrl+C here."
  else
    echo "[WARN] Chrome/Chromium/Edge not found; opening the default browser."
    open "${URL}"
  fi
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${URL}"
fi

wait "${SERVER_PID}"
