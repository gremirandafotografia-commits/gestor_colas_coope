-- ============================================================================
-- COOPELESCA R.L. — Sistema de Gestión de Filas
-- Esquema de base de datos (PostgreSQL 13+)
--
-- Traduce a tablas la misma lógica que ya está probada en el prototipo
-- COOPELESCA_Filas_Demo.html: sucursales, puestos, trámites, turnos,
-- pausas, encuestas, usuarios y configuración.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- SUCURSALES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sucursales (
  id            TEXT PRIMARY KEY,        -- ej. 'urb', 'pit' (se conservan los ids del prototipo)
  nombre        TEXT NOT NULL,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TRÁMITES (catálogo global, no por sucursal)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tramites (
  id            TEXT PRIMARY KEY,        -- ej. 'E','I','T','P','C','FM' (letra = id)
  letra         TEXT NOT NULL,
  nombre        TEXT NOT NULL,
  icono         TEXT NOT NULL DEFAULT 'ayuda'
);

-- ---------------------------------------------------------------------------
-- PUESTOS (ventanillas y cajas de cada sucursal)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS puestos (
  id                      TEXT PRIMARY KEY,   -- ej. 'urb-v1', 'urb-c1'
  sucursal_id             TEXT NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  nombre                  TEXT NOT NULL,
  tipo                    TEXT NOT NULL CHECK (tipo IN ('ventanilla','caja')),
  area                    TEXT NOT NULL CHECK (area IN ('tramites','pagos')),
  prioridad_preferencial  BOOLEAN NOT NULL DEFAULT false,
  apoya_pagos             BOOLEAN NOT NULL DEFAULT false,
  activo                  BOOLEAN NOT NULL DEFAULT true
);

-- Qué trámites atiende cada puesto (relación muchos-a-muchos)
CREATE TABLE IF NOT EXISTS puesto_tramites (
  puesto_id     TEXT NOT NULL REFERENCES puestos(id) ON DELETE CASCADE,
  tramite_id    TEXT NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
  PRIMARY KEY (puesto_id, tramite_id)
);

-- ---------------------------------------------------------------------------
-- USUARIOS (personal que ingresa al sistema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  correo        TEXT PRIMARY KEY,        -- correo institucional completo
  nombre        TEXT,
  rol           TEXT NOT NULL CHECK (rol IN ('admin','operador')),
  hash          TEXT,                    -- hash bcrypt; NULL mientras esté en clave temporal
  temporal      BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- CONTADORES (numeración de folios por sucursal+trámite, y el consecutivo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contadores (
  clave         TEXT PRIMARY KEY,        -- ej. 'urb-E', 'urb-PRE'
  valor         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS consecutivo (
  -- Fila única (id fijo) — el consecutivo es global, 1 a 10000, sin histórico.
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  valor         INTEGER NOT NULL DEFAULT 0
);
INSERT INTO consecutivo (id, valor) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- TURNOS (el corazón del sistema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turnos (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  folio             TEXT NOT NULL,
  consecutivo       INTEGER NOT NULL,
  sucursal_id       TEXT NOT NULL REFERENCES sucursales(id),
  tramite_id        TEXT NOT NULL REFERENCES tramites(id),
  tramite_nombre    TEXT NOT NULL,        -- copia al momento de emitir (histórico estable)
  preferencial      BOOLEAN NOT NULL DEFAULT false,
  cedula            TEXT,                 -- uso interno; nunca se expone en pantallas públicas
  nombre            TEXT,                 -- uso interno; nunca se expone en pantallas públicas
  estado            TEXT NOT NULL DEFAULT 'esperando'
                      CHECK (estado IN ('esperando','llamando','atendiendo','finalizado','ausente')),
  llamados          SMALLINT NOT NULL DEFAULT 0,
  puesto_id         TEXT REFERENCES puestos(id),
  puesto_nombre     TEXT,
  desborde          BOOLEAN NOT NULL DEFAULT false,
  seccion_id        TEXT,                 -- 'pagos' | 'tramites' | 'cobros' (si fue derivada)
  seccion_nombre    TEXT,
  atendido_por      TEXT REFERENCES usuarios(correo),
  hora_creado       TIMESTAMPTZ NOT NULL DEFAULT now(),
  hora_llamado      TIMESTAMPTZ,
  hora_atencion     TIMESTAMPTZ,
  hora_finalizado   TIMESTAMPTZ,
  powerbi_enviado_en TIMESTAMPTZ           -- NULL = todavía no se mandó a Power BI (ver src/lib/powerbi.js)
);
CREATE INDEX IF NOT EXISTS idx_turnos_sucursal_estado ON turnos (sucursal_id, estado);
CREATE INDEX IF NOT EXISTS idx_turnos_puesto ON turnos (puesto_id);
CREATE INDEX IF NOT EXISTS idx_turnos_hora_creado ON turnos (hora_creado);
-- La tabla ya existía en despliegues anteriores sin esta columna.
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS powerbi_enviado_en TIMESTAMPTZ;
-- Idioma en el que el asociado eligió su trámite en el kiosco ('es' o 'en'):
-- viaja con el turno para que la sala y la encuesta de satisfacción de ESE
-- turno en particular puedan seguir en inglés, sin afectar a nadie más en
-- la sala ni cambiar el idioma del kiosco para el siguiente asociado.
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS idioma TEXT NOT NULL DEFAULT 'es';

-- Puesto con personal capacitado para atender en inglés: las fichas tomadas
-- en inglés se reservan para estos puestos mientras alguno esté libre —
-- misma mecánica que prioridad_preferencial (Ley 7600), ver colas.js.
ALTER TABLE puestos ADD COLUMN IF NOT EXISTS atiende_ingles BOOLEAN NOT NULL DEFAULT false;
-- Acelera la consulta "turnos cerrados sin enviar" que corre el envío
-- periódico a Power BI cada pocos minutos.
CREATE INDEX IF NOT EXISTS idx_turnos_powerbi_pendiente ON turnos (estado) WHERE powerbi_enviado_en IS NULL;

-- Historial de derivaciones (una ficha puede derivarse más de una vez)
CREATE TABLE IF NOT EXISTS derivaciones (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  turno_id      UUID NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  desde_puesto  TEXT,
  hacia_seccion TEXT,
  hora          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- PAUSAS (detención de atención por puesto)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pausas_activas (
  puesto_id     TEXT PRIMARY KEY REFERENCES puestos(id) ON DELETE CASCADE,
  causal        TEXT NOT NULL,
  desde         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pausas_historial (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  puesto_id     TEXT NOT NULL,
  puesto_nombre TEXT,
  sucursal_id   TEXT,
  causal        TEXT NOT NULL,
  desde         TIMESTAMPTZ NOT NULL,
  hasta         TIMESTAMPTZ NOT NULL,
  segundos      INTEGER NOT NULL
);
-- Igual que anuncios.destino: la tabla ya existía en despliegues
-- anteriores sin esta columna (el prototipo la esperaba para filtrar el
-- Resumen por sucursal, pero nunca se agregó al esquema original).
ALTER TABLE pausas_historial ADD COLUMN IF NOT EXISTS sucursal_id TEXT;

-- ---------------------------------------------------------------------------
-- ENCUESTAS DE SATISFACCIÓN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS encuesta_preguntas (
  id            TEXT PRIMARY KEY,
  texto         TEXT NOT NULL,
  orden         SMALLINT NOT NULL DEFAULT 0
);
-- Traducción opcional al inglés de cada pregunta: si el turno que motivó la
-- encuesta se tomó en inglés en el kiosco, se muestra esta versión en vez de
-- traducir "texto" automáticamente (no hay motor de traducción real en el
-- sistema). Si Administración la deja vacía, la encuesta sigue en español
-- para ese turno en esa sola pregunta — nunca se cae en blanco.
ALTER TABLE encuesta_preguntas ADD COLUMN IF NOT EXISTS texto_en TEXT;

CREATE TABLE IF NOT EXISTS encuesta_canales (
  nombre        TEXT PRIMARY KEY          -- canales remotos: 'WhatsApp', 'Sitio web', etc.
);

CREATE TABLE IF NOT EXISTS encuesta_respuestas (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sucursal_id   TEXT REFERENCES sucursales(id),
  puesto_id     TEXT,                     -- puede ser NULL si vino de un canal remoto
  plataforma    TEXT NOT NULL,            -- nombre del puesto o del canal
  turno_id      UUID REFERENCES turnos(id),
  turno_folio   TEXT,
  tramite_nombre TEXT,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un turno solo puede tener una encuesta: evita respuestas duplicadas por un
-- doble envío o un reintento tras un corte de red, que inflarían el conteo
-- de encuestas y la calificación promedio de ese turno en Reportes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_encuesta_respuestas_turno
  ON encuesta_respuestas (turno_id) WHERE turno_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS encuesta_respuesta_detalle (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  respuesta_id    UUID NOT NULL REFERENCES encuesta_respuestas(id) ON DELETE CASCADE,
  pregunta_id     TEXT NOT NULL,
  pregunta_texto  TEXT NOT NULL,          -- copia al momento de responder
  valor           SMALLINT NOT NULL CHECK (valor BETWEEN 1 AND 5)
);

-- ---------------------------------------------------------------------------
-- CONFIGURACIÓN (fila única, igual que el objeto config del prototipo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  logo_url              TEXT NOT NULL DEFAULT '',
  pin_salida            TEXT NOT NULL DEFAULT '1234',
  voz_nombre            TEXT NOT NULL DEFAULT '',
  voz_activa            BOOLEAN NOT NULL DEFAULT true,
  -- Velocidad y tono de la voz (perfiles elegibles desde Administración;
  -- el navegador no permite instalar voces nuevas, pero variar rate/pitch
  -- de la misma voz da variedad real — ver PERFILES_VOZ en el prototipo):
  voz_velocidad         REAL NOT NULL DEFAULT .94,
  voz_tono              REAL NOT NULL DEFAULT 1.04,
  -- Tono de notificación que suena antes de la voz al llamar una ficha:
  tono_activo           BOOLEAN NOT NULL DEFAULT true,
  tono_id               TEXT NOT NULL DEFAULT 'suave',
  -- Nombre de la impresora que el equipo debe usar como predeterminada del
  -- sistema operativo para imprimir sin ventana de diálogo (modo kiosco del
  -- navegador, --kiosk-printing). Es solo informativo/de referencia dentro
  -- de esta pantalla: la impresora real la define Windows, no esta app.
  impresora_designada   TEXT NOT NULL DEFAULT '',
  desborde_activo       BOOLEAN NOT NULL DEFAULT true,
  desborde_umbral_fichas   INTEGER NOT NULL DEFAULT 5,
  desborde_umbral_minutos INTEGER NOT NULL DEFAULT 10,
  -- Conexión con el padrón real de asociados de COOPELESCA:
  padron_url            TEXT NOT NULL DEFAULT '',
  padron_token          TEXT NOT NULL DEFAULT '',
  -- Integraciones de reportes con sistemas externos (Power BI, Salesforce):
  -- solo guardan la dirección/credencial para cuando Informática las tenga
  -- listas — el envío automático de datos no está implementado todavía.
  powerbi_url           TEXT NOT NULL DEFAULT '',
  powerbi_token         TEXT NOT NULL DEFAULT '',
  salesforce_url        TEXT NOT NULL DEFAULT '',
  salesforce_token      TEXT NOT NULL DEFAULT ''
);
INSERT INTO configuracion (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
-- La tabla ya existía en despliegues anteriores sin estas columnas —
-- CREATE TABLE IF NOT EXISTS de arriba no las añade a una tabla ya creada.
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS powerbi_url TEXT NOT NULL DEFAULT '';
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS powerbi_token TEXT NOT NULL DEFAULT '';
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS salesforce_url TEXT NOT NULL DEFAULT '';
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS salesforce_token TEXT NOT NULL DEFAULT '';
ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS impresora_designada TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS anuncios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo          TEXT NOT NULL CHECK (tipo IN ('imagen','video')),
  src           TEXT NOT NULL,           -- ruta de red o URL (no se guarda el archivo en la base)
  nombre        TEXT,
  orden         SMALLINT NOT NULL DEFAULT 0,
  destino       TEXT NOT NULL DEFAULT 'ambos' CHECK (destino IN ('ambos','kiosco','sala'))
);
-- La tabla ya existía en despliegues anteriores sin esta columna (el
-- prototipo la agregó después) — CREATE TABLE IF NOT EXISTS de arriba no
-- la añade a una tabla ya creada, así que hace falta el ALTER explícito.
ALTER TABLE anuncios ADD COLUMN IF NOT EXISTS destino TEXT NOT NULL DEFAULT 'ambos';
