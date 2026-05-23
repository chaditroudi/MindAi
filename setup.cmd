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
  echo     Edit .env and set GROQ_API_KEY before running the server.
) else (
  echo [+] .env already exists
)

echo.
echo Installing npm dependencies...
call npm install
if errorlevel 1 exit /b %errorlevel%

echo.
echo Checking local MongoDB connection...
call npm run db:check
if errorlevel 1 (
  echo [!] Start local MongoDB and confirm MONGODB_URI/MONGODB_DB in .env, then run npm run seed.
) else (
  echo.
  set /p SEED="Seed sample data into local MongoDB? (y/N) "
  if /i "%SEED%"=="y" (
    call npm run seed
  )
)

echo.
echo Setup complete.
echo Next:
echo   1. Confirm your API key is in .env
echo   2. Run:  npm run dev
echo   3. Open: http://localhost:3000
