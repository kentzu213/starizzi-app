@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM  Starizzi Desktop — Windows Build ^& Release Script
REM  
REM  Usage:
REM    1. Double-click to BUILD LOCAL only (no publish)
REM    2. Set GH_TOKEN before running to PUBLISH to GitHub Releases
REM
REM  Output: apps\desktop\release\
REM ============================================================

echo.
echo ===== Starizzi Desktop Release (Windows) =====
echo.

REM — Navigate to desktop app root
cd /d "%~dp0\.."
if errorlevel 1 (
    echo [ERROR] Cannot navigate to desktop app directory.
    pause
    exit /b 1
)

echo [1/5] Working directory: %CD%
echo.

REM — Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 18+.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo [OK] Node: %%i

REM — Check pnpm
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm not found. Run: npm install -g pnpm
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('pnpm -v') do echo [OK] pnpm: %%i
echo.

REM — Run tests first (verification-loop)
echo [2/5] Running tests...
call pnpm test
if errorlevel 1 (
    echo.
    echo [ERROR] Tests failed! Fix tests before releasing.
    pause
    exit /b 1
)
echo [OK] All tests passed.
echo.

REM — Build TypeScript + Vite
echo [3/5] Building renderer + main...
call pnpm build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)
echo [OK] Build successful.
echo.

REM — Check if GH_TOKEN is set for publishing
if defined GH_TOKEN (
    echo [4/5] GH_TOKEN detected — will BUILD and PUBLISH to GitHub.
    echo       Repo: kentzu213/starizzi-app
    echo.
    set PUBLISH_MODE=1
) else (
    echo [4/5] GH_TOKEN not set — building LOCAL installer only.
    echo       To publish: set GH_TOKEN=ghp_your_token_here
    echo.
    set PUBLISH_MODE=0
)

REM — Run electron-builder
echo [5/5] Packaging with electron-builder...
echo.

if !PUBLISH_MODE!==1 (
    call npx electron-builder --win --publish always
) else (
    call npx electron-builder --win --publish never
)

if errorlevel 1 (
    echo.
    echo [ERROR] electron-builder failed!
    pause
    exit /b 1
)

echo.
echo ===== BUILD COMPLETE =====
echo.
echo Output files are in: %CD%\release\
echo.

REM — List output files
if exist "release" (
    echo Files created:
    dir /b release\*.exe 2>nul
    dir /b release\*.yml 2>nul
    echo.
)

if !PUBLISH_MODE!==1 (
    echo [PUBLISHED] Release uploaded to GitHub: https://github.com/kentzu213/starizzi-app/releases
) else (
    echo [LOCAL ONLY] Install the .exe from release\ folder.
    echo To publish later: set GH_TOKEN=... and re-run this script.
)

echo.
pause
