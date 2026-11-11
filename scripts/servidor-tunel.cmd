@echo off
rem Envoltorio para el Programador de tareas de Windows: mantiene la aplicación andando
rem en la máquina que la publica con Cloudflare Tunnel.
rem
rem Si el servidor se cae, espera 30 segundos y lo vuelve a levantar. El Programador de
rem tareas solo reintenta cuando la tarea no arranca, no cuando el programa termina con
rem error, así que el reintento va acá. Cada arranque queda en servidor.log, junto a la base.
cd /d "%~dp0.."
:otra_vez
node "scripts\tunel.js"
rem Pausa con ping y no con timeout: sin consola, timeout falla al instante y esto
rem quedaría reintentando sin respiro.
ping -n 31 127.0.0.1 >nul
goto otra_vez
