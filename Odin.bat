@echo off
rem Doble clic para arrancar Odin en Windows.
cd /d "%~dp0"
title ODIN
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install || goto :error
)
if not exist .env (
  echo Falta el archivo .env. Copia odin.env.example como .env y rellenalo.
  pause
  exit /b 1
)
rem Cierra un Odin anterior que siga escuchando en los puertos 8787 / 5173.
for %%P in (8787 5173) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do taskkill /PID %%I /F >nul 2>&1
)
start "" http://localhost:5173
call npm start
goto :eof
:error
echo Algo ha fallado. Revisa los mensajes de arriba.
pause
