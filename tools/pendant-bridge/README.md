# CNCjs Pendant Bridge

Runs as a background process on Windows:
- Captures global key events from your BLE HID pendant
- Translates combos to CNCjs jog/probe commands
- Sends commands to CNCjs over Socket.IO

This replaces the need to keep a PowerShell window active.

## Requirements

- Node.js `18` or newer (Node `14` is not supported)

## 1) Install dependency

From repository root:

```powershell
cd tools\pendant-bridge
npm install
cd ..\..
```

## 2) Create config

```powershell
Copy-Item tools\pendant-bridge\config.example.json tools\pendant-bridge\config.json
```

Edit `tools/pendant-bridge/config.json`:
- `machine.port` to your CNC serial port (example `COM6`)
- `cncjs.host/port` if CNCjs is not on `127.0.0.1:8000`
- If CNCjs auth is enabled, set `cncjs.username` and `cncjs.password`

## 3) Run manually (test)

```powershell
node tools\pendant-bridge\pendant-bridge.js --config tools\pendant-bridge\config.json
```

## 4) Install autostart

```powershell
powershell -ExecutionPolicy Bypass -File tools\pendant-bridge\install-startup.ps1
```

Optional custom task name:

```powershell
powershell -ExecutionPolicy Bypass -File tools\pendant-bridge\install-startup.ps1 -TaskName "CNCjsPendantBridge"
```

Start task immediately:

```powershell
Start-ScheduledTask -TaskName "CNCjsPendantBridge"
```

## Deploy package for CNC-PC (no autostart)

Build a portable zip from this dev machine:

```powershell
powershell -ExecutionPolicy Bypass -File tools\pendant-bridge\build-release.ps1
```

This creates:
- `tools\pendant-bridge\release\cncjs-pendant-bridge-win-x64.zip`

On CNC-PC:
1. Extract zip to a folder (for example `C:\cncjs-pendant-bridge`).
2. Edit `config.json` (`cncjs.port`, `machine.port`, etc.).
3. Start manually by double-clicking `start-bridge.cmd` or run:
   `node pendant-bridge.js --config config.json`

## Default key mapping

- `;` = X-
- `'` = X+
- `,` = Y+
- `.` = Y-
- `/` = Z+
- `\` = Z-
- `; ' , . / \` (no modifier) = small step
- `Alt + ; ' , . / \` = medium step
- `Ctrl + ; ' , . / \` = large step
- `Shift + ; ' , . / \` = smooth jog high (toggle)
- `Shift + Alt + ; ' , . / \` = smooth jog medium (toggle)
- `Alt + P` = probe macro

## Notes

- Smooth jog uses `$J` loop and uses CNCjs `jog:stop` command to cancel.
- If socket disconnects, active smooth jog is cancelled automatically.
- If you need key debug, set `logging.verboseKeys` to `true`.
