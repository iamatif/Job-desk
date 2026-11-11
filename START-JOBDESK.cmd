@echo off
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" "%~dp0launcher.mjs"
if errorlevel 1 pause
