@echo off
rem Envoltorio para el Programador de tareas de Windows.
rem Existe para que la tarea apunte a un archivo y no a una línea de comando con comillas
rem anidadas, que es donde esto se suele romper.
cd /d "%~dp0.."
node "scripts\respaldo.js"
exit /b %errorlevel%
