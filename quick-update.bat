@echo off
REM Quick launcher for DanteCode universal update
echo.
echo Starting DanteCode Universal Update...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0update-all-versions.ps1"
pause
