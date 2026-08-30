const router = require('express').Router();
const { query } = require('../db');
const { exigirSesion } = require('../middleware/auth');
const colas = require('../lib/colas');
const { siguienteFolio } = require('../lib/folio');
const { avisarCambio } = require('../sockets');

const MAX_LLAMADOS = 3;

/** Consulta el padrón real de asociados de COOPELESCA (si está configurado)
 *  para traer el nombre a partir de la cédula. Nunca bloquea la emisión de
 *  la ficha: se llama en segundo plano y el nombre se completa después. */
async function consultarPadron(cedula) {
  const { rows } = await query('SELECT padron_url, padron_token FROM configuracion WHERE id = 1');
  const cfg = rows[0];
  if (!cfg.padron_url) return null;
  try {
    const controlador = new AbortController();
    const limite = setTimeout(() => controlador.abort(), 6000);
    const resp = await fetch(`${cfg.padron_url.replace(/\/$/, '')}/asociados/${encodeURIComponent(cedula)}`, {
      headers: cfg.padron_token ? { Authorization: `Bearer ${cfg.padron_token}` } : {},
      signal: controlador.signal,
    });
    clearTimeout(limite);
    if (!resp.ok) return null;
    const datos = await resp.json();
    return datos?.nombre || null;
  } catch (e) {
    console.error('No se pudo consultar el padrón de COOPELESCA', e.message);
    return null;
  }
}

/** GET /api/sucursales/:id/cola — fichas en espera (para el panel del
 *  operador y, con moderación, para depuración; la pantalla de sala NUNCA
 *  debe llamar a este endpoint desde el navegador — ver /api/sucursales/:id/sala). */
router.get('/sucursales/:id/cola', exigirSesion, async (req, res) => {
  res.json(await colas.colaSucursal(req.params.id));
});

/** GET /api/sucursales/:id/cola/:puestoId — lo que ESE puesto puede atender ahora. */
router.get('/sucursales/:id/cola/:puestoId', exigirSesion, async (req, res) => {
  const puestos = await colas.puestosDeSucursal(req.params.id);
  const puesto = puestos.find((p) => p.id === req.params.puestoId);
  if (!puesto) return res.status(404).json({ error: 'Puesto no encontrado.' });
  res.json(await colas.colaPuesto(req.params.id, puesto));
});

/** GET /api/sucursales/:id/sala?area=tramites|pagos — SOLO lo que debe verse
 *  en la pantalla pública: el turno llamado, los últimos 4, y nada de la
 *  cola pendiente (coherente con la privacidad del prototipo).
 *
 *  "Llamado" es el turno con la hora de llamado MÁS RECIENTE del área, sin
 *  importar su estado actual (llamando, atendiendo, finalizado, ausente o
 *  derivado) — debe seguir viéndose en el recuadro grande durante TODO el
 *  ciclo de atención, y solo se reemplaza cuando otra ficha del área recibe
 *  un llamado más nuevo. Filtrar solo por estado='llamando' (como antes)
 *  hacía que la ficha desapareciera de la pantalla pública apenas el
 *  funcionario hacía clic en «Iniciar atención». */
router.get('/sucursales/:id/sala', exigirSesion, async (req, res) => {
  const { id } = req.params;
  const area = req.query.area === 'pagos' ? 'pagos' : 'tramites';

  const { rows: llamando } = await query(
    `SELECT t.* FROM turnos t JOIN puestos p ON p.id = t.puesto_id
     WHERE t.sucursal_id = $1 AND t.hora_llamado IS NOT NULL AND p.area = $2
     ORDER BY t.hora_llamado DESC LIMIT 1`,
    [id, area]
  );
  const { rows: ultimos } = await query(
    `SELECT t.* FROM turnos t JOIN puestos p ON p.id = t.puesto_id
     WHERE t.sucursal_id = $1 AND t.hora_llamado IS NOT NULL AND p.area = $2
       AND t.id != COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000')
     ORDER BY t.hora_llamado DESC LIMIT 4`,
    [id, area, llamando[0]?.id || null]
  );
  res.json({ llamando: llamando[0] || null, ultimosLlamados: ultimos });
});

