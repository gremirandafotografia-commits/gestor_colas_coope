const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DOMINIO = process.env.DOMINIO_CORREO || '@coopelesca.co.cr';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Falta JWT_SECRET en el archivo .env — vea .env.example');
}

const HORAS_VENCE_TOKEN_TEMPORAL = 24 * 7; // una semana para completar el primer ingreso

// Por decisión de Administración, la contraseña temporal (primer ingreso o
// cualquier restablecimiento por bloqueo) es siempre esta misma palabra fija
// en vez de un token aleatorio por cuenta — así el administrador siempre
// sabe cuál es, sin tener que copiarla ni guardarla en ningún lado. Sigue
// venciendo a los 7 días (HORAS_VENCE_TOKEN_TEMPORAL) y el primer ingreso
// sigue exigiendo definir una contraseña propia, así que esto no reemplaza
// la contraseña real de nadie una vez que la define.
const CLAVE_TEMPORAL_FIJA = 'Coopelesca';

function generarTokenTemporal() {
  const vence = new Date(Date.now() + HORAS_VENCE_TOKEN_TEMPORAL * 3600 * 1000);
  return { token: CLAVE_TEMPORAL_FIJA, vence };
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

function firmarToken(usuario, opciones) {
  // El token vive poco por defecto (10 h ~ un turno de trabajo); el personal
  // vuelve a entrar al día siguiente. POST /auth/sesion-larga pide una
  // vigencia más larga explícitamente para pantallas fijas sin atención
  // humana constante (kiosco, pantalla de sala) — ver src/routes/auth.js.
  //
  // El rol NO se firma en el token: exigirSesion lo relee de la base en cada
  // request, junto con `v`, para que un cambio de rol o un restablecimiento
  // de contraseña surta efecto de inmediato y no solo cuando el token expire.
  const expiresIn = (opciones && opciones.expiresIn) || '10h';
  return jwt.sign({ correo: usuario.correo, v: usuario.token_version }, JWT_SECRET, { expiresIn });
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
