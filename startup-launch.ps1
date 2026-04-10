param(
  [switch]$ForceRestart
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $projectDir

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  exit 1
}

if (-not (Test-Path ".cache")) {
  New-Item -ItemType Directory -Path ".cache" -Force | Out-Null
}

if (-not $ForceRestart) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8080/api/server-info" -TimeoutSec 2
    if ($resp.StatusCode -eq 200) {
      exit 0
    }
  } catch {
    # continue and start process
  }
}

$outLog = Join-Path $projectDir ".cache\server.out.log"
$errLog = Join-Path $projectDir ".cache\server.err.log"

Start-Process `
  -FilePath $nodeCmd.Source `
  -ArgumentList "server.js" `
  -WorkingDirectory $projectDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog
