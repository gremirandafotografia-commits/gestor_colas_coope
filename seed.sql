-- ============================================================================
-- Datos iniciales — reproduce los valores por defecto del prototipo
-- COOPELESCA_Filas_Demo.html, para que el comportamiento sea idéntico desde
-- el primer arranque. Ajuste libremente antes de poner en producción.
-- ============================================================================

INSERT INTO sucursales (id, nombre) VALUES
  ('urb', 'Edificio Urbano'),
  ('pit', 'Sucursal Pital');

INSERT INTO tramites (id, letra, nombre, icono) VALUES
  ('E',  'E',  'Electricidad', 'rayo'),
  ('I',  'I',  'Internet',     'wifi'),
  ('T',  'T',  'Televisión',   'tv'),
  ('P',  'P',  'Pagos',        'tarjeta'),
  ('C',  'C',  'Consultas',    'ayuda'),
  ('FM', 'FM', 'Fondo Mutual', 'vela');

-- Edificio Urbano: 7 ventanillas + 2 cajas
INSERT INTO puestos (id, sucursal_id, nombre, tipo, area, prioridad_preferencial, apoya_pagos) VALUES
  ('urb-v1', 'urb', 'Ventanilla 1', 'ventanilla', 'tramites', true,  true),
  ('urb-v2', 'urb', 'Ventanilla 2', 'ventanilla', 'tramites', false, true),
  ('urb-v3', 'urb', 'Ventanilla 3', 'ventanilla', 'tramites', false, true),
  ('urb-v4', 'urb', 'Ventanilla 4', 'ventanilla', 'tramites', false, true),
  ('urb-v5', 'urb', 'Ventanilla 5', 'ventanilla', 'tramites', false, true),
  ('urb-v6', 'urb', 'Ventanilla 6', 'ventanilla', 'tramites', false, true),
  ('urb-v7', 'urb', 'Ventanilla 7', 'ventanilla', 'tramites', false, true),
  ('urb-c1', 'urb', 'Caja 1',       'caja',       'pagos',    true,  false),
  ('urb-c2', 'urb', 'Caja 2',       'caja',       'pagos',    false, false);

-- Sucursal Pital: 2 ventanillas + 1 caja
INSERT INTO puestos (id, sucursal_id, nombre, tipo, area, prioridad_preferencial, apoya_pagos) VALUES
  ('pit-v1', 'pit', 'Ventanilla 1', 'ventanilla', 'tramites', true,  true),
  ('pit-v2', 'pit', 'Ventanilla 2', 'ventanilla', 'tramites', false, true),
  ('pit-c1', 'pit', 'Caja 1',       'caja',       'pagos',    true,  false);

-- Las ventanillas atienden Electricidad, Internet, Televisión, Consultas y Fondo Mutual
INSERT INTO puesto_tramites (puesto_id, tramite_id)
SELECT p.id, t.id
FROM puestos p, tramites t
WHERE p.tipo = 'ventanilla' AND t.id IN ('E','I','T','C','FM');

-- Las cajas solo atienden Pagos
INSERT INTO puesto_tramites (puesto_id, tramite_id)
SELECT p.id, 'P'
FROM puestos p
WHERE p.tipo = 'caja';

-- Preguntas de encuesta por defecto
INSERT INTO encuesta_preguntas (id, texto, orden) VALUES
  ('p1', '¿Qué tan satisfecho está con el tiempo de espera?', 1),
  ('p2', '¿Cómo califica la atención recibida?', 2);

-- Usuario administrador inicial — cambie esta contraseña temporal apenas
-- pueda entrar (el sistema lo obliga a definir una propia en el primer
-- ingreso, igual que en el prototipo).
INSERT INTO usuarios (correo, nombre, rol, hash, temporal) VALUES
  ('admin@coopelesca.co.cr', 'Administrador del sistema', 'admin', NULL, true);
