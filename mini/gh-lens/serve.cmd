@echo off
rem ============================================================
rem  gh-lens launcher
rem
rem  NOTE 1: keep this file ASCII-only. cmd.exe reads .cmd files
rem  in the ANSI code page, so UTF-8 Chinese here gets mangled
rem  into invalid commands and the script dies before Node starts.
rem
rem  NOTE 2: the browser is opened from THIS script, not from
rem  server.mjs. A process launched by the DSH sandbox cannot
rem  reach the desktop browser; a double-clicked .cmd can.
rem ============================================================
chcp 65001 >nul
setlocal

set "NODE=node"
where node >nul 2>nul
if not errorlevel 1 goto have_node

set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if exist "%NODE%" goto have_node

echo.
echo   Node.js not found.
echo   Install Node.js 22.19+ or 24+, or put it on PATH.
echo.
pause
exit /b 1

:have_node
set "PORT=%GHLENS_PORT%"
if not defined PORT set "PORT=8787"
set "URL=http://127.0.0.1:%PORT%"

rem Do not let the server try to open a browser too (avoid two tabs).
set "GHLENS_NO_OPEN=1"

echo.
echo   gh-lens
echo   ---------------------------------------------
echo   URL   : %URL%
echo   Node  : %NODE%
echo   ---------------------------------------------
echo   A browser tab opens in ~2 seconds.
echo   Close this window to stop the server.
echo.

rem Delayed open so the server has time to listen.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 2000; Start-Process '%URL%'"

"%NODE%" "%~dp0server.mjs"
set "RC=%ERRORLEVEL%"

echo.
echo   Server exited (code %RC%).
if not "%RC%"=="0" echo   See the messages above. Port busy? try:  set GHLENS_PORT=8788
echo   If no tab opened, visit manually:  %URL%
echo.
pause
exit /b %RC%
