@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "CONFIG=%SCRIPT_DIR%config.json"
set "SCRIPT=%SCRIPT_DIR%pendant-bridge.js"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo Install Node.js 18+ on this machine, then run this file again.
  pause
  exit /b 1
)

if not exist "%CONFIG%" (
  echo [ERROR] Missing config file: "%CONFIG%"
  echo Copy config.example.json to config.json and edit values first.
  pause
  exit /b 1
)

node "%SCRIPT%" --config "%CONFIG%"
endlocal
