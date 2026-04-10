$ErrorActionPreference = "Stop"

$taskName = "LANMediaStreamer_Autostart"
$startupDir = [Environment]::GetFolderPath("Startup")
$startupVbs = Join-Path $startupDir "LANMediaStreamer-Autostart.vbs"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$removed = $false

if ($task) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  $removed = $true
} else {
  cmd /c "schtasks /Delete /F /TN `"$taskName`" >nul 2>nul" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $removed = $true
  }
}

if (Test-Path $startupVbs) {
  Remove-Item -Path $startupVbs -Force
  $removed = $true
}

if ($removed) {
  Write-Host "[OK] Autostart removed."
} else {
  Write-Host "[Info] Nothing to remove."
}
