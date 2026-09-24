@echo off
title Smart Packing Assistant
cd /d "%~dp0"

rem Find Python 3: prefer the "py" launcher, fall back to "python".
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY goto nopython
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul || goto nopython

echo.
echo   Smart Packing Assistant is starting...
echo   It opens in its own window. Keep this window open while you use it;
echo   close it to stop the app.
echo.
%PY% app.py --window
if errorlevel 1 pause
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
