@echo off
setlocal

cd /d "%~dp0"

set "COMMIT_MESSAGE="
if not "%~1"=="" (
  set "COMMIT_MESSAGE=%~1"
  shift
)

:collect_args
if "%~1"=="" goto commit_message_ready
set "COMMIT_MESSAGE=%COMMIT_MESSAGE% %~1"
shift
goto collect_args

:commit_message_ready
if "%COMMIT_MESSAGE%"=="" (
  set /p COMMIT_MESSAGE=Commit message: 
)

if "%COMMIT_MESSAGE%"=="" (
  echo Commit message is required.
  exit /b 1
)

for /f "usebackq delims=" %%i in (`git branch --show-current`) do set "CURRENT_BRANCH=%%i"
if /i not "%CURRENT_BRANCH%"=="main" (
  echo Current branch is "%CURRENT_BRANCH%". Switch to "main" before publishing.
  exit /b 1
)

echo [publish] Staging changes
git add -A
if errorlevel 1 exit /b %errorlevel%

git diff --cached --quiet
if not errorlevel 1 (
  echo [publish] No staged changes. Nothing to publish.
  exit /b 0
)

echo [publish] Creating commit
git commit -m "%COMMIT_MESSAGE%"
if errorlevel 1 exit /b %errorlevel%

echo [publish] Pushing to origin/main
git push origin main
if errorlevel 1 exit /b %errorlevel%

start "" "https://github.com/EldiEnfiel/my-app/actions"
