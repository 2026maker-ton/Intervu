@echo off
rem Intervu local server launcher (Windows)
rem Double-click this file, or run it from a terminal, to start the local server
rem and open the app in the default browser.

cd /d "%~dp0"

set "PORT=3000"
if not "%~1"=="" set "PORT=%~1"
set "URL=http://localhost:%PORT%"

where node >nul 2>nul
if errorlevel 1 (
  echo [Intervu] Node.js was not found. Install Node.js 20 or newer: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [Intervu] npm was not found. Reinstall Node.js 20 or newer: https://nodejs.org/
  pause
  exit /b 1
)

echo [Intervu] Starting local server at %URL% ...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"

set "PORT=%PORT%"
call npm start
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo [Intervu] Server stopped (exit code %EXIT_CODE%).
pause
exit /b %EXIT_CODE%
