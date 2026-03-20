@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js and try again.
  pause
  exit /b 1
)

if not exist "node_modules\three\build\three.module.js" (
  echo Installing required packages...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist "node_modules\ws\index.js" (
  echo Installing required packages...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting 3D Earth Explorer...
node "%~dp0scripts\launch-local-server.cjs"

if errorlevel 1 (
  echo Startup failed.
  pause
  exit /b 1
)

endlocal
