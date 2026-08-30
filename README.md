# Backend real — Sistema de Gestión de Filas de COOPELESCA R.L.

Este es el servidor que reemplaza el almacenamiento local del prototipo
`COOPELESCA_Filas_Demo.html` por una base de datos PostgreSQL real y
sincronización en vivo entre pantallas (Socket.io), para que el kiosco, la
sala, las ventanillas y las cajas compartan la misma fila sin importar en
cuántas computadoras distintas estén.

---

## ⚠️ Léase primero: qué es esto exactamente y qué falta

**Este backend NO fue probado en ejecución real.** El entorno donde se
escribió no tiene acceso a internet para instalar los paquetes de Node.js
(`express`, `pg`, `socket.io`, etc.) ni una instalación de PostgreSQL
disponible. Se validó de dos formas, ambas sin ejecutarlo:

1. **Sintaxis**: los 14 archivos JavaScript pasan `node --check` sin errores.
2. **Revisión manual columna por columna**: cada consulta SQL de cada ruta
   se comparó a mano contra las columnas reales definidas en `schema.sql`.
   En esa revisión se encontraron y corrigieron dos errores reales (una
   ruta con un parámetro sin usar, y un desajuste de nombres).

Esto da una base razonable, **pero no es lo mismo que haberlo visto
funcionar**. Antes de instalarlo en el servidor de producción, alguien de
Informática debe levantarlo (la vía más rápida es con Docker, ver abajo) y
probar al menos el recorrido completo de una ficha: crear usuario, iniciar
sesión, emitir un turno, llamarlo, atenderlo y cerrarlo.

**Segundo punto importante — esto todavía no está conectado con el HTML.**
El archivo `COOPELESCA_Filas_Demo.html` que ya tiene el usuario sigue
funcionando exactamente igual que antes: guardando todo en el navegador de
cada computadora. Este backend es el servidor al que ese HTML *debería*
hablarle en producción, pero **conectar uno con otro —cambiar el HTML para
que llame a esta API en vez de usar `localStorage`— es un trabajo aparte,
todavía pendiente.** Piense en este backend como los cimientos y la
estructura de la casa: sólidos y completos, pero sin las conexiones
eléctricas finales a los electrodomésticos.

---

## 1. Arquitectura

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   Kiosco    │     │  Ventanilla  │     │  Pantalla    │
│  (navegador)│     │  (navegador) │     │  de sala     │
└──────┬──────┘     └──────┬──────┘     └──────┬───────┘
       │   HTTPS (API REST) + WebSocket (Socket.io)     │
       └────────────────────┼──────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Backend Node.js  │   (este proyecto)
                    │  Express + Socket.io│
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   PostgreSQL      │
                    └───────────────────┘
```

- **Express** atiende las peticiones HTTP (emitir ficha, llamar, atender, etc.)
- **Socket.io** avisa a las pantallas conectadas cuando algo cambia, sin que
  tengan que estar preguntando constantemente
- **PostgreSQL** guarda todo de forma permanente y compartida

---

## 2. Cómo levantarlo (la vía rápida — con Docker)

Requiere tener [Docker](https://www.docker.com/) instalado. No necesita
instalar Node.js ni PostgreSQL por separado.

```bash
cd coopelesca-backend
docker compose up -d

# Solo la primera vez (o después de cambios al esquema): cree las tablas
# y cargue los datos iniciales. Estos pasos son idempotentes, pero son
# parte del despliegue, no del arranque — no se repiten en cada
# `docker compose up`/reinicio del contenedor.
docker compose run --rm backend node scripts/migrate.js
docker compose run --rm backend node scripts/seed.js
```

Eso levanta la base de datos y el servidor. Después de correr las
migraciones y la carga inicial una sola vez (sucursales, puestos,
trámites), el backend queda escuchando en `http://localhost:4000`.

Pruébelo:
```bash
curl http://localhost:4000/salud
# {"ok":true,"hora":"..."}
```

**Antes de usarlo en serio**, cambie las contraseñas de ejemplo en
`docker-compose.yml` (`POSTGRES_PASSWORD`, `JWT_SECRET`).

## 3. Cómo levantarlo manualmente (sin Docker)

Requiere Node.js 18 o superior y un servidor PostgreSQL 13+ ya instalado.

```bash
cd coopelesca-backend
npm install
cp .env.example .env
# Edite .env con los datos reales de su base de datos

node scripts/migrate.js   # crea las tablas (idempotente: si ya existen, no falla)
node scripts/seed.js      # carga sucursales, puestos, trámites y el admin

npm start                 # arranca el servidor
```

