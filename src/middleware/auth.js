const { verificarToken } = require('../auth');

function exigirSesion(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
  const datos = token && verificarToken(token);
  if (!datos) return res.status(401).json({ error: 'Sesión no válida o vencida. Inicie sesión de nuevo.' });
  req.usuario = datos; // { correo, rol }
  next();
}

function exigirAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Esta acción es exclusiva de los administradores del sistema.' });
  }
  next();
}

module.exports = { exigirSesion, exigirAdmin };
