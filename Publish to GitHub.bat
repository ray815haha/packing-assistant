@echo off
title Publish Smart Packing Assistant to GitHub Pages
cd /d "%~dp0"

where git >nul 2>nul || goto nogit

echo.
echo   This puts the app online with GitHub Pages (free).
echo   First create an EMPTY repository on github.com (no README),
echo   e.g. named packing-assistant, and copy its URL.
echo.

rem 1. The deploy workflow: tests the app and publishes dist\site on every push.
if not exist ".github\workflows" mkdir ".github\workflows"
copy /y "tools\github-pages.yml" ".github\workflows\deploy-pages.yml" >nul

rem 2. A local git repository with everything committed.
if not exist ".git" git init -b main >nul
git config user.name >nul 2>nul || git config user.name "Smart Packing Assistant"
git config user.email >nul 2>nul || git config user.email "packing-assistant@users.noreply.github.com"
git add -A
git commit -q -m "Publish Smart Packing Assistant" >nul 2>nul
git branch -M main

rem 3. Push to the repository you created.
set "REPO="
set /p REPO=Paste the repository URL (https://github.com/you/packing-assistant.git): 
if "%REPO%"=="" goto norepo
git remote remove origin >nul 2>nul
git remote add origin "%REPO%"
git push -u origin main || goto pushfailed

echo.
echo   Pushed. Last step, once only: on GitHub open the repository's
echo   Settings ^> Pages and set Source to "GitHub Actions".
echo   About a minute later the app is live at
echo   https://YOUR-USERNAME.github.io/REPOSITORY-NAME/
echo   After that, running this file again publishes your latest changes.
echo.
pause
exit /b 0

:nogit
echo Git isn't installed. The download page will open; install it, then run this file again.
start "" https://git-scm.com/download/win
pause
exit /b 1

:norepo
echo No URL entered, nothing was pushed. Run this file again when you have the repository URL.
pause
exit /b 1

:pushfailed
echo.
echo   The push didn't go through. Check the URL, and sign in to GitHub
echo   when the login window appears. Then run this file again.
pause
exit /b 1
