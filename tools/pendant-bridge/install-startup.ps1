param(
    [string]$TaskName = "CNCjsPendantBridge",
    [string]$ConfigPath = "",
    [string]$BridgePath = ""
)

$ErrorActionPreference = "Stop"

if (-not $BridgePath) {
    $BridgePath = Join-Path $PSScriptRoot "pendant-bridge.js"
}

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $PSScriptRoot "config.json"
}

if (-not (Test-Path $BridgePath)) {
    throw "Bridge script not found: $BridgePath"
}

if (-not (Test-Path $ConfigPath)) {
    throw "Config file not found: $ConfigPath"
}

$nodeCmd = Get-Command node -ErrorAction Stop
$nodePath = $nodeCmd.Source

$bridgeFullPath = (Resolve-Path $BridgePath).Path
$configFullPath = (Resolve-Path $ConfigPath).Path
$workingDir = Split-Path -Parent $bridgeFullPath

$arg = "`"$bridgeFullPath`" --config `"$configFullPath`""
$action = New-ScheduledTaskAction -Execute $nodePath -Argument $arg -WorkingDirectory $workingDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "CNCjs pendant bridge autostart" `
    -Force | Out-Null

Write-Output "Installed Scheduled Task: $TaskName"
Write-Output "Node: $nodePath"
Write-Output "Bridge: $bridgeFullPath"
Write-Output "Config: $configFullPath"
Write-Output "Start now: Start-ScheduledTask -TaskName `"$TaskName`""
