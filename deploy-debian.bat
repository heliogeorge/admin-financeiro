@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-debian.ps1" %*
