@echo off
cd /d "%~dp0"
echo [1/3] create venv > setup-log.txt
python -m venv .venv >> setup-log.txt 2>&1
echo [2/3] pip install >> setup-log.txt
.venv\Scripts\python.exe -m pip install -r requirements.txt >> setup-log.txt 2>&1
echo [3/3] strudel runtime >> setup-log.txt
python tools\build_strudel_runtime.py >> setup-log.txt 2>&1
.venv\Scripts\python.exe -c "import fastapi,uvicorn,numpy,onnxruntime,yaml,pypinyin;print(\"IMPORT_OK\",onnxruntime.__version__,numpy.__version__)" >> setup-log.txt 2>&1
echo DONE >> setup-log.txt
