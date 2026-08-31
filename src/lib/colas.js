/**
 * Lógica de colas, prioridad preferencial y desborde de pagos.
 *
 * Esta es la MISMA lógica que ya está probada en COOPELESCA_Filas_Demo.html
 * (funciones areaDeTramite, colaPuesto, pagosSaturados, tramitesHabilitados),
 * trasladada aquí para que el backend decida exactamente igual que el
 * prototipo qué ficha le corresponde a cada puesto. Si en el futuro se
 * ajustan estas reglas, hágalo en los dos lugares o retire el prototipo.
 */
const { query } = require('../db');

/** Puestos activos de una sucursal, con sus trámites habilitados. */
async function puestosDeSucursal(sucursalId) {
  const { rows: puestos } = await query(
    `SELECT * FROM puestos WHERE sucursal_id = $1 AND activo = true ORDER BY id`,
    [sucursalId]
  );
  const { rows: rel } = await query(
    `SELECT pt.puesto_id, pt.tramite_id FROM puesto_tramites pt
     JOIN puestos p ON p.id = pt.puesto_id WHERE p.sucursal_id = $1`,
    [sucursalId]
  );
  const tramitesPorPuesto = {};
  rel.forEach((r) => {
    (tramitesPorPuesto[r.puesto_id] ||= []).push(r.tramite_id);
  });
  return puestos.map((p) => ({ ...p, tramites: tramitesPorPuesto[p.id] || [] }));
}

/** ¿A qué área (trámites o pagos) pertenece un trámite en esta sucursal? Se
 *  determina por dónde esté asignado de forma NATIVA (sin contar el
 *  desborde), igual que en el prototipo. */
async function areaDeTramite(sucursalId, tramiteId) {
  const { rows } = await query(
    `SELECT 1 FROM puesto_tramites pt
     JOIN puestos p ON p.id = pt.puesto_id
     WHERE p.sucursal_id = $1 AND p.area = 'pagos' AND pt.tramite_id = $2 LIMIT 1`,
    [sucursalId, tramiteId]
  );
  return rows.length ? 'pagos' : 'tramites';
}

/** Turnos en espera de una sucursal, ordenados: preferenciales primero,
 *  luego por antigüedad — igual que el prototipo. */
async function colaSucursal(sucursalId) {
  const { rows } = await query(
    `SELECT * FROM turnos WHERE sucursal_id = $1 AND estado = 'esperando'
     ORDER BY preferencial DESC, hora_creado ASC`,
    [sucursalId]
  );
  return rows;
}

/** ¿Está saturada el área de pagos? Por cantidad de fichas en espera o por
 *  el tiempo de espera de la más antigua — umbrales configurables. */
async function pagosSaturados(sucursalId) {
  const { rows: cfgRows } = await query('SELECT * FROM configuracion WHERE id = 1');
  const cfg = cfgRows[0];
  if (!cfg.desborde_activo) return false;

  const cola = await colaSucursal(sucursalId);
  const pagos = [];
  for (const t of cola) {
    if ((await areaDeTramite(sucursalId, t.tramite_id)) === 'pagos') pagos.push(t);
  }
  if (!pagos.length) return false;
  const esperaMaxMin = Math.max(
    ...pagos.map((t) => (Date.now() - new Date(t.hora_creado).getTime()) / 60000)
  );
  return pagos.length >= cfg.desborde_umbral_fichas || esperaMaxMin >= cfg.desborde_umbral_minutos;
}

/** Trámites que un puesto puede atender ahora mismo, incluido el desborde
 *  de pagos si aplica. */
async function tramitesHabilitados(sucursalId, puesto) {
  const permitidos = new Set(puesto.tramites);
  if (puesto.apoya_pagos && puesto.area === 'tramites' && (await pagosSaturados(sucursalId))) {
    const { rows } = await query(
      `SELECT DISTINCT tramite_id FROM puesto_tramites pt
       JOIN puestos p ON p.id = pt.puesto_id
       WHERE p.sucursal_id = $1 AND p.area = 'pagos'`,
      [sucursalId]
    );
    rows.forEach((r) => permitidos.add(r.tramite_id));
  }
  return permitidos;
}

/** ¿Tiene el puesto un turno activo (llamando o atendiendo) en este momento? */
async function puestoOcupado(puestoId) {
  const { rows } = await query(
    `SELECT 1 FROM turnos WHERE puesto_id = $1 AND estado IN ('llamando','atendiendo') LIMIT 1`,
    [puestoId]
  );
  return rows.length > 0;
}

async function puestoEnPausa(puestoId) {
  const { rows } = await query('SELECT 1 FROM pausas_activas WHERE puesto_id = $1', [puestoId]);
  return rows.length > 0;
}

async function puestoDisponible(puesto) {
  return !(await puestoEnPausa(puesto.id)) && !(await puestoOcupado(puesto.id));
}

/** Cola de fichas que un puesto concreto puede atender, ya filtrada y en
 *  orden. Aplica la reserva de preferenciales: si el puesto NO tiene
 *  prioridad Ley 7600, cede las fichas preferenciales mientras el puesto
 *  prioritario de su misma área esté libre — pero solo esas fichas, nunca
 *  deja de atender las normales. La misma reserva aplica para las fichas
 *  tomadas en inglés (turnos.idioma = 'en'): un puesto sin atiende_ingles
 *  las cede mientras haya un puesto con esa marca libre en su área, para
 *  que las atienda el compañero capacitado — pero si ninguno está libre,
 *  cualquier puesto puede tomarlas igual (nunca se dejan sin atender). */
async function colaPuesto(sucursalId, puesto) {
  const permitidos = await tramitesHabilitados(sucursalId, puesto);
  const cola = await colaSucursal(sucursalId);
  let filtrada = cola.filter((t) => permitidos.has(t.tramite_id));
  const todos = await puestosDeSucursal(sucursalId);

  if (!puesto.prioridad_preferencial) {
    const prioritario = todos.find((p) => p.prioridad_preferencial && p.area === puesto.area);
    if (prioritario && (await puestoDisponible(prioritario))) {
      filtrada = filtrada.filter((t) => !t.preferencial);
    }
  }
  if (!puesto.atiende_ingles) {
    const capacitado = todos.find((p) => p.atiende_ingles && p.area === puesto.area);
    if (capacitado && (await puestoDisponible(capacitado))) {
      filtrada = filtrada.filter((t) => t.idioma !== 'en');
    }
  }
  return filtrada;
}

module.exports = {
  puestosDeSucursal,
  areaDeTramite,
  colaSucursal,
  pagosSaturados,
  tramitesHabilitados,
  puestoOcupado,
  puestoEnPausa,
  puestoDisponible,
  colaPuesto,
};
