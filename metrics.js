/**
 * Datos crudos para el Resumen y los Reportes de Administración.
 *
 * A diferencia de una API que agregara las métricas del lado del servidor,
 * aquí se devuelven los turnos, derivaciones y respuestas de encuesta tal
 * cual —solo dando forma a lo que ya vive en la base de datos—, porque el
 * cálculo de verdad (porTramite, porDia, tendencias, cumplimiento del
 * estándar de espera, encuestas sin responder, etc.) ya está escrito y
 * probado en el propio prototipo (calcularMetricas()/analizar() en
 * COOPELESCA_Filas_Demo.html). Duplicar esa lógica aquí en SQL sería
 * mantener las mismas reglas en dos lugares sin necesidad: el navegador ya
 * sabe hacerlo, solo necesitaba datos reales en vez de los de demostración.
 */
const { query } = require('../db');

async function calcularMetricas({ desde, hasta, plataforma } = {}) {
  const condiciones = ['1=1'];
  const valores = [];
  let i = 1;
  if (desde) { condiciones.push(`t.hora_creado >= $${i++}`); valores.push(desde); }
  if (hasta) { condiciones.push(`t.hora_creado <= $${i++}`); valores.push(hasta); }
  if (plataforma) { condiciones.push(`t.puesto_nombre = $${i++}`); valores.push(plataforma); }
  const where = condiciones.join(' AND ');

  const { rows: turnos } = await query(`SELECT * FROM turnos t WHERE ${where} ORDER BY hora_creado`, valores);

  const idsTurnos = turnos.map((t) => t.id);
  let derivaciones = [];
  if (idsTurnos.length) {
    const { rows } = await query(
      `SELECT * FROM derivaciones WHERE turno_id = ANY($1::uuid[]) ORDER BY hora`,
      [idsTurnos]
    );
    derivaciones = rows;
  }

  const condEnc = ['1=1'];
  const valEnc = [];
  let j = 1;
  if (desde) { condEnc.push(`e.fecha >= $${j++}`); valEnc.push(desde); }
  if (hasta) { condEnc.push(`e.fecha <= $${j++}`); valEnc.push(hasta); }
  if (plataforma) { condEnc.push(`e.plataforma = $${j++}`); valEnc.push(plataforma); }
  const { rows: detalle } = await query(
    `SELECT e.id AS respuesta_id, e.sucursal_id, e.puesto_id, e.plataforma, e.turno_id, e.turno_folio,
            e.tramite_nombre, e.fecha, d.pregunta_texto, d.valor
     FROM encuesta_respuestas e
     JOIN encuesta_respuesta_detalle d ON d.respuesta_id = e.id
     WHERE ${condEnc.join(' AND ')}
     ORDER BY e.fecha`,
    valEnc
  );
  const encuestasPorId = {};
  detalle.forEach((r) => {
    encuestasPorId[r.respuesta_id] ||= {
      id: r.respuesta_id,
      sucursalId: r.sucursal_id,
      puestoId: r.puesto_id,
      plataforma: r.plataforma,
      turnoId: r.turno_id,
      turnoFolio: r.turno_folio,
      tramiteNombre: r.tramite_nombre,
      fecha: r.fecha,
      respuestas: [],
    };
    encuestasPorId[r.respuesta_id].respuestas.push({ texto: r.pregunta_texto, valor: r.valor });
  });

  return { turnos, derivaciones, encuestas: Object.values(encuestasPorId) };
}

module.exports = { calcularMetricas };
