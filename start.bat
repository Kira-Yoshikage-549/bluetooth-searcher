@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Creating Python 3.12 virtual environment...
    py -3.12 -m venv .venv
    if errorlevel 1 (
        echo Could not create the virtual environment. Install Python 3.12 and retry.
        pause
        exit /b 1
    )
)

if not exist ".venv\.ready" (
    echo Installing pinned dependencies...
    ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.lock
    if errorlevel 1 (
        echo Installation failed. Check your connection and retry.
        pause
        exit /b 1
    )
    type nul > ".venv\.ready"
)

".venv\Scripts\python.exe" launch.py
if errorlevel 1 pause
