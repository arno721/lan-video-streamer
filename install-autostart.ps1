param(
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$taskName = "LANMediaHub_Autostart"
$launcherPath = Join-Path $PSScriptRoot "startup-launch.ps1"
$startupDir = [Environment]::GetFolderPath("Startup")
$startupVbs = Join-Path $startupDir "LANMediaHub-Autostart.vbs"

if (-not (Test-Path $launcherPath)) {
  throw "Missing launcher script: $launcherPath"
}

$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`""
$action = "powershell.exe $arg"
$created = $false
$createdMode = ""

try {
  $psAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew

  $userId = "$env:USERDOMAIN\$env:USERNAME"
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $psAction `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Auto start LAN Media Hub at user logon." `
    -Force | Out-Null
  $created = $true
  $createdMode = "scheduled-task"
} catch {
  $quotedAction = "`"powershell.exe`" $arg"
  $cmd = "schtasks /Create /F /SC ONLOGON /RL LIMITED /TN `"$taskName`" /TR `"$quotedAction`""
  cmd /c "$cmd >nul 2>nul" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $created = $true
    $createdMode = "schtasks"
  } else {
    # Final fallback: per-user Startup folder VBS (no admin rights needed).
    if (-not (Test-Path $startupDir)) {
      New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
    }
    $psCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`""
    $escaped = $psCmd.Replace('"', '""')
    $vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "$escaped", 0, False
"@
    Set-Content -Path $startupVbs -Value $vbs -Encoding ASCII
    $created = $true
    $createdMode = "startup-folder"
  }
}

if ($created) {
  Write-Host "[OK] Autostart configured."
  Write-Host "[Info] Task name: $taskName"
  Write-Host "[Info] Mode: $createdMode"
  if ($createdMode -eq "startup-folder") {
    Write-Host "[Info] Startup file: $startupVbs"
  }
}

if ($RunNow) {
  & $launcherPath
  Write-Host "[Info] Launch script executed."
}
