param()

Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is not installed or not in PATH."
  exit 1
}

if (-not (Test-Path "node_modules")) {
  Write-Host "[Info] Installing dependencies..."
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install failed."
    exit $LASTEXITCODE
  }
}

Write-Host "[Info] Starting LAN Media Streamer..."
Write-Host "[Info] Open http://localhost:8080/admin.html in browser"
npm start