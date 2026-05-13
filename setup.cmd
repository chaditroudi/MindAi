@echo off
REM Mind Platform — Multi-Agent Viz · Windows setup (CMD)
REM Run from cmd: setup.cmd

echo Mind Platform - Multi-Agent Viz - Windows setup
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js is not installed. Install Node 20+ from https://nodejs.org
  exit /b 1
)

if not exist .env (
  copy .env.example .env >nul
  echo [+] Created .env from .env.example
  echo     Edit .env and set ANTHROPIC_API_KEY before running the server.
) else (
  echo [+] .env already exists
)

echo.
echo Installing npm dependencies...
call npm install
if errorlevel 1 exit /b %errorlevel%

where docker >nul 2>&1
if not errorlevel 1 (
  echo.
  set /p START="Start MongoDB via Docker? (y/N) "
  if /i "%START%"=="y" (
    docker compose up -d
    timeout /t 5 /nobreak >nul
    echo Seeding sample data...
    call npm run seed
  )
)

echo.
echo Setup complete.
echo Next:
echo   1. Confirm your API key is in .env
echo   2. Run:  npm run dev
echo   3. Open: http://localhost:3000
