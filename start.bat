@echo off
title Leon AI Startup System
cd /d "%~dp0"

echo ===================================================
echo           Leon AI Prototyping System
echo ===================================================
echo.
echo Starting the application via start.py...
echo.

python start.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to start Leon AI using 'python'.
    echo Trying to run with 'py' command instead...
    echo.
    py start.py
)

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Project startup failed.
    echo Please make sure Python is installed and added to your system PATH.
    echo.
    pause
)
