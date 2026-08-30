const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DOMINIO = process.env.DOMINIO_CORREO || '@coopelesca.co.cr';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Falta JWT_SECRET en el archivo .env — vea .env.example');
}

function normalizarCorreo(correo) {
  let c = String(correo || '').trim().toLowerCase();
  if (c && !c.includes('@')) c += DOMINIO;
  return c;
}

async function hashClave(clave) {
  return bcrypt.hash(clave, 12);
}

async function verificarClave(clave, hash) {
  if (!hash) return false;
  return bcrypt.compare(clave, hash);
}

function firmarToken(usuario) {
  // El token vive poco (10 h ~ un turno de trabajo); el personal vuelve a
  // entrar al día siguiente. Ajuste expiresIn según la política de la
  // cooperativa.
  return jwt.sign({ correo: usuario.correo, rol: usuario.rol }, JWT_SECRET, { expiresIn: '10h' });
}

function verificarToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { DOMINIO, normalizarCorreo, hashClave, verificarClave, firmarToken, verificarToken };