**Importante:** `scripts/migrate.js` y `scripts/seed.js` son pasos de
despliegue, no parte del arranque del servidor — `npm start` (y el `CMD`
del `Dockerfile`) solo levanta `src/server.js`. Ejecute las migraciones una
vez, antes de desplegar o de reiniciar el servicio, no en cada arranque.

## 4. Primer ingreso

```
Correo:   admin@coopelesca.co.cr
Contraseña temporal: coopelesca
```

El primer inicio de sesión exige definir una contraseña propia (mínimo 8
caracteres) — igual que en el prototipo.

---

## 5. Referencia de la API

Todas las rutas (salvo `/api/auth/login` y `/api/auth/definir-clave`)
requieren el encabezado `Authorization: Bearer <token>` que devuelve el
inicio de sesión.

### Autenticación
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/auth/login` | Inicia sesión. Si la cuenta está en clave temporal, devuelve `{primerIngreso:true}` en vez de un token. |
| POST | `/api/auth/definir-clave` | Define la contraseña propia en el primer ingreso. |
| GET | `/api/auth/usuarios` | Lista de usuarios (solo administradores). |
| POST | `/api/auth/usuarios` | Crea un usuario nuevo con clave temporal. |
| PATCH | `/api/auth/usuarios/:correo/rol` | Cambia el rol de un usuario. |
| POST | `/api/auth/usuarios/:correo/restablecer` | Devuelve la cuenta a clave temporal. |
| DELETE | `/api/auth/usuarios/:correo` | Elimina un usuario. |

### Catálogo (sucursales, trámites, puestos)
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/sucursales` | Lista de sucursales. |
| GET | `/api/tramites` | Lista de trámites. |
| GET | `/api/sucursales/:id/puestos` | Puestos de una sucursal, con sus trámites. |
| PATCH | `/api/puestos/:id` | Cambia activo, prioridad Ley 7600, apoya pagos, o la lista de trámites. |

*(POST/DELETE de sucursales, trámites y puestos también disponibles — ver `src/routes/catalogo.js`)*

### Turnos (el ciclo de vida de una ficha)
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/turnos` | Emite una ficha nueva. Devuelve el folio y el consecutivo de inmediato; si hay cédula y padrón configurado, el nombre llega después por WebSocket. |
| GET | `/api/sucursales/:id/cola/:puestoId` | Fichas que ESE puesto puede atender ahora (para el panel del operador). |
| GET | `/api/sucursales/:id/sala?area=tramites\|pagos` | Lo único que debe verse en la pantalla pública: turno llamado + últimos 4. Nunca la cola pendiente. |
| POST | `/api/turnos/llamar` | Llama la siguiente ficha (o una específica por folio/consecutivo). |
| POST | `/api/turnos/:id/reanunciar` | Repite el llamado (máx. 3 veces). |
| POST | `/api/turnos/:id/iniciar` | Marca que el asociado llegó. |
| POST | `/api/turnos/:id/finalizar` | Cierra el turno como atendido. |
| POST | `/api/turnos/:id/ausente` | Marca que no se presentó. |
| POST | `/api/turnos/:id/retornar` | Devuelve la ficha a la cola. |
| POST | `/api/turnos/:id/derivar` | Deriva a Pagos, Trámites o Gestión de Cobros (esta última cierra el turno). |
| POST | `/api/puestos/:id/pausar` | Detiene la atención (con causal). |
| POST | `/api/puestos/:id/reanudar` | Reanuda y archiva la duración de la pausa. |

### Encuestas
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/encuestas/preguntas` | Preguntas activas. |
| GET | `/api/sucursales/:id/turno-en-atencion/:puestoId` | La tableta consulta esto antes de habilitarse — solo responde algo si hay un turno EN ATENCIÓN ahora mismo en ese puesto. |
| POST | `/api/encuestas/respuestas` | Registra las respuestas de una encuesta. |

