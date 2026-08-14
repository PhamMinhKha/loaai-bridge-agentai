@echo off
REM Double-click hoặc: scripts\setup-dev.bat
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-dev.ps1"
if errorlevel 1 pause
