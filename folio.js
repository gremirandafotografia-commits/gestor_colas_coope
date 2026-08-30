/**
 * Generación de folios y del número consecutivo.
 *
 * A diferencia del prototipo (un solo navegador, sin concurrencia real),
 * aquí puede haber varios kioscos emitiendo fichas al mismo tiempo, así que
 * cada número se reserva dentro de una transacción con bloqueo de fila
 * (SELECT ... FOR UPDATE) para que dos kioscos nunca puedan repetir folio.
 *
 * Reglas (idénticas al prototipo, actualizadas a la versión final del HTML):
 *  - Fichas preferenciales: prefijo "PREF", numeración compartida por
 *    sucursal sin importar el trámite.
 *  - Fichas normales: prefijo = letra del trámite, numeración propia por
 *    sucursal + trámite.
 *  - Ambos contadores dan la vuelta a 1 después de 999 (folio de tres
 *    cifras, 001-999), no diariamente.
 *  - El consecutivo es global (no por sucursal), de 1 a 10 000, sin guardar
 *    histórico del ciclo anterior — es el número corto para rellamar.
 */
const { transaccion } = require('../db');

async function siguienteFolio(sucursalId, tramite, preferencial) {
  return transaccion(async (cliente) => {
    const clave = preferencial ? `${sucursalId}-PREF` : `${sucursalId}-${tramite.letra}`;

    const { rows } = await cliente.query(
      'SELECT valor FROM contadores WHERE clave = $1 FOR UPDATE',
      [clave]
    );
    let anterior = 0;
    if (rows.length) {
      anterior = rows[0].valor;
    } else {
      await cliente.query('INSERT INTO contadores (clave, valor) VALUES ($1, 0)', [clave]);
    }
    const n = anterior >= 999 ? 1 : anterior + 1;
    await cliente.query('UPDATE contadores SET valor = $1 WHERE clave = $2', [n, clave]);

    const prefijo = preferencial ? 'PREF' : tramite.letra;
    const folio = `${prefijo}-${String(n).padStart(3, '0')}`;

    const { rows: cRows } = await cliente.query(
      'SELECT valor FROM consecutivo WHERE id = 1 FOR UPDATE'
    );
    const consecAnterior = cRows[0].valor;
    const consecutivo = consecAnterior >= 10000 ? 1 : consecAnterior + 1;
    await cliente.query('UPDATE consecutivo SET valor = $1 WHERE id = 1', [consecutivo]);

    return { folio, consecutivo };
  });
}

module.exports = { siguienteFolio };
