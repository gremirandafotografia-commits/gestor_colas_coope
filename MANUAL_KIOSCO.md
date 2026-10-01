# Manual de configuración física — Kiosco y pantalla de sala

Esta guía es para quien instale o le dé mantenimiento a las computadoras
físicas del sistema (no requiere saber programar). Cubre cómo dejar una
pantalla de **kiosco** (donde el asociado toca para sacar su ficha) o de
**sala** (pantalla que muestra el turno llamado) lista para funcionar sola,
sin que nadie tenga que intervenir después de instalarla.

No aplica a las computadoras de **ventanilla** ni de **Administración** —
esas sí deben pedir inicio de sesión normal, porque identifican a la persona
que está atendiendo en ese momento.

---

## 1. Impresión de la ficha (kiosco)

Las fichas se imprimen en blanco y negro sólido, sin colores — así se evita
que una impresora térmica (de un solo color) tenga que "tramar" en puntos
los colores de pantalla, que es lo que se veía como una ficha pixelada o
granulada. Esto ya viene corregido en el sistema; no requiere configuración
adicional, pero si en el futuro una ficha vuelve a verse pixelada, revise
primero el paso 3 (tamaño de papel en el driver de la impresora) antes de
sospechar del código.

Para probar la impresión sin imprimir un turno real: **Administración →
Configuración → botón "Probar impresión"**, junto al campo de impresora
designada.

## 2. Poner la impresora térmica como predeterminada en Windows

1. `Configuración` → `Bluetooth y dispositivos` → `Impresoras y escáneres`.
2. Seleccione la impresora del ticket (ej. la EPSON TM-T20).
3. `Establecer como predeterminada`.
4. Dentro de esa misma impresora → `Preferencias de impresión` → confirme
   que el tamaño de papel sea el del rollo real (80mm continuo, o el que
   corresponda) — si el driver tiene otro tamaño configurado, el navegador
   puede recortar o escalar mal la ficha aunque el sistema ya la genere en
   blanco y negro correctamente.

## 3. Abrir la pantalla en modo kiosco, con impresión silenciosa