/** POST /api/turnos — emitir una ficha nueva (lo llama el kiosco). */
router.post('/turnos', exigirSesion, async (req, res) => {
  const { sucursalId, tramiteId, preferencial, cedula } = req.body;
  const { rows: tRows } = await query('SELECT * FROM tramites WHERE id = $1', [tramiteId]);
  const tramite = tRows[0];
  if (!tramite) return res.status(400).json({ error: 'Trámite no válido.' });

  const { folio, consecutivo } = await siguienteFolio(sucursalId, tramite, !!preferencial);

  const { rows } = await query(
    `INSERT INTO turnos (folio, consecutivo, sucursal_id, tramite_id, tramite_nombre, preferencial, cedula)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [folio, consecutivo, sucursalId, tramite.id, tramite.nombre, !!preferencial, cedula || null]
  );
  const turno = rows[0];
  avisarCambio(sucursalId, 'turno-nuevo');
  res.status(201).json(turno);

  // El nombre del asociado se completa DESPUÉS de responder — la ficha
  // nunca espera a la red, igual que en el prototipo.
  if (cedula) {
    consultarPadron(cedula).then(async (nombre) => {
      if (!nombre) return;
      await query('UPDATE turnos SET nombre = $1 WHERE id = $2', [nombre, turno.id]);
      avisarCambio(sucursalId, 'turno-actualizado');
    });
  }
});

/** POST /api/turnos/:id/cedula  { cedula }
 *  Le permite al funcionario de ventanilla registrar (o corregir) la
 *  cédula del asociado cuando no quedó capturada en el kiosco, para que
 *  el turno quede identificado en Resumen/Reportes igual que si hubiera
 *  pasado por ahí. Dispara la misma consulta al padrón que la emisión de
 *  la ficha, para completar el nombre en segundo plano. */
router.post('/turnos/:id/cedula', exigirSesion, async (req, res) => {
  const cedula = String(req.body.cedula || '').replace(/\D/g, '');
  if (cedula.length < 9) return res.status(400).json({ error: 'Digite la cédula completa (9 dígitos).' });

  const { rows } = await query('UPDATE turnos SET cedula = $1 WHERE id = $2 RETURNING *', [cedula, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Turno no encontrado.' });
  const turno = rows[0];
  avisarCambio(turno.sucursal_id, 'turno-actualizado');
  res.json(turno);

  consultarPadron(cedula).then(async (nombre) => {
    if (!nombre) return;
    await query('UPDATE turnos SET nombre = $1 WHERE id = $2', [nombre, turno.id]);
    avisarCambio(turno.sucursal_id, 'turno-actualizado');
  });
});

/** POST /api/turnos/llamar  { sucursalId, puestoId, numeroRellamado? }
 *  numeroRellamado es SOLO el número de rellamado (consecutivo, ej. 128) —
 *  la versión final del kiosco ya no admite el folio con letras aquí, para
 *  que el personal no tenga que digitar nada más que el número impreso. */
router.post('/turnos/llamar', exigirSesion, async (req, res) => {
  const { puestoId, numeroRellamado } = req.body;
  const puestos = await colas.puestosDeSucursal(req.body.sucursalId);
  const puesto = puestos.find((p) => p.id === puestoId);
  if (!puesto) return res.status(404).json({ error: 'Puesto no encontrado.' });
  if (await colas.puestoEnPausa(puesto.id)) return res.status(409).json({ error: 'El puesto está en pausa.' });
  if (await colas.puestoOcupado(puesto.id)) return res.status(409).json({ error: 'El puesto ya tiene una ficha activa.' });

  const cola = await colas.colaPuesto(req.body.sucursalId, puesto);
  let turno;
  if (numeroRellamado) {
    const numero = parseInt(String(numeroRellamado).replace(/\D/g, ''), 10);
    turno = cola.find((t) => !isNaN(numero) && t.consecutivo === numero);
  } else {
    turno = cola[0];
  }
  if (!turno) return res.status(404).json({ error: 'No hay una ficha así en la cola de este puesto.' });

  const { rows } = await query(
    `UPDATE turnos SET estado='llamando', llamados=1, puesto_id=$1, puesto_nombre=$2,
       desborde = (tramite_id != ALL($3::text[])), hora_llamado = now(), atendido_por = $4
     WHERE id = $5 RETURNING *`,
    [puesto.id, puesto.nombre, puesto.tramites, req.usuario.correo, turno.id]
  );
  avisarCambio(req.body.sucursalId, 'turno-llamado');
  res.json(rows[0]);
});

/** POST /api/turnos/:id/reanunciar — repite el llamado (máx. 3 veces). */
router.post('/turnos/:id/reanunciar', exigirSesion, async (req, res) => {
  const { rows } = await query('SELECT * FROM turnos WHERE id = $1', [req.params.id]);
  const t = rows[0];
  if (!t || t.estado !== 'llamando') return res.status(409).json({ error: 'Este turno no está en llamado.' });
  if (t.llamados >= MAX_LLAMADOS) return res.status(409).json({ error: 'Ya se alcanzó el máximo de llamados.' });

  const { rows: act } = await query(
    'UPDATE turnos SET llamados = llamados + 1, hora_llamado = now() WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  avisarCambio(t.sucursal_id, 'turno-llamado');
  res.json(act[0]);
});

/** POST /api/turnos/:id/iniciar — marca que el asociado llegó a la ventanilla. */
router.post('/turnos/:id/iniciar', exigirSesion, async (req, res) => {
  const { rows } = await query(
    `UPDATE turnos SET estado='atendiendo', hora_atencion=now()
     WHERE id=$1 AND estado='llamando' RETURNING *`,
    [req.params.id]
  );
  if (!rows.length) return res.status(409).json({ error: 'Este turno no está en llamado.' });
  avisarCambio(rows[0].sucursal_id, 'turno-atendiendo');
  res.json(rows[0]);
});

/** POST /api/turnos/:id/finalizar  { llamarSiguiente: bool, puestoId } */
router.post('/turnos/:id/finalizar', exigirSesion, async (req, res) => {
  const { rows } = await query(
    `UPDATE turnos SET estado='finalizado', hora_finalizado=now() WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Turno no encontrado.' });
  avisarCambio(rows[0].sucursal_id, 'turno-finalizado');
  res.json(rows[0]);
});

/** POST /api/turnos/:id/ausente — el asociado no se presentó. */
router.post('/turnos/:id/ausente', exigirSesion, async (req, res) => {
  const { rows } = await query(
    `UPDATE turnos SET estado='ausente', hora_finalizado=now() WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Turno no encontrado.' });
  avisarCambio(rows[0].sucursal_id, 'turno-finalizado');
  res.json(rows[0]);
});

/** POST /api/turnos/:id/retornar — vuelve a la cola conservando su lugar. */
router.post('/turnos/:id/retornar', exigirSesion, async (req, res) => {
  const { rows } = await query(
    `UPDATE turnos SET estado='esperando', llamados=0, puesto_id=NULL, puesto_nombre=NULL,
       hora_llamado=NULL, hora_atencion=NULL WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Turno no encontrado.' });
  avisarCambio(rows[0].sucursal_id, 'turno-actualizado');
  res.json(rows[0]);
});

/** POST /api/turnos/:id/derivar  { seccionId, tramiteId }
 *  «Gestión de Cobros» cierra el turno (no reencola); Pagos/Trámites lo
 *  regresan a la cola con el trámite indicado, conservando su prioridad y
 *  su hora de creación original. El trámite recibido se valida contra el
 *  ÁREA real de la sección destino — el prototipo tuvo un bug donde el
 *  cliente podía enviar un trámite que no correspondía al área elegida
 *  (ej. derivar "a Pagos" con un trámite que en realidad enruta a
 *  Trámites), y la ficha quedaba enrutada mal sin que nadie lo notara. Se
 *  valida aquí también, del lado del servidor, para que un cliente mal
 *  hecho no pueda reproducir el mismo problema. */
router.post('/turnos/:id/derivar', exigirSesion, async (req, res) => {
  const { seccionId, tramiteId } = req.body;
  const cierra = seccionId === 'cobros';

  const { rows: turnoActual } = await query('SELECT sucursal_id, puesto_nombre FROM turnos WHERE id = $1', [req.params.id]);
  if (!turnoActual.length) return res.status(404).json({ error: 'Turno no encontrado.' });
  const sucursalId = turnoActual[0].sucursal_id;
  const puestoDesde = turnoActual[0].puesto_nombre;

  let tramite = null;
  if (!cierra) {
    const { rows: tRows } = await query('SELECT * FROM tramites WHERE id = $1', [tramiteId]);
    tramite = tRows[0];
    if (!tramite) return res.status(400).json({ error: 'Trámite no válido para esa sección.' });
    const areaDestino = seccionId === 'pagos' ? 'pagos' : 'tramites';
    const areaReal = await colas.areaDeTramite(sucursalId, tramite.id);
    if (areaReal !== areaDestino) {
      return res.status(400).json({
        error: `El trámite «${tramite.nombre}» enruta al área de ${areaReal}, no a ${areaDestino}. Elija un trámite propio de esa sección.`,
      });
    }
  }

  const nombreSeccion = { pagos: 'Pagos', tramites: 'Trámites', cobros: 'Gestión de Cobros' }[seccionId];
  const { rows } = await query(
    cierra
      ? `UPDATE turnos SET estado='finalizado', hora_finalizado=now(),
           seccion_id=$1, seccion_nombre=$2 WHERE id=$3 RETURNING *`
      : `UPDATE turnos SET estado='esperando', llamados=0, puesto_id=NULL, puesto_nombre=NULL,
           desborde=false, hora_llamado=NULL, hora_atencion=NULL,
           seccion_id=$1, seccion_nombre=$2, tramite_id=$4, tramite_nombre=$5
         WHERE id=$3 RETURNING *`,
    cierra ? [seccionId, nombreSeccion, req.params.id] : [seccionId, nombreSeccion, req.params.id, tramite.id, tramite.nombre]
  );
  if (!rows.length) return res.status(404).json({ error: 'Turno no encontrado.' });

  await query(
    'INSERT INTO derivaciones (turno_id, desde_puesto, hacia_seccion) VALUES ($1,$2,$3)',
    [req.params.id, puestoDesde, nombreSeccion]
  );
  avisarCambio(rows[0].sucursal_id, 'turno-actualizado');
  res.json(rows[0]);
});

// ---------------------------------------------------------------------------
// Pausas (detener/reanudar atención)
// ---------------------------------------------------------------------------

/** POST /api/puestos/:id/pausar  { causal } */
router.post('/puestos/:id/pausar', exigirSesion, async (req, res) => {
  await query(
    `INSERT INTO pausas_activas (puesto_id, causal, desde) VALUES ($1,$2,now())
     ON CONFLICT (puesto_id) DO UPDATE SET causal = $2, desde = now()`,
    [req.params.id, req.body.causal]
  );
  res.json({ ok: true });
});

/** POST /api/puestos/:id/reanudar — cierra la pausa y la archiva con su duración. */
router.post('/puestos/:id/reanudar', exigirSesion, async (req, res) => {
  const { rows } = await query('SELECT * FROM pausas_activas WHERE puesto_id = $1', [req.params.id]);
  if (rows.length) {
    const p = rows[0];
    const { rows: puestoRows } = await query('SELECT nombre, sucursal_id FROM puestos WHERE id = $1', [req.params.id]);
    await query(
      `INSERT INTO pausas_historial (puesto_id, puesto_nombre, sucursal_id, causal, desde, hasta, segundos)
       VALUES ($1,$2,$3,$4,$5, now(), EXTRACT(EPOCH FROM (now() - $5)))`,
      [req.params.id, puestoRows[0]?.nombre, puestoRows[0]?.sucursal_id, p.causal, p.desde]
    );
    await query('DELETE FROM pausas_activas WHERE puesto_id = $1', [req.params.id]);
  }
  res.json({ ok: true });
});

/** GET /api/sucursales/:id/atendidos/:puestoId — últimas 4 fichas atendidas
 *  en ese puesto (lo único que ve el operador aparte de la ficha activa). */
router.get('/sucursales/:id/atendidos/:puestoId', exigirSesion, async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM turnos WHERE puesto_id = $1 AND hora_llamado IS NOT NULL
       AND estado IN ('finalizado','ausente')
     ORDER BY hora_llamado DESC LIMIT 4`,
    [req.params.puestoId]
  );
  res.json(rows);
});

/** GET /api/sucursales/:id/puestos/:puestoId/estado — resumen para el panel
 *  del operador al entrar o recargar la pantalla: ficha activa (llamando o
 *  atendiendo), pausa vigente, últimas 4 atendidas, y si el área de pagos
 *  está saturada (para el aviso de desborde antes de llamar). Sin esto, el
 *  panel solo sabría de la ficha activa a través de la respuesta de sus
 *  propias acciones (llamar/iniciar/...), y la perdería de vista en cada
 *  recarga de página aunque siguiera activa en la base de datos. */
router.get('/sucursales/:id/puestos/:puestoId/estado', exigirSesion, async (req, res) => {
  const { id, puestoId } = req.params;
  const { rows: activos } = await query(
    `SELECT * FROM turnos WHERE puesto_id = $1 AND estado IN ('llamando','atendiendo') LIMIT 1`,
    [puestoId]
  );
  const { rows: pausas } = await query('SELECT * FROM pausas_activas WHERE puesto_id = $1', [puestoId]);
  const { rows: atendidos } = await query(
    `SELECT * FROM turnos WHERE puesto_id = $1 AND hora_llamado IS NOT NULL AND estado IN ('finalizado','ausente')
     ORDER BY hora_llamado DESC LIMIT 4`,
    [puestoId]
  );
  const saturado = await colas.pagosSaturados(id);
  res.json({ activo: activos[0] || null, pausa: pausas[0] || null, atendidos, pagosSaturados: saturado });
});

module.exports = router;
