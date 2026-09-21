#!/usr/bin/env bash
# =====================================================================
# p5.js PreviewViewer 起動スクリプト (macOS / Linux)
# 使い方:
#   1) 実行権限を付与（初回のみ）:  chmod +x start-viewer.sh
#   2) 起動:  ./start-viewer.sh
# ローカルサーバーを立てて、既定ブラウザで Viewer を開く。
# 停止するには Ctrl+C。
# =====================================================================

set -e

# スクリプトのあるディレクトリへ移動（どこから実行しても動くように）
cd "$(dirname "$0")"

PORT=8125
URL="http://127.0.0.1:${PORT}/viewer/"

if ! command -v node >/dev/null 2>&1; then
  echo "[エラー] Node.js が見つかりません。https://nodejs.org からインストールしてください。"
  exit 1
fi

echo "Viewer を起動します: ${URL}"

# サーバー起動を少し待ってからブラウザを開く（バックグラウンド）
(
  sleep 2
  if command -v open >/dev/null 2>&1; then
    open "${URL}"          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${URL}"      # Linux
  fi
) &

# http-server をキャッシュ無効で起動（-c-1）
npx --yes http-server . -p "${PORT}" -c-1
