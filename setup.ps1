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

if (Test-Command "docker") {
  Write-Host "✓ Docker found" -ForegroundColor Green
  $hasDocker = $true
} else {
  Write-Host "! Docker not found. You'll need to point MONGODB_URI at an existing MongoDB instance." -ForegroundColor Yellow
  $hasDocker = $false
}

# 2) .env
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "✓ Created .env from .env.example" -ForegroundColor Green
  Write-Host "  → Edit .env and set ANTHROPIC_API_KEY (or DEFAULT_MODEL_PROVIDER=openai + OPENAI_API_KEY)" -ForegroundColor Yellow
} else {
  Write-Host "✓ .env already exists" -ForegroundColor Green
}

# 3) Install
Write-Host ""
Write-Host "Installing npm dependencies…" -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 4) Start Mongo (optional)
if ($hasDocker) {
  Write-Host ""
  $start = Read-Host "Start MongoDB via Docker? (y/N)"
  if ($start -eq "y" -or $start -eq "Y") {
    docker compose up -d
    Write-Host "Waiting for Mongo to be ready…"
    Start-Sleep -Seconds 5
    Write-Host ""
    Write-Host "Seeding sample data…" -ForegroundColor Cyan
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
