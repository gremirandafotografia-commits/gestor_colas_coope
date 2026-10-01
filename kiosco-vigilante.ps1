# ============================================================================
# Vigilante del kiosco — COOPELESCA Gestión de Filas
#
# Qué hace: revisa cada 15 segundos si Chrome está corriendo. Si NO lo está
# (porque alguien lo cerró, se cayó, o Windows acaba de arrancar), lo vuelve
# a abrir en modo kiosco con impresión silenciosa, apuntando a la pantalla
# del sistema. No hace nada si Chrome ya está abierto — no abre una segunda
# ventana encima de la que ya funciona.
#
# Cómo instalarlo (una sola vez por equipo):
#   1. Copie este archivo a una carpeta fija en esa PC, por ejemplo:
#        C:\Kiosco\kiosco-vigilante.ps1
#   2. Presione Win+R, escriba shell:startup y Enter.
#   3. Dentro de esa carpeta, cree un acceso directo nuevo con:
#        Destino:  powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Kiosco\kiosco-vigilante.ps1"
#      (ajuste la ruta si copió el archivo a otro lugar)
#   4. Reinicie la PC para probarlo.
#
# Para detenerlo manualmente: Administrador de tareas → busque
# "Windows PowerShell" → Finalizar tarea (además de cerrar Chrome si aplica).
# ============================================================================

# --- Ajuste estos dos valores si su instalación es distinta ---
$urlKiosco = "https://gestorcolascoope-production.up.railway.app/"
$rutaChrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
# Si Chrome está instalado solo para este usuario (no para todo el equipo),
# la ruta suele ser esta otra en vez de la de arriba:
$rutaChromeUsuario = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"

$exeChrome = if (Test-Path $rutaChrome) { $rutaChrome } elseif (Test-Path $rutaChromeUsuario) { $rutaChromeUsuario } else { $null }

if (-not $exeChrome) {
  # No se encontró Chrome en ninguna de las dos rutas típicas — corrija
  # $rutaChrome arriba con la ruta real de este equipo.
  exit 1
}

while ($true) {
  $corriendo = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
  if (-not $corriendo) {
    Start-Process -FilePath $exeChrome -ArgumentList @(
      "--kiosk-printing",
      "--kiosk",
      "`"$urlKiosco`""
    )
    # Le da tiempo a Chrome de arrancar del todo antes de volver a revisar,
    # para no lanzarlo dos veces mientras todavía está abriendo.
    Start-Sleep -Seconds 20
  }
  Start-Sleep -Seconds 15
}
