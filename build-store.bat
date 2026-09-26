@echo off
setlocal
rem ============================================================
rem  LUMEN - build the Microsoft Store installer (Windows only)
rem
rem  Result: src-tauri\target\release\bundle\nsis\LUMEN_<ver>_x64-setup.exe
rem  This one bundles the WebView2 runtime offline (~210 MB), which is what a
rem  Microsoft Store EXE/MSI submission requires. The ordinary release
rem  installer (build.bat, ~4.5 MB) is a downloader stub and is NOT accepted
rem  by the Store.
rem
rem  Signing: set LUMEN_SIGN_PFX + LUMEN_SIGN_PASSWORD, or
rem           LUMEN_SIGN_THUMBPRINT, before running. Without a certificate the
rem           installer is built unsigned and the Store will reject it.
rem ============================================================
title LUMEN store build
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [LUMEN] pnpm not found in PATH. Install Node.js + pnpm first:
  echo         npm i -g pnpm
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-store.ps1" %*
if errorlevel 1 (
  echo.
  echo [LUMEN] store build FAILED - check the log above
  pause
  exit /b 1
)

echo.
echo [LUMEN] done. Opening the output folder...
start "" "src-tauri\target\release\bundle\nsis"
endlocal
