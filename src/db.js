const { Pool } = require('pg');

// Muchos Postgres administrados (Railway incluido, cuando se usa la URL
// pública en vez de la de red privada) exigen TLS y rechazan la conexión en
// texto plano — sin esto, cada consulta falla con un error de conexión que
// termina como "Error interno del servidor" genérico en el navegador, sin
// pista de la causa real (que sí queda en los logs del backend). Se activa
// solo si PGSSL=true, para no tocar el desarrollo local (docker-compose) ni
// una red privada que no lo necesite.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

module.exports = {
  pool,
  query: (texto, parametros) => pool.query(texto, parametros),
  /** Ejecuta varias consultas dentro de una misma transacción. */
  async transaccion(fn) {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await fn(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (e) {
      await cliente.query('ROLLBACK');
      throw e;
    } finally {
      cliente.release();
    }
  },
};
