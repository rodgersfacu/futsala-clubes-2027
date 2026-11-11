# Registra en el Programador de tareas de Windows lo que tiene que andar solo en la
# máquina que publica la aplicación con Cloudflare Tunnel:
#
#   FUTSALA servidor   arranca la aplicación al prender la máquina, sin que nadie inicie
#                      sesión, y la vuelve a levantar si se cae (scripts\servidor-tunel.cmd).
#   FUTSALA respaldo   copia, verifica y rota la base todos los días (scripts\respaldo.cmd).
#
# Antes: `npm run preparar-tunel <dominio>` y probar una vez con `npm run tunel`.
#
# Se corre como administrador (clic derecho en PowerShell > Ejecutar como administrador):
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-tareas.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-tareas.ps1 -HoraRespaldo 03:00
#
# Volver a correrlo reemplaza las dos tareas: no duplica nada. Si esta máquina ya tenía
# otra tarea de respaldo de FUTSALA con otro nombre, desactivala para no respaldar dos veces.

param(
  [string]$HoraRespaldo = '23:30'
)

$ErrorActionPreference = 'Stop'

$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
  Write-Host ''
  Write-Host '  Hay que correrlo como administrador: las tareas arrancan con la máquina,'
  Write-Host '  antes de que nadie inicie sesión.'
  Write-Host ''
  exit 1
}

$raiz = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $raiz '.env'))) {
  Write-Host ''
  Write-Host '  Falta la configuración del túnel. Primero:'
  Write-Host '    npm run preparar-tunel reuniones.ejemplo.com.ar'
  Write-Host ''
  exit 1
}

# Las tareas corren como SYSTEM, que no tiene el PATH de quien instaló Node. Se le pasa
# la carpeta de node.exe explícita.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host '  No encuentro node.exe en el PATH. Instalá Node 22.5 o superior y volvé a correr esto.'
  exit 1
}
$carpetaNode = Split-Path -Parent $node

$usuario = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

function Accion($archivoCmd) {
  # cmd /c con PATH ampliado, así el .cmd encuentra node aunque corra como SYSTEM.
  $linea = "/c set ""PATH=$carpetaNode;%PATH%"" && ""$raiz\scripts\$archivoCmd"""
  New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $linea -WorkingDirectory $raiz
}

# --- Servidor ----------------------------------------------------------------
# Sin límite de duración (por omisión Windows corta las tareas a las 72 horas), sin
# pararse con batería, y si se perdió el arranque se corre apenas se pueda.
$ajustesServidor = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'FUTSALA servidor' -Force `
  -Description 'Aplicación FUTSALA Reuniones 2027, publicada con Cloudflare Tunnel.' `
  -Action (Accion 'servidor-tunel.cmd') `
  -Trigger (New-ScheduledTaskTrigger -AtStartup) `
  -Settings $ajustesServidor `
  -Principal $usuario | Out-Null

# --- Respaldo ----------------------------------------------------------------
$ajustesRespaldo = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable

Register-ScheduledTask -TaskName 'FUTSALA respaldo' -Force `
  -Description 'Respaldo diario verificado de la base de FUTSALA Reuniones 2027.' `
  -Action (Accion 'respaldo.cmd') `
  -Trigger (New-ScheduledTaskTrigger -Daily -At $HoraRespaldo) `
  -Settings $ajustesRespaldo `
  -Principal $usuario | Out-Null

Write-Host ''
Write-Host '  Tareas registradas:'
Write-Host '    FUTSALA servidor   al prender la máquina'
Write-Host "    FUTSALA respaldo   todos los días a las $HoraRespaldo"
Write-Host ''
Write-Host '  Para arrancar el servidor ahora sin reiniciar:'
Write-Host "    Start-ScheduledTask -TaskName 'FUTSALA servidor'"
Write-Host ''
Write-Host '  Si `npm run tunel` sigue abierto en otra ventana, cerralo antes: los dos no'
Write-Host '  pueden usar el mismo puerto.'
Write-Host ''
