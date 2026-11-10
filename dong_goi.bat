@echo off
setlocal
cd /d "%~dp0"
title Dong goi FB Page Automator

python scripts\build_release.py
if errorlevel 1 (
    echo.
    echo [ERROR] Dong goi that bai! Vui long kiem tra log o tren.
    pause
    exit /b 1
)

pause
exit /b 0
