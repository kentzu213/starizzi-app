#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Starizzi Desktop — Windows Build & Release (PowerShell)
.DESCRIPTION
  Double-click or run from terminal. Sets GH_TOKEN env var to publish.
  Without GH_TOKEN, builds local installer only.
.EXAMPLE
  .\release-win.ps1
  $env:GH_TOKEN = "ghp_xxx"; .\release-win.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===== Starizzi Desktop Release (Windows) =====" -ForegroundColor Cyan
Write-Host ""

# Navigate to desktop app root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir "..")
Write-Host "[1/5] Working directory: $PWD"
Write-Host ""

# Check prerequisites
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not found." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node: $(node -v)"

if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] pnpm not found." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] pnpm: $(pnpm -v)"
Write-Host ""

# Tests
Write-Host "[2/5] Running tests..."
pnpm test
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Tests failed!" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] All tests passed." -ForegroundColor Green
Write-Host ""

# Build
Write-Host "[3/5] Building renderer + main..."
pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Build successful." -ForegroundColor Green
Write-Host ""

# Determine publish mode
$publishMode = if ($env:GH_TOKEN) { "always" } else { "never" }
if ($publishMode -eq "always") {
    Write-Host "[4/5] GH_TOKEN detected — will PUBLISH to GitHub." -ForegroundColor Yellow
} else {
    Write-Host "[4/5] GH_TOKEN not set — LOCAL build only." -ForegroundColor Gray
    Write-Host "       To publish: `$env:GH_TOKEN = 'ghp_xxx'; .\release-win.ps1"
}
Write-Host ""

# Package
Write-Host "[5/5] Packaging with electron-builder..."
npx electron-builder --win --publish $publishMode
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] electron-builder failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "===== BUILD COMPLETE =====" -ForegroundColor Green
Write-Host ""
Write-Host "Output: $PWD\release\"
Write-Host ""

if (Test-Path "release") {
    Get-ChildItem release -Filter "*.exe" | ForEach-Object { Write-Host "  $_" }
    Get-ChildItem release -Filter "*.yml" | ForEach-Object { Write-Host "  $_" }
}

if ($publishMode -eq "always") {
    Write-Host ""
    Write-Host "[PUBLISHED] https://github.com/kentzu213/starizzi-app/releases" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Press any key to close." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
