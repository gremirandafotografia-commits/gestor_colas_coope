const { verificarToken } = require('../auth');
const { query } = require('../db');

async function exigirSesion(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
  const datos = token && verificarToken(token);
  if (!datos) return res.status(401).json({ error: 'Sesión no válida o vencida. Inicie sesión de nuevo.' });

  // El rol y la vigencia se leen de la base en cada request, no del token: así
  // un cambio de rol, un restablecimiento de contraseña o la eliminación de
  // la cuenta cortan el acceso de inmediato, aunque el JWT siga sin expirar
  // (ver token_version en schema.sql).
  const { rows } = await query('SELECT rol, token_version FROM usuarios WHERE correo = $1', [datos.correo]);
  const u = rows[0];
  if (!u || u.token_version !== datos.v) {
    return res.status(401).json({ error: 'Sesión no válida o vencida. Inicie sesión de nuevo.' });
  }
  req.usuario = { correo: datos.correo, rol: u.rol };
  next();
}

function exigirAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Esta acción es exclusiva de los administradores del sistema.' });
  }
  next();
}

module.exports = { exigirSesion, exigirAdmin };
