# Notas de la primera prueba en ejecución real

Este backend se documentaba como "nunca ejecutado en un entorno real" — solo
validado por sintaxis y revisión manual. En esta sesión se instaló
PostgreSQL 16 localmente y se ejecutó el sistema de punta a punta por
primera vez. Quedan documentados aquí los resultados para que quede
constancia de qué se probó y qué encontró.

## Qué se hizo

1. Instalación de PostgreSQL 16 y creación de la base `coopelesca_filas`.
2. `npm install` — 122 paquetes, sin vulnerabilidades.
3. `node scripts/migrate.js` — creó las 17 tablas sin errores.
4. `node scripts/seed.js` — cargó sucursales, trámites, puestos, preguntas
   de encuesta y el usuario administrador sin errores.
5. `node src/server.js` — el servidor levantó y quedó escuchando en el
   puerto 4000 sin errores.
6. Pruebas por línea de comandos (`curl`) contra la API real:
   - Login con contraseña temporal → detecta primer ingreso correctamente.
   - Definir contraseña nueva → devuelve token JWT válido.
   - Login normal con la contraseña ya definida → token válido.
   - Consultar sucursales y trámites con el token → responde con los datos
     reales de la base.
   - **Recorrido completo de una ficha**: crear turno → llamar → iniciar
     atención → finalizar. Los cuatro pasos respondieron `200 OK` y el
     estado final quedó correctamente guardado en PostgreSQL.
   - Endpoint de métricas/reportes → devuelve el turno recién procesado.
   - Handshake de Socket.io → responde correctamente.
7. **Prueba de sincronización en tiempo real, en navegador (Playwright),
   con tres pestañas simultáneas simulando tres computadoras distintas**
   (kiosco, ventanilla, sala):
   - El kiosco emitió una ficha nueva (Internet).
   - La ventanilla la llamó.
   - La pantalla de sala **se actualizó sola, sin recargar**, mostrando el
     nuevo turno y moviendo el anterior a "Últimos turnos llamados" — la
     prueba concreta de que Socket.io está empujando los cambios en vivo
     entre pantallas, no solo que el HTML compila.

## Errores encontrados

Ninguno en el código del backend. Los dos únicos errores de consola vistos
en el navegador fueron `403` al cargar Montserrat y Material Symbols desde
Google Fonts — es una dependencia externa del HTML (no del backend) que no
carga en un entorno sin salida a internet; en producción, con acceso normal
a internet, no debería dar problema. Si se quiere que el sistema siga
funcionando sin depender de internet (como el prototipo original), esas
fuentes deberían empaquetarse localmente en vez de cargarse desde el CDN de
Google.

## Cómo se dejó el entorno

La base de datos se reinició a su estado limpio (`migrate` + `seed`, sin los
turnos de prueba) antes de entregar, para que la primera prueba de quien
reciba esto empiece desde cero.

## Conclusión

El backend, hasta donde se pudo probar aquí, funciona como se diseñó: la
base de datos, la API y la sincronización en tiempo real responden
correctamente en un recorrido real de principio a fin. Sigue siendo
recomendable que TI lo pruebe también en la infraestructura real de
COOPELESCA antes de producción (redes, dominios, certificados, volumen),
pero el riesgo de "el código no funciona" que señalaba el README anterior
queda bastante despejado con esta prueba.
