@echo off
set EDIT_KEY=local-edit-key
start "Lori Project Dashboard Server" /D "%~dp0" npm.cmd start
timeout /t 3 /nobreak >nul
start "" "http://localhost:4174/?mode=edit&key=local-edit-key"
