$ErrorActionPreference = "Stop"

$taskNames = @("LANMediaHub_Autostart", "LANMediaStreamer_Autostart")
$startupDir = [Environment]::GetFolderPath("Startup")
$startupVbsFiles = @(
  (Join-Path $startupDir "LANMediaHub-Autostart.vbs"),
  (Join-Path $startupDir "LANMediaStreamer-Autostart.vbs")
)
$removed = $false

foreach ($taskName in $taskNames) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    $removed = $true
  } else {
    cmd /c "schtasks /Delete /F /TN `"$taskName`" >nul 2>nul" | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $removed = $true
    }
  }
}

foreach ($startupVbs in $startupVbsFiles) {
  if (Test-Path $startupVbs) {
    Remove-Item -Path $startupVbs -Force
    $removed = $true
  }
}

if ($removed) {
  Write-Host "[OK] Autostart removed."
} else {
  Write-Host "[Info] Nothing to remove."
}
