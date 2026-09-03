const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DOMINIO = process.env.DOMINIO_CORREO || '@coopelesca.co.cr';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Falta JWT_SECRET en el archivo .env — vea .env.example');
}

// Sin caracteres ambiguos (0/O, 1/I/l) para que se pueda dictar o copiar sin
// errores al entregarlo a la persona que recibe la cuenta.
const ALFABETO_TOKEN = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const HORAS_VENCE_TOKEN_TEMPORAL = 24 * 7; // una semana para completar el primer ingreso

function generarTokenTemporal() {
  let token = '';
  for (let i = 0; i < 10; i++) {
    token += ALFABETO_TOKEN[crypto.randomInt(ALFABETO_TOKEN.length)];
  }
  const vence = new Date(Date.now() + HORAS_VENCE_TOKEN_TEMPORAL * 3600 * 1000);
  return { token, vence };
}

async function verificarTokenTemporal(clave, u) {
  if (!clave || !u.token_temporal_hash) return false;
  if (!u.token_temporal_vence || new Date(u.token_temporal_vence) < new Date()) return false;
  return bcrypt.compare(clave, u.token_temporal_hash);
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
  //
  // El rol NO se firma en el token: exigirSesion lo relee de la base en cada
  // request, junto con `v`, para que un cambio de rol o un restablecimiento
  // de contraseña surta efecto de inmediato y no solo cuando el token expire.
  return jwt.sign({ correo: usuario.correo, v: usuario.token_version }, JWT_SECRET, { expiresIn: '10h' });
}

function verificarToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = {
  DOMINIO,
  normalizarCorreo,
  hashClave,
  verificarClave,
  firmarToken,
  verificarToken,
  generarTokenTemporal,
  verificarTokenTemporal,
};
