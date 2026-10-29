@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-react-dev.ps1"
if errorlevel 1 (
    echo.
    echo Script failed.
    pause
)