### Reportes y configuración
| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/reportes/metricas?desde=&hasta=&plataforma=` | Todas las métricas del dashboard y los reportes, en un solo lugar. |
| GET | `/api/config` | Configuración pública (logo, PIN, voz, desborde). |
| PATCH | `/api/config` | Modifica la configuración (solo administradores). |
| POST | `/api/config/probar-padron` | Prueba la conexión con el padrón real de COOPELESCA. |

### Tiempo real (Socket.io)
Cada pantalla debe conectarse y unirse a la sala de su sucursal:
```js
const socket = io('https://su-servidor.coopelesca.com');
socket.emit('unirse', 'urb'); // el id de la sucursal
socket.on('cambio', ({ tipo }) => {
  // volver a pedir los datos que le interesan a esta pantalla
});
```

---

## 6. Diferencias a propósito con el prototipo HTML

## 6.1 Historial de sincronización con el prototipo

El HTML (`COOPELESCA_Filas_Demo.html`) siguió recibiendo correcciones después
de que este backend se armó por primera vez. Esta sección deja constancia de
cuándo se puso al día, para que quien lo retome sepa qué tan reciente es.

**Última sincronización:** se revisó línea por línea contra el estado final
del HTML y se corrigieron 5 desajustes reales que habían quedado desde la
entrega original:

1. **Prefijo de fichas preferenciales**: el backend generaba `PRE-001`; el
   HTML final usa `PREF-001` (con la F). Corregido en `src/lib/folio.js`.
2. **Tope del contador por trámite**: el backend reiniciaba en 100; el HTML
   final llega hasta 999. Corregido en `src/lib/folio.js`.
3. **Rellamado manual**: el backend aceptaba folio completo (`E-045`) o
   número de rellamado; el HTML final simplificó esto a **solo el número**
   (sin letras), para que el personal no tenga que digitar nada más que lo
   impreso en la ficha. Corregido en `POST /api/turnos/llamar` (el campo
   pasó de `folioManual` a `numeroRellamado`, ya no acepta folios).
4. **Validación de derivaciones**: se agregó, del lado del servidor, la
   misma validación que corrigió un bug real en el prototipo — un trámite
   ofrecido para "Pagos" que en realidad enruta a "Trámites" (o viceversa)
   ahora se rechaza con un error claro, en vez de dejar la ficha mal
   enrutada sin que nadie lo note.
5. **Configuración de tono y voz**: el HTML agregó, en rondas posteriores,
   un tono de notificación configurable y perfiles de velocidad/tono de
   voz — ninguno de los dos existía en el esquema original de este
   backend. Se agregaron las columnas `tono_activo`, `tono_id`,
   `voz_velocidad` y `voz_tono` a la tabla `configuracion`, expuestas por
   `GET /api/config` y modificables por `PATCH /api/config`.

**Lo que NO se revisó en esta pasada** (por no tener forma de ejecutar el
backend en el entorno donde se hizo esta revisión — ver aviso al inicio de
este documento): no se probó ninguna de estas rutas contra una base de
datos real después de los cambios. La corrección se hizo por lectura
cuidadosa del código, comparando contra la lógica ya probada del HTML, de
la misma forma que la primera entrega. Sigue siendo necesario que alguien
lo levante y lo pruebe de verdad antes de confiar en él para producción.

| Tema | Prototipo (HTML) | Backend real |
|---|---|---|
| Dónde vive la fila | En cada navegador (`localStorage`) | En PostgreSQL, compartida por todos |
| Cómo se enteran las pantallas de un cambio | Sondeo cada 2,5 s + evento `storage` | Aviso instantáneo por WebSocket |
| Contraseñas | Huella simple (FNV), documentada como no-segura | `bcrypt`, estándar de la industria |
| Números de folio con varios kioscos a la vez | No aplica (un solo navegador) | Bloqueo de fila en la base de datos (`SELECT … FOR UPDATE`) para que dos kioscos nunca repitan folio |
| Sesión | Se guarda en `sessionStorage` del navegador | Token firmado (JWT), expira en 10 horas |
| Desborde de pagos | Se marca si el trámite es exactamente "Pagos" | Se marca si el trámite no es nativo del puesto (más general, sigue funcionando si se agregan más trámites de pagos a futuro) |

---

## 7. Seguridad antes de producción

- Cambie `JWT_SECRET` y las contraseñas de PostgreSQL de los archivos de ejemplo.
- Sirva el backend detrás de HTTPS (un proxy inverso como Nginx o Caddy, con certificado válido).
- Restrinja `CORS_ORIGENES` a los dominios reales de las pantallas — nunca deje `*` en producción.
- El campo `padron_token` se guarda en texto plano en la base de datos; si su política de seguridad lo exige, cífrelo en reposo o muévalo a un gestor de secretos.
- Considere un límite de intentos de inicio de sesión (`express-rate-limit`) para frenar fuerza bruta contra `/api/auth/login`.

---

## 8. Qué sigue

1. **Probar este backend de verdad** (ver sección 2) y corregir lo que aparezca.
2. **Conectar el HTML del prototipo a esta API** — es el trabajo más grande que falta: cambiar cada función que hoy lee/escribe `localStorage` para que llame a estos endpoints, y agregar el cliente de Socket.io. Con gusto lo hago en la próxima ronda si lo desea.
3. Definir dónde vive el servidor (nube o infraestructura propia de COOPELESCA) y quién administra los respaldos de la base de datos.
