@echo off
setlocal

cd /d "%~dp0"

set "AWS_EXE=%ProgramFiles%\Amazon\AWSCLIV2\aws.exe"
if not exist "%AWS_EXE%" set "AWS_EXE=aws.exe"

set "AWS_PROFILE_NAME="
set "STATUS_ONLY="
set "REMOTE_LOGIN="

:parse_args
if "%~1"=="" goto args_done

if /i "%~1"=="--status-only" (
  set "STATUS_ONLY=1"
  shift
  goto parse_args
)

if /i "%~1"=="--remote" (
  set "REMOTE_LOGIN=1"
  shift
  goto parse_args
)

if /i "%~1"=="--profile" (
  if "%~2"=="" (
    echo Missing value for --profile.
    exit /b 1
  )
  set "AWS_PROFILE_NAME=%~2"
  shift
  shift
  goto parse_args
)

if not defined AWS_PROFILE_NAME (
  set "AWS_PROFILE_NAME=%~1"
  shift
  goto parse_args
)

echo Unknown argument: %~1
echo Usage: %~nx0 [profile-name ^| --profile profile-name] [--status-only] [--remote]
exit /b 1

:args_done
if not defined AWS_PROFILE_NAME if defined AWS_PROFILE set "AWS_PROFILE_NAME=%AWS_PROFILE%"

echo [status] Checking AWS session...
if defined AWS_PROFILE_NAME (
  echo [status] Profile: %AWS_PROFILE_NAME%
  "%AWS_EXE%" sts get-caller-identity --output json --profile "%AWS_PROFILE_NAME%"
) else (
  echo [status] Profile: default
  "%AWS_EXE%" sts get-caller-identity --output json
)
set "STATUS_EXIT=%ERRORLEVEL%"

if "%STATUS_EXIT%"=="0" (
  echo [status] AWS session is currently valid.
) else (
  echo [status] AWS session is missing or expired.
)

if defined STATUS_ONLY (
  endlocal & exit /b %STATUS_EXIT%
)

echo.
echo [login] Starting AWS login...
if defined REMOTE_LOGIN (
  if defined AWS_PROFILE_NAME (
    "%AWS_EXE%" login --remote --profile "%AWS_PROFILE_NAME%"
  ) else (
    "%AWS_EXE%" login --remote
  )
) else (
  if defined AWS_PROFILE_NAME (
    "%AWS_EXE%" login --profile "%AWS_PROFILE_NAME%"
  ) else (
    "%AWS_EXE%" login
  )
)
set "LOGIN_EXIT=%ERRORLEVEL%"
if not "%LOGIN_EXIT%"=="0" (
  echo.
  echo [login] AWS login failed with exit code %LOGIN_EXIT%.
  pause
  endlocal & exit /b %LOGIN_EXIT%
)

echo.
echo [status] Verifying AWS session after login...
if defined AWS_PROFILE_NAME (
  "%AWS_EXE%" sts get-caller-identity --output json --profile "%AWS_PROFILE_NAME%"
) else (
  "%AWS_EXE%" sts get-caller-identity --output json
)
set "VERIFY_EXIT=%ERRORLEVEL%"

if "%VERIFY_EXIT%"=="0" (
  echo [status] AWS login succeeded.
  endlocal & exit /b 0
)

echo [status] AWS login completed, but no valid session was detected.
pause
endlocal & exit /b %VERIFY_EXIT%
