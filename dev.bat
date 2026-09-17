@echo off
setlocal
rem ============================================================
rem  LUMEN — run in dev mode (hot reload, dev console available)
rem  Double-click in Explorer or run from any terminal.
rem ============================================================
title LUMEN dev
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [LUMEN] pnpm not found in PATH. Install Node.js + pnpm first:
  echo         npm i -g pnpm
  pause
  exit /b 1
)

echo [LUMEN] starting dev build (Rust + Vite)...
echo         close the app window or press Ctrl+C here to stop
echo.

pnpm tauri dev
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo [LUMEN] dev exited with code %EXITCODE% - check the log above
  pause
)
endlocal
