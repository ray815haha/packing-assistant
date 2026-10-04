@echo off
title Set up accounts and sync
cd /d "%~dp0"

rem Find Python 3: prefer the "py" launcher, fall back to "python".
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY goto nopython

echo.
echo   Accounts and sync keep saved trips on all your devices.
echo   First set up a free Supabase project (see README.md, "Accounts and sync"),
echo   then paste its Project URL and publishable key below.
echo.
%PY% tools\setup_sync.py
echo.
pause
exit /b 0

:nopython
echo.
echo   Python 3.10 or newer is needed and wasn't found.
echo   The download page will open now. During setup, tick
echo   "Add python.exe to PATH", then double-click this file again.
echo.
start "" https://www.python.org/downloads/
pause
exit /b 1
