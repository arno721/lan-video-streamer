@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" -RunNow
if errorlevel 1 (
  echo [Error] 啟用開機啟動失敗。
  pause
  exit /b 1
)

echo [Done] 已啟用開機啟動。
pause