1. Clic derecho en el escritorio → `Nuevo` → `Acceso directo`.
2. En "Ubicación del elemento" (ajuste la ruta si Chrome está instalado en
   otro lugar):
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --kiosk "https://gestorcolascoope-production.up.railway.app/"
   ```
   Con Microsoft Edge:
   ```
   "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk-printing --kiosk "https://gestorcolascoope-production.up.railway.app/"
   ```
3. `--kiosk-printing` imprime directo a la impresora predeterminada, sin
   mostrar el diálogo de vista previa. `--kiosk` pone el navegador a
   pantalla completa sin barra de direcciones (quítelo en ventanilla/sala
   si prefiere ver los controles del navegador).

**Importante:** si Chrome/Edge ya estaba abierto (otra ventana o pestaña)
cuando se abre este acceso directo, Windows reutiliza esa ventana existente
e **ignora por completo** `--kiosk-printing` — por eso vuelve a aparecer el
diálogo de impresión. Antes de probar, cierre todo Chrome/Edge (revise en
el Administrador de tareas que no quede ningún proceso `chrome.exe` /
`msedge.exe`) y recién ahí abra el acceso directo.

Para salir del modo kiosco (mantenimiento): `Alt + F4`, o
`Ctrl + Alt + Supr` → Administrador de tareas → Finalizar tarea.

## 4. Arranque automático de Windows

**4.1 — Inicio de sesión automático** (para que no pida contraseña de
Windows después de un reinicio):
1. `Win + R` → `netplwiz` → Enter.
2. Seleccione la cuenta de esa PC.
3. Desmarque "Los usuarios deben escribir su nombre y contraseña para usar
   este equipo".
4. `Aplicar` → confirme la contraseña una vez.

**4.2 — Que el navegador se abra solo:**
1. `Win + R` → `shell:startup` → Enter.
2. Mueva ahí el acceso directo creado en el paso 3.

**4.3 — Que la pantalla no se apague ni se duerma:**
1. `Configuración` → `Sistema` → `Pantalla y suspensión`.
2. Ponga "Nunca" en Pantalla y en Suspensión.
3. Si hay protector de pantalla activo, desactívelo.

## 5. Script vigilante — que la pantalla se reabra sola si se cierra

Archivo `kiosco-vigilante.ps1` (en la carpeta del proyecto): revisa cada 15
segundos si Chrome está corriendo; si no, lo vuelve a abrir en modo kiosco.
Protege contra cierres accidentales, caídas del navegador, o reinicios.

**Instalación (una sola vez por equipo):**
1. Copie `kiosco-vigilante.ps1` a una carpeta fija en esa PC, ej.
   `C:\Kiosco\kiosco-vigilante.ps1`.
2. `Win + R` → `shell:startup` → Enter.
3. Dentro de esa carpeta, cree un acceso directo nuevo con destino:
   ```
   powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Kiosco\kiosco-vigilante.ps1"
   ```
4. Reinicie la PC para probarlo.

Para detenerlo: Administrador de tareas → "Windows PowerShell" → Finalizar
tarea (además de cerrar Chrome si aplica).

## 6. Bloqueo más estricto (opcional) — modo kiosco oficial de Windows

Si además de todo lo anterior quiere impedir que alguien minimice, acceda
al escritorio, o abra otras aplicaciones en esa PC:

1. `Win` → escriba "configuración" → Enter (o `Win + I`).
2. `Cuentas` → `Otros usuarios`.
3. Busque "Configurar un kiosco" (el nombre exacto varía según la versión
   de Windows 10/11; puede no estar disponible en ediciones Home).
4. Siga el asistente: crea una cuenta dedicada, elija Microsoft Edge como
   app, y pegue la URL del sistema.

Esta opción bloquea Alt+Tab y la tecla Windows, quita toda la interfaz de
escritorio, y si la app se cierra, Windows la vuelve a abrir sola — es más
robusto que el acceso directo del paso 3, pero no siempre está disponible
según la edición de Windows. Si no aparece, el método de los pasos 3-5
sigue siendo un respaldo sólido.

## 7. Por qué la sesión no vuelve a pedir login en kiosco/sala

Las pantallas de kiosco y sala reciben, al registrarse por primera vez, una
sesión de **30 días** en vez de las 10 horas normales — y esa sesión
sobrevive a que Chrome se cierre y se vuelva a abrir (incluso por el script
vigilante o un reinicio completo del equipo). Por eso, una vez configurada
una pantalla de kiosco o sala, nadie debería tener que volver a iniciar
sesión ahí salvo que:
- Pasen los 30 días sin que la pantalla se haya usado (vuelve a pedir
  login, y se reinicia el plazo otra 30 días al registrar de nuevo).
- Un administrador elimine o restablezca esa cuenta desde
  `Administración → Usuarios`.
- Alguien use "Cerrar sesión" manualmente en esa pantalla.

Ventanilla y Administración siguen con la sesión normal de 10 horas, atada
a la persona que inició sesión — eso no cambió.

---

## Resumen — checklist para dejar una pantalla de kiosco o sala lista

- [ ] Impresora térmica configurada como predeterminada, con el tamaño de
      papel correcto en su driver (paso 2).
- [ ] Acceso directo con `--kiosk-printing --kiosk` creado y probado con
      Chrome/Edge completamente cerrado antes de abrirlo (paso 3).
- [ ] Inicio de sesión automático de Windows activado (paso 4.1).
- [ ] Acceso directo movido a `shell:startup` (paso 4.2).
- [ ] Pantalla y suspensión en "Nunca" (paso 4.3).
- [ ] `kiosco-vigilante.ps1` instalado y probado (paso 5).
- [ ] Sesión iniciada una vez y pantalla registrada como Kiosco o Sala
      dentro de la app — confirme que sobrevive a un reinicio de Chrome.
