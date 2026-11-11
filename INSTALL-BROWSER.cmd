@echo off
cd /d "%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0data\playwright-browsers"
call npm ci
if errorlevel 1 goto failed
call npx playwright install chromium
if errorlevel 1 goto failed
echo Browser setup complete. Start Jobdesk and choose Fetch jobs.
pause
exit /b 0
:failed
echo Browser setup did not complete. Check your internet connection and try again.
pause
exit /b 1
