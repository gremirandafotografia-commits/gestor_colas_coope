/**
 * Envío real de datos operativos a Power BI, hacia el dataset "push" o
 * "streaming" (con historial habilitado) que Informática configure desde
 * Administración → Integraciones.
 *
 * Solo se envían turnos ya cerrados (finalizado/ausente): mientras un turno
 * sigue en curso sus horas todavía pueden cambiar, y los datasets de Power BI
 * no soportan actualizar una fila ya enviada — solo agregar filas nuevas (o
 * borrar el dataset entero, que tampoco sirve aquí porque perdería el
 * histórico). Por eso se espera a que el turno tenga su estado definitivo
 * antes de mandarlo, y `turnos.powerbi_enviado_en` marca cuáles ya se
 * enviaron para no repetirlos jamás, ni siquiera si el envío se reintenta.
 *
 * Nunca se incluyen cédula ni nombre: son de uso interno, igual que en las
 * pantallas públicas del kiosco y la sala (ver schema.sql, tabla turnos).
 *
 * Power BI admite dos formas de recibir estas filas, y esta función detecta
 * cuál está en uso por la forma de la URL guardada:
 *  - Dataset "push" vía la API REST completa de Power BI
 *    (POST .../datasets/{id}/tables/{tabla}/rows, con token Bearer de Azure
 *    AD): el cuerpo va envuelto en {"rows": [...]}.
 *  - Dataset "streaming" creado desde la interfaz de Power BI con "Historic
 *    data analysis" activado: la URL que entrega Power BI ya incluye una
 *    clave de un solo uso (?key=...) y no requiere token; el cuerpo va como
 *    un arreglo plano [...] (sin envolver en "rows").
 * Ver la ayuda en pantalla, junto a los campos de configuración, para el
 * paso a paso de cada opción.
 */
const { query } = require('../db');

const LOTE = 500;
const TOPE_POR_ENVIO = 10000; // límite por corrida, para acotar el peor caso de un backlog grande

function segundosEntre(desde, hasta) {
  return desde && hasta ? Math.round((new Date(hasta) - new Date(desde)) / 1000) : null;
}

/** Forma de cada fila enviada a Power BI. Debe coincidir con el esquema que
 *  se haya creado del lado de Power BI (mismos nombres de columna). */
function filaPowerBI(t) {
  return {
    Folio: t.folio,
    Sucursal: t.sucursal_id,
    Tramite: t.tramite_nombre,
    Preferencial: t.preferencial,
    Estado: t.estado,
    Puesto: t.puesto_nombre || '',
    Seccion: t.seccion_nombre || '',
    Desborde: t.desborde,
    AtendidoPor: t.atendido_por || '',
    HoraCreado: t.hora_creado,
    HoraLlamado: t.hora_llamado,
    HoraAtencion: t.hora_atencion,
    HoraFinalizado: t.hora_finalizado,
    SegundosEspera: segundosEntre(t.hora_creado, t.hora_atencion),
    SegundosAtencion: segundosEntre(t.hora_atencion, t.hora_finalizado),
  };
}

/** Nombres y tipos de columna que debe tener el dataset del lado de Power
 *  BI, para mostrarlos en la ayuda de Administración. */
const ESQUEMA_POWERBI = [
  ['Folio', 'Text'], ['Sucursal', 'Text'], ['Tramite', 'Text'], ['Preferencial', 'True/False'],
  ['Estado', 'Text'], ['Puesto', 'Text'], ['Seccion', 'Text'], ['Desborde', 'True/False'],
  ['AtendidoPor', 'Text'], ['HoraCreado', 'DateTime'], ['HoraLlamado', 'DateTime'],
  ['HoraAtencion', 'DateTime'], ['HoraFinalizado', 'DateTime'],
  ['SegundosEspera', 'Number'], ['SegundosAtencion', 'Number'],
];

async function obtenerConfigPowerBI() {
  const { rows } = await query('SELECT powerbi_url, powerbi_token FROM configuracion WHERE id = 1');
  return rows[0];
}

/** Cuántos turnos cerrados faltan por enviar, y cuándo fue el último envío
 *  exitoso — para que Administración lo muestre sin tener que enviar nada. */
async function contarPendientesPowerBI() {
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE powerbi_enviado_en IS NULL)::int AS pendientes,
            max(powerbi_enviado_en) AS ultimo_envio
     FROM turnos WHERE estado IN ('finalizado','ausente')`
  );
  return { pendientes: rows[0].pendientes, ultimoEnvio: rows[0].ultimo_envio };
}

function construirCuerpo(url, filas) {
  // La API REST completa de datasets "push" cuelga de .../tables/{tabla}/rows
  // y espera {"rows":[...]}; la URL de un dataset "streaming" (con clave en
  // la query) no tiene ese segmento y espera el arreglo desnudo.
  const esApiCompleta = /\/tables\/[^/?]+\/rows/i.test(url);
  return esApiCompleta ? JSON.stringify({ rows: filas }) : JSON.stringify(filas);
}

/** Envía a Power BI los turnos cerrados que todavía no se han mandado.
 *  Se usa tanto desde el botón «Enviar ahora» de Administración como desde
 *  el envío periódico automático (ver src/server.js). */
async function enviarPendientesAPowerBI() {
  const cfg = await obtenerConfigPowerBI();
  if (!cfg || !cfg.powerbi_url) {
    const error = new Error('No hay una dirección de Power BI configurada.');
    error.codigo = 'SIN_CONFIGURAR';
    throw error;
  }

  const { rows: turnos } = await query(
    `SELECT * FROM turnos WHERE estado IN ('finalizado','ausente') AND powerbi_enviado_en IS NULL
     ORDER BY hora_creado LIMIT $1`,
    [TOPE_POR_ENVIO]
  );
  if (!turnos.length) return { enviados: 0 };

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.powerbi_token) headers.Authorization = `Bearer ${cfg.powerbi_token}`;

  let enviados = 0;
  for (let i = 0; i < turnos.length; i += LOTE) {
    const lote = turnos.slice(i, i + LOTE);
    let resp;
    try {
      resp = await fetch(cfg.powerbi_url, {
        method: 'POST',
        headers,
        body: construirCuerpo(cfg.powerbi_url, lote.map(filaPowerBI)),
      });
    } catch (e) {
      const error = new Error('No se pudo alcanzar la dirección de Power BI configurada.');
      error.codigo = 'ENVIO_FALLIDO';
      error.enviadosAntes = enviados;
      throw error;
    }
    if (!resp.ok) {
      const texto = await resp.text().catch(() => '');
      const error = new Error(
        `Power BI respondió con error ${resp.status}${texto ? ': ' + texto.slice(0, 200) : ''}`
      );
      error.codigo = 'ENVIO_FALLIDO';
      error.enviadosAntes = enviados;
      throw error;
    }
    await query('UPDATE turnos SET powerbi_enviado_en = now() WHERE id = ANY($1::uuid[])', [
      lote.map((t) => t.id),
    ]);
    enviados += lote.length;
  }
  return { enviados };
}

module.exports = { enviarPendientesAPowerBI, contarPendientesPowerBI, ESQUEMA_POWERBI };
