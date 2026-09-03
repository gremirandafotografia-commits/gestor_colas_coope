/** Carga los datos iniciales descritos en seed.sql: sucursales, puestos,
 *  trámites, la pregunta de encuesta por defecto y el usuario administrador.
 *  Ejecútelo una sola vez, justo después de migrate.js, sobre una base
 *  recién creada. Si ya hay datos, se detiene con un aviso en vez de
 *  duplicarlos. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { hashClave, generarTokenTemporal } = require('../src/auth');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM sucursales');
    if (rows[0].n > 0) {
      console.log('Ya hay sucursales cargadas — no se vuelve a sembrar la base para no duplicar datos.');
      console.log('Si de verdad quiere partir de cero, vacíe las tablas manualmente primero.');
      return;
    }
    const sql = fs.readFileSync(path.join(__dirname, '..', 'seed.sql'), 'utf8');
    await pool.query(sql);

    // seed.sql deja el admin inicial sin token temporal (no puede llamar a
    // bcrypt desde SQL puro) — se lo asignamos aquí, igual que hace
    // POST /api/auth/usuarios para cualquier otro usuario nuevo.
    const { token, vence } = generarTokenTemporal();
    const tokenHash = await hashClave(token);
    await pool.query(
      'UPDATE usuarios SET token_temporal_hash = $1, token_temporal_vence = $2 WHERE correo = $3',
      [tokenHash, vence, 'admin@coopelesca.co.cr']
    );

    console.log('Datos iniciales cargados correctamente.');
    console.log('');
    console.log('Usuario administrador: admin@coopelesca.co.cr');
    console.log('Contraseña temporal:   ' + token + '  (vence ' + vence.toISOString().slice(0, 10) + ')');
    console.log('(el sistema pedirá definir una contraseña propia en el primer ingreso)');
  } catch (e) {
    console.error('No se pudieron cargar los datos iniciales:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main();
