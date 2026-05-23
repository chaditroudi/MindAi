# Mind Platform — Multi-Agent Viz · Windows setup helper
# Run from PowerShell: .\setup.ps1

$ErrorActionPreference = "Stop"

Write-Host "Mind Platform · Multi-Agent Viz — Windows setup" -ForegroundColor Cyan
Write-Host ""

# 1) Check prerequisites
function Test-Command($cmd) {
  $null = Get-Command $cmd -ErrorAction SilentlyContinue
  return $?
}

if (-not (Test-Command "node")) {
  Write-Host "✗ Node.js is not installed. Install Node 20+ from https://nodejs.org" -ForegroundColor Red
  exit 1
}

$nodeVersion = (node --version).TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 20) {
  Write-Host "✗ Node.js $nodeVersion is too old. Need 20+." -ForegroundColor Red
  exit 1
}
Write-Host "✓ Node.js $nodeVersion" -ForegroundColor Green

if (-not (Test-Command "mongosh")) {
  Write-Host "! mongosh was not found. Install MongoDB Shell or make sure MongoDB tools are on PATH." -ForegroundColor Yellow
} else {
  Write-Host "✓ mongosh found" -ForegroundColor Green
}

# 2) .env
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "✓ Created .env from .env.example" -ForegroundColor Green
  Write-Host "  → Edit .env and set GROQ_API_KEY if needed" -ForegroundColor Yellow
} else {
  Write-Host "✓ .env already exists" -ForegroundColor Green
}

# 3) Install
Write-Host ""
Write-Host "Installing npm dependencies…" -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 4) Verify local MongoDB
Write-Host ""
Write-Host "Checking local MongoDB connection..." -ForegroundColor Cyan
npm run db:check
if ($LASTEXITCODE -ne 0) {
  Write-Host "! Start local MongoDB and confirm MONGODB_URI/MONGODB_DB in .env, then run npm run seed." -ForegroundColor Yellow
} else {
  $seed = Read-Host "Seed sample data into local MongoDB? (y/N)"
  if ($seed -eq "y" -or $seed -eq "Y") {
    npm run seed
  }
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Make sure your API key is in .env"
Write-Host "  2. Run:  npm run dev"
Write-Host "  3. Open: http://localhost:3000"
