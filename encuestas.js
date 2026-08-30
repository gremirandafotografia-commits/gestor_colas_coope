const router = require('express').Router();
const { query } = require('../db');
const { exigirSesion, exigirAdmin } = require('../middleware/auth');

/** GET /api/encuestas/preguntas */
router.get('/encuestas/preguntas', exigirSesion, async (req, res) => {
  const { rows } = await query('SELECT * FROM encuesta_preguntas ORDER BY orden');
  res.json(rows);
});

router.post('/encuestas/preguntas', exigirSesion, exigirAdmin, async (req, res) => {
  const id = `p${Date.now()}`;
  const { rows } = await query(
    `INSERT INTO encuesta_preguntas (id, texto, orden)
     VALUES ($1,$2, (SELECT COALESCE(MAX(orden),0)+1 FROM encuesta_preguntas)) RETURNING *`,
    [id, req.body.texto]
  );
  res.status(201).json(rows[0]);
});

router.delete('/encuestas/preguntas/:id', exigirSesion, exigirAdmin, async (req, res) => {
  await query('DELETE FROM encuesta_preguntas WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

/** GET /api/encuestas/canales — canales remotos (WhatsApp, sitio web, etc.) */
router.get('/encuestas/canales', exigirSesion, async (req, res) => {
  const { rows } = await query('SELECT nombre FROM encuesta_canales ORDER BY nombre');
  res.json(rows.map((r) => r.nombre));
});

router.post('/encuestas/canales', exigirSesion, exigirAdmin, async (req, res) => {
  await query('INSERT INTO encuesta_canales (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [req.body.nombre]);
  res.status(201).json({ nombre: req.body.nombre });
});

router.delete('/encuestas/canales/:nombre', exigirSesion, exigirAdmin, async (req, res) => {
  await query('DELETE FROM encuesta_canales WHERE nombre = $1', [req.params.nombre]);
  res.json({ ok: true });
});

/** GET /api/sucursales/:id/turno-en-atencion/:puestoId
 *  La tableta de encuestas consulta esto antes de habilitarse: solo debe
 *  ofrecer la encuesta mientras ese puesto tiene un turno EN ATENCIÓN en
 *  este momento — nunca antes, nunca después de cerrarlo. */
router.get('/sucursales/:id/turno-en-atencion/:puestoId', exigirSesion, async (req, res) => {
  const { rows } = await query(
    `SELECT id, folio, tramite_nombre FROM turnos
     WHERE puesto_id = $1 AND estado = 'atendiendo' LIMIT 1`,
    [req.params.puestoId]
  );
  res.json(rows[0] || null);
});

/** POST /api/encuestas/respuestas
 *  { sucursalId, puestoId, plataforma, turnoId, turnoFolio, tramiteNombre,
 *    respuestas: [{ preguntaId, texto, valor }] } */
router.post('/encuestas/respuestas', exigirSesion, async (req, res) => {
  const { sucursalId, puestoId, plataforma, turnoId, turnoFolio, tramiteNombre, respuestas } = req.body;
  if (!Array.isArray(respuestas) || !respuestas.length) {
    return res.status(400).json({ error: 'Faltan las respuestas.' });
  }
  const { rows } = await query(
    `INSERT INTO encuesta_respuestas (sucursal_id, puesto_id, plataforma, turno_id, turno_folio, tramite_nombre)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [sucursalId, puestoId || null, plataforma, turnoId || null, turnoFolio || null, tramiteNombre || null]
  );
  const respuestaId = rows[0].id;
  for (const r of respuestas) {
    await query(
      `INSERT INTO encuesta_respuesta_detalle (respuesta_id, pregunta_id, pregunta_texto, valor)
       VALUES ($1,$2,$3,$4)`,
      [respuestaId, r.preguntaId, r.texto, r.valor]
    );
  }
  res.status(201).json({ id: respuestaId });
});

module.exports = router;
