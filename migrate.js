/** Crea las tablas descritas en schema.sql. Seguro de ejecutar más de una
 *  vez sobre una base ya creada: schema.sql usa CREATE TABLE/INDEX IF NOT
 *  EXISTS, así que un "ya existe" no es un error real, sino el resultado
 *  esperado de correr esto sobre una base que ya se había migrado antes.
 *  Por eso esos casos se reportan solo como información (exitCode = 0);
 *  cualquier otro error (conexión, sintaxis, permisos, etc.) sí hace
 *  fallar el proceso (exitCode = 1). */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Códigos de error de PostgreSQL que solo significan "esto ya existía" y
// no ameritan tratarse como una falla real de la migración.
// Ver https://www.postgresql.org/docs/current/errcodes-appendix.html
const CODIGOS_YA_EXISTE = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object (p. ej. la extensión uuid-ossp)
  '42701', // duplicate_column
  '23505', // unique_violation (p. ej. el INSERT ... ON CONFLICT de una fila fija)
]);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Tablas creadas correctamente.');
  } catch (e) {
    if (e.code && CODIGOS_YA_EXISTE.has(e.code)) {
      console.log('El esquema ya existía (esto es normal si ya se había ejecutado antes):', e.message);
    } else {
      console.error('No se pudo crear el esquema:', e.message);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}
main();
