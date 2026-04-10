@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-autostart.ps1"
if errorlevel 1 (
  echo [Error] 移除開機啟動失敗。
  pause
  exit /b 1
)

echo [Done] 已移除開機啟動。
pause
