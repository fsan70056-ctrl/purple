@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe -m app.main >> server.log 2>&1
