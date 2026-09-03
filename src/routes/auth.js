const router = require('express').Router();
const { query } = require('../db');
const {
  normalizarCorreo,
  hashClave,
  verificarClave,
  firmarToken,
  generarTokenTemporal,
  verificarTokenTemporal,
} = require('../auth');
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
    // Primer ingreso: el token temporal es aleatorio por cuenta y vence a
    // los 7 días (ver POST /usuarios y /restablecer). No se marca como
    // iniciada hasta que definan su propia clave en /definir-clave.
    if (!(await verificarTokenTemporal(clave, u))) {
      return res.status(401).json({ error: 'La contraseña temporal no es correcta o venció.' });
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
  if (!u || !u.temporal || !(await verificarTokenTemporal(claveTemporal, u))) {
    return res.status(401).json({ error: 'No se pudo verificar la cuenta.' });
  }
  const hash = await hashClave(claveNueva);
  await query(
    'UPDATE usuarios SET hash = $1, temporal = false, token_temporal_hash = NULL, token_temporal_vence = NULL WHERE correo = $2',
    [hash, correo]
  );
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

  const { token, vence } = generarTokenTemporal();
  const tokenHash = await hashClave(token);
  await query(
    'INSERT INTO usuarios (correo, nombre, rol, hash, temporal, token_temporal_hash, token_temporal_vence) VALUES ($1,$2,$3,NULL,true,$4,$5)',
    [correo, nombre || null, rol, tokenHash, vence]
  );
  // El token en claro solo se entrega aquí, en la respuesta a quien lo crea
  // (un admin ya autenticado) — no queda guardado en ninguna parte más.
  res.status(201).json({ correo, nombre, rol, temporal: true, tokenTemporal: token, tokenVence: vence });
});

/** PATCH /api/auth/usuarios/:correo/rol  { rol } */
router.patch('/usuarios/:correo/rol', exigirSesion, exigirAdmin, async (req, res) => {
  const correo = normalizarCorreo(req.params.correo);
  if (!['admin', 'operador'].includes(req.body.rol)) return res.status(400).json({ error: 'Rol inválido.' });
  // token_version sube para que cualquier sesión ya emitida a esta cuenta
  // se corte de inmediato y vuelva a entrar con el rol nuevo, en vez de
  // seguir operando con el rol que tenía cuando inició sesión.
  await query(
    'UPDATE usuarios SET rol = $1, token_version = token_version + 1 WHERE correo = $2',
    [req.body.rol, correo]
  );
  res.json({ ok: true });
});

/** POST /api/auth/usuarios/:correo/restablecer — vuelve a clave temporal */
router.post('/usuarios/:correo/restablecer', exigirSesion, exigirAdmin, async (req, res) => {
  const correo = normalizarCorreo(req.params.correo);
  const { token, vence } = generarTokenTemporal();
  const tokenHash = await hashClave(token);
  // token_version sube junto con la clave: una sesión ya abierta de esta
  // cuenta (por ejemplo si se está restableciendo por una cuenta comprometida)
  // deja de servir de inmediato, no solo cuando el JWT expire por su cuenta.
  const { rowCount } = await query(
    `UPDATE usuarios
       SET hash = NULL, temporal = true,
           token_temporal_hash = $1, token_temporal_vence = $2,
           token_version = token_version + 1
     WHERE correo = $3`,
    [tokenHash, vence, correo]
  );
  if (!rowCount) return res.status(404).json({ error: 'No existe un usuario con ese correo.' });
  res.json({ ok: true, tokenTemporal: token, tokenVence: vence });
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
