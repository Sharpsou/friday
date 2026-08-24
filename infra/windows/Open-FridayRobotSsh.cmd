@echo off
title Friday Robot - SSH
ssh -i "D:\FridayData\robot\ssh\alphabot2_runtime_v3_ed25519" pi@192.168.1.22
if errorlevel 1 (
  echo.
  echo Connexion impossible. Verifie que le robot est allume et connecte au Wi-Fi.
  pause
)
