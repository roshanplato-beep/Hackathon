@echo off
echo ============================================
echo   HeatScape Backend Setup (Windows)
echo ============================================
echo.

:: Try Python 3.13 first, then 3.12, then default
where py >nul 2>&1
if %errorlevel% equ 0 (
    echo Checking for Python 3.13...
    py -3.13 --version >nul 2>&1
    if %errorlevel% equ 0 (
        echo Found Python 3.13
        set PYTHON=py -3.13
        goto :install
    )
    echo Checking for Python 3.12...
    py -3.12 --version >nul 2>&1
    if %errorlevel% equ 0 (
        echo Found Python 3.12
        set PYTHON=py -3.12
        goto :install
    )
    echo Checking for Python 3.11...
    py -3.11 --version >nul 2>&1
    if %errorlevel% equ 0 (
        echo Found Python 3.11
        set PYTHON=py -3.11
        goto :install
    )
)

:: Fallback: try with PYO3 compatibility flag for Python 3.14+
echo No Python 3.11-3.13 found. Trying default Python with compatibility flag...
set PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1
set PYTHON=python
goto :install

:install
echo.
echo Installing dependencies...
%PYTHON% -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo ============================================
    echo   INSTALL FAILED
    echo   Please install Python 3.12 or 3.13 from:
    echo   https://www.python.org/downloads/
    echo ============================================
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Setup complete! Start the backend with:
echo   %PYTHON% -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
echo ============================================
pause
