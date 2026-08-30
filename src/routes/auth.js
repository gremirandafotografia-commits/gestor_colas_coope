const router = require('express').Router();
const { query } = require('../db');
const { normalizarCorreo, hashClave, verificarClave, firmarToken } = require('../auth');
const { exigirSesion, exigirAdmin } = require('../middleware/auth');

/** POST /api/auth/login  { correo, clave } */
router.post('/login', async (req, res) => {
  const correo = normalizarCorreo(req.body.correo);
  const clave = req.body.clave || '';
  if (!correo || !clave) return res.status(400).json({ error: 'Digite su correo y su contraseña.' });

  const { rows } = await query('SELECT * FROM usuarios WHERE correo = $1', [correo]);
  const u = rows[0];
  if (!u) return res.status(401).json({ error: 'No existe un usuario con ese correo institucional.' });

  if (u.temporal) {
    // Primer ingreso: la "contraseña" válida es la palabra fija que entrega
    // el administrador al crear la cuenta (ver POST /usuarios). No se marca
    // como iniciada hasta que definan su propia clave en /definir-clave.
    if (clave !== 'coopelesca') {
      return res.status(401).json({ error: 'La contraseña temporal no es correcta.' });
    }
    return res.json({ primerIngreso: true, correo: u.correo });
  }

  if (!(await verificarClave(clave, u.hash))) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  const token = firmarToken(u);
  res.json({ token, correo: u.correo, rol: u.rol, nombre: u.nombre });
});

/** POST /api/auth/definir-clave  { correo, claveTemporal, claveNueva } */
router.post('/definir-clave', async (req, res) => {
  const correo = normalizarCorreo(req.body.correo);
  const { claveTemporal, claveNueva } = req.body;
  if (!claveNueva || claveNueva.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  const { rows } = await query('SELECT * FROM usuarios WHERE correo = $1', [correo]);
  const u = rows[0];
  if (!u || !u.temporal || claveTemporal !== 'coopelesca') {
    return res.status(401).json({ error: 'No se pudo verificar la cuenta.' });
  }
  const hash = await hashClave(claveNueva);
  await query('UPDATE usuarios SET hash = $1, temporal = false WHERE correo = $2', [hash, correo]);
  const token = firmarToken(u);
  res.json({ token, correo: u.correo, rol: u.rol });
});

/** GET /api/auth/usuarios — solo administradores */
router.get('/usuarios', exigirSesion, exigirAdmin, async (req, res) => {
  const { rows } = await query(
    'SELECT correo, nombre, rol, temporal FROM usuarios ORDER BY correo'
  );
  res.json(rows);
});

/** POST /api/auth/usuarios  { correo, nombre, rol } — crea con clave temporal */
router.post('/usuarios', exigirSesion, exigirAdmin, async (req, res) => {
  const correo = normalizarCorreo(req.body.correo);
  const { nombre, rol } = req.body;
  if (!correo || !['admin', 'operador'].includes(rol)) {
    return res.status(400).json({ error: 'Correo y rol son obligatorios.' });
  }
  const existe = await query('SELECT 1 FROM usuarios WHERE correo = $1', [correo]);
  if (existe.rows.length) return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });

  await query(
    'INSERT INTO usuarios (correo, nombre, rol, hash, temporal) VALUES ($1,$2,$3,NULL,true)',
    [correo, nombre || null, rol]
  );
  res.status(201).json({ correo, nombre, rol, temporal: true });
});

/** PATCH /api/auth/usuarios/:correo/rol  { rol } */
router.patch('/usuarios/:correo/rol', exigirSesion, exigirAdmin, async (req, res) => {
  const correo = normalizarCorreo(req.params.correo);
  if (!['admin', 'operador'].includes(req.body.rol)) return res.status(400).json({ error: 'Rol inválido.' });
  await query('UPDATE usuarios SET rol = $1 WHERE correo = $2', [req.body.rol, correo]);
  res.json({ ok: true });
});

/** POST /api/auth/usuarios/:correo/restablecer — vuelve a clave temporal */
router.post('/usuarios/:correo/restablecer', exigirSesion, exigirAdmin, async (req, res) => {
  const correo = normalizarCorreo(req.params.correo);
  await query('UPDATE usuarios SET hash = NULL, temporal = true WHERE correo = $1', [correo]);
  res.json({ ok: true });
});

/** DELETE /api/auth/usuarios/:correo */
router.delete('/usuarios/:correo', exigirSesion, exigirAdmin, async (req, res) => {
  const correo = normalizarCorreo(req.params.correo);
  if (correo === req.usuario.correo) {
    return res.status(400).json({ error: 'No puede eliminar la cuenta con la que está trabajando.' });
  }
  await query('DELETE FROM usuarios WHERE correo = $1', [correo]);
  res.json({ ok: true });
});

module.exports = router;
