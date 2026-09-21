@echo off
REM p5.js PreviewViewer launcher (Windows)
REM Double-click this file, or run: start-viewer.cmd
REM Starts a local server and opens the Viewer in the default browser.
REM Press Ctrl+C in this window to stop.

setlocal
cd /d "%~dp0"

set PORT=8125
set URL=http://127.0.0.1:%PORT%/viewer/

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

echo Starting Viewer: %URL%
start "" cmd /c "timeout /t 2 >nul & start %URL%"

npx --yes http-server . -p %PORT% -c-1

endlocal
