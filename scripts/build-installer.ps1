param(
  [string]$Version
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -Path $root

if (-not $Version) {
  $pkg = Get-Content package.json -Raw | ConvertFrom-Json
  $Version = [string]$pkg.version
}

$normalized = [string]$Version
if ($normalized.StartsWith("v")) { $normalized = $normalized.Substring(1) }

if ($normalized -notmatch '^\d+\.\d+\.\d+([\-+][0-9A-Za-z\.-]+)?$') {
  throw "Invalid version: $Version"
}

$tagVersion = "v$normalized"
$distDir = Join-Path $root "dist"
$stageDir = Join-Path $distDir "lan-video-streamer-$tagVersion"
$zipPath = Join-Path $distDir "lan-video-streamer-$tagVersion.zip"

if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
New-Item -ItemType Directory -Path $stageDir | Out-Null

$includeFiles = @(
  "README.md",
  "package.json",
  "package-lock.json",
  "server.js",
  "preview-worker.js",
  "start-media-streamer.bat",
  "start-media-streamer.ps1",
  "install-autostart.bat",
  "install-autostart.ps1",
  "uninstall-autostart.bat",
  "uninstall-autostart.ps1",
  "startup-launch.ps1"
)

foreach ($file in $includeFiles) {
  if (Test-Path $file) {
    Copy-Item -Path $file -Destination (Join-Path $stageDir $file)
  }
}

Copy-Item -Path "public" -Destination (Join-Path $stageDir "public") -Recurse

if (Test-Path "videos") {
  $videosStage = Join-Path $stageDir "videos"
  if (-not (Test-Path $videosStage)) { New-Item -ItemType Directory -Path $videosStage | Out-Null }
}

Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Output "Installer package created: $zipPath"
