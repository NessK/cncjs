param(
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
if (-not $OutDir) {
    $OutDir = Join-Path $root "release"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$staging = Join-Path $OutDir "_staging"
if (Test-Path $staging) {
    Remove-Item -Recurse -Force $staging
}
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$items = @(
    "pendant-bridge.js",
    "package.json",
    "package-lock.json",
    "README.md",
    "start-bridge.cmd",
    "config.example.json"
)

foreach ($item in $items) {
    Copy-Item -Path (Join-Path $root $item) -Destination (Join-Path $staging $item) -Force
}

$cfg = Join-Path $root "config.json"
if (Test-Path $cfg) {
    Copy-Item -Path $cfg -Destination (Join-Path $staging "config.json") -Force
} else {
    Copy-Item -Path (Join-Path $root "config.example.json") -Destination (Join-Path $staging "config.json") -Force
}

Copy-Item -Path (Join-Path $root "node_modules") -Destination (Join-Path $staging "node_modules") -Recurse -Force

$zip = Join-Path $OutDir "cncjs-pendant-bridge-win-x64.zip"
if (Test-Path $zip) {
    Remove-Item -Force $zip
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip -Force
Remove-Item -Recurse -Force $staging

Write-Output "Created: $zip"
