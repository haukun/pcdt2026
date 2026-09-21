# p5.js PreviewViewer launcher (Windows / PowerShell)
# Usage:  .\start-viewer.ps1
# If blocked by execution policy:
#   powershell -ExecutionPolicy Bypass -File .\start-viewer.ps1
# Starts a local server and opens the Viewer in the default browser.
# Press Ctrl+C in this window to stop.

$ErrorActionPreference = 'Stop'

Set-Location -Path $PSScriptRoot

$Port = 8125
$Url = "http://127.0.0.1:$Port/viewer/"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[ERROR] Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
  exit 1
}

Write-Host "Starting Viewer: $Url"

Start-Job -ScriptBlock {
  Start-Sleep -Seconds 2
  Start-Process $using:Url
} | Out-Null

npx --yes http-server . -p $Port -c-1
