@echo off
cd /d "%~dp0"
title AirDrop File Sharing
call npm start
if errorlevel 1 pause
