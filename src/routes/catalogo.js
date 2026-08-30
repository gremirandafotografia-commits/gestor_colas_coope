const router = require('express').Router();
const { query } = require('../db');
const { exigirSesion, exigirAdmin } = require('../middleware/auth');
const { puestosDeSucursal } = require('../lib/colas');

// ---------------------------------------------------------------------------
// Sucursales
// ---------------------------------------------------------------------------
router.get('/sucursales', exigirSesion, async (req, res) => {
  const { rows } = await query('SELECT * FROM sucursales ORDER BY nombre');
  res.json(rows);
});

router.post('/sucursales', exigirSesion, exigirAdmin, async (req, res) => {
  const { id, nombre } = req.body;
  if (!id || !nombre) return res.status(400).json({ error: 'Falta el id o el nombre.' });
  await query('INSERT INTO sucursales (id, nombre) VALUES ($1,$2)', [id, nombre]);
  res.status(201).json({ id, nombre });
});

router.delete('/sucursales/:id', exigirSesion, exigirAdmin, async (req, res) => {
  await query('DELETE FROM sucursales WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Trámites
// ---------------------------------------------------------------------------
router.get('/tramites', exigirSesion, async (req, res) => {
  const { rows } = await query('SELECT * FROM tramites ORDER BY letra');
  res.json(rows);
});

router.post('/tramites', exigirSesion, exigirAdmin, async (req, res) => {
  const { id, letra, nombre, icono } = req.body;
  if (!id || !letra || !nombre) return res.status(400).json({ error: 'Faltan datos del trámite.' });
  await query('INSERT INTO tramites (id, letra, nombre, icono) VALUES ($1,$2,$3,$4)', [
    id, letra.toUpperCase(), nombre, icono || 'ayuda',
  ]);
  res.status(201).json({ id, letra, nombre, icono });
});

router.delete('/tramites/:id', exigirSesion, exigirAdmin, async (req, res) => {
  await query('DELETE FROM tramites WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Puestos (ventanillas y cajas)
// ---------------------------------------------------------------------------
router.get('/sucursales/:id/puestos', exigirSesion, async (req, res) => {
  res.json(await puestosDeSucursal(req.params.id));
});

router.post('/puestos', exigirSesion, exigirAdmin, async (req, res) => {
  const { id, sucursalId, nombre, tipo, tramites } = req.body;
  if (!id || !sucursalId || !nombre || !['ventanilla', 'caja'].includes(tipo)) {
    return res.status(400).json({ error: 'Faltan datos del puesto.' });
  }
  const area = tipo === 'caja' ? 'pagos' : 'tramites';
  await query(
    `INSERT INTO puestos (id, sucursal_id, nombre, tipo, area, prioridad_preferencial, apoya_pagos, activo)
     VALUES ($1,$2,$3,$4,$5,false,$6,true)`,
    [id, sucursalId, nombre, tipo, area, tipo === 'ventanilla']
  );
  for (const tramiteId of tramites || []) {
    await query('INSERT INTO puesto_tramites (puesto_id, tramite_id) VALUES ($1,$2)', [id, tramiteId]);
  }
  res.status(201).json({ id, sucursalId, nombre, tipo, area });
});

/** PATCH /api/puestos/:id — activo, prioridad_preferencial, apoya_pagos, tramites (reemplaza la lista) */
router.patch('/puestos/:id', exigirSesion, exigirAdmin, async (req, res) => {
  const { id } = req.params;
  const campos = [];
  const valores = [];
  let i = 1;
  for (const clave of ['activo', 'prioridad_preferencial', 'apoya_pagos']) {
    if (clave in req.body) { campos.push(`${clave} = $${i++}`); valores.push(req.body[clave]); }
  }
  if (campos.length) {
    valores.push(id);
    await query(`UPDATE puestos SET ${campos.join(', ')} WHERE id = $${i}`, valores);
  }
  if (Array.isArray(req.body.tramites)) {
    await query('DELETE FROM puesto_tramites WHERE puesto_id = $1', [id]);
    for (const tramiteId of req.body.tramites) {
      await query('INSERT INTO puesto_tramites (puesto_id, tramite_id) VALUES ($1,$2)', [id, tramiteId]);
    }
  }
  res.json({ ok: true });
});

router.delete('/puestos/:id', exigirSesion, exigirAdmin, async (req, res) => {
  await query('DELETE FROM puestos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
