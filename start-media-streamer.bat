@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [Info] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [Error] npm install failed.
    pause
    exit /b 1
  )
)

echo [Info] Starting LAN Media Hub...
start "" "http://localhost:8080/admin.html"
call npm start
