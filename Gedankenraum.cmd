@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Gedankenraum braucht Node.js 22 oder neuer.
  echo https://nodejs.org/
  pause
  exit /b 1
)
for /f %%v in ('node -p "Number(process.versions.node.split('.')[0]) ^>= 22"') do set NODE_OK=%%v
if not "%NODE_OK%"=="true" (
  echo Gedankenraum braucht Node.js 22 oder neuer.
  echo Installierte Version:
  node --version
  pause
  exit /b 1
)
node src/server.mjs --open
if errorlevel 1 pause
