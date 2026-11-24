@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe tests\http_smoke.py > tests\http_smoke.log 2>&1
