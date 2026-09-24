@echo off
cd /d "%~dp0"
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {" ^
  "  $s = $ws.CreateShortcut((Join-Path $dir 'Smart Packing Assistant.lnk'));" ^
  "  $s.TargetPath = (Join-Path $env:HERE 'Start Packing Assistant.bat');" ^
  "  $s.WorkingDirectory = $env:HERE;" ^
  "  $s.IconLocation = (Join-Path $env:HERE 'web\icons\app.ico');" ^
  "  $s.WindowStyle = 7;" ^
  "  $s.Description = 'Pack your suitcase, step by step in 3D';" ^
  "  $s.Save() }"
if errorlevel 1 (
  echo Couldn't create the shortcuts.
) else (
  echo Done. "Smart Packing Assistant" is now on your desktop and in the Start menu.
)
pause
