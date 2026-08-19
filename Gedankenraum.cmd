@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Gedankenraum braucht Node.js 22 oder neuer.
  echo https://nodejs.org/
  pause
  exit /b 1
)
set "NODE_MAJOR="
for /f %%v in ('node -p "parseInt(process.versions.node)"') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR (
  echo Die installierte Node.js-Version konnte nicht gelesen werden.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 22 (
  echo Gedankenraum braucht Node.js 22 oder neuer.
  echo Installierte Version:
  node --version
  pause
  exit /b 1
)
if /i "%~1"=="--check" exit /b 0
node src/server.mjs --open
if errorlevel 1 pause
