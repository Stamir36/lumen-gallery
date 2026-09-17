@echo off
setlocal
rem ============================================================
rem  LUMEN — build a release exe and open its folder
rem  Result: src-tauri\target\release\lumen.exe (standalone)
rem ============================================================
title LUMEN build
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [LUMEN] pnpm not found in PATH. Install Node.js + pnpm first:
  echo         npm i -g pnpm
  pause
  exit /b 1
)

echo [LUMEN] building release (first build takes a few minutes)...
echo.

pnpm tauri build
if errorlevel 1 (
  echo.
  echo [LUMEN] build FAILED - check the log above
  pause
  exit /b 1
)

echo.
echo [LUMEN] done. Opening the output folder...
start "" "src-tauri\target\release"
endlocal
