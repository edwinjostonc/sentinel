@echo off
title n8n - KEEP THIS WINDOW OPEN
echo Starting n8n... this takes about 1-3 minutes.
echo When you see "Editor is now accessible via", open http://localhost:5678
echo To stop n8n: press Ctrl+C in this window, or just close it.
echo.
if not exist "%~dp0logs" mkdir "%~dp0logs"
rem only this laptop can open n8n (it holds the Google, Gmail and Gemini logins); other Wi-Fi devices cannot reach it
set N8N_LISTEN_ADDRESS=127.0.0.1
set N8N_LOG_OUTPUT=console,file
set N8N_LOG_FILE_LOCATION=%~dp0logs\n8n.log
n8n start
pause
