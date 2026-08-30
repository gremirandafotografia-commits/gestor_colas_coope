const router = require('express').Router();
const { query } = require('../db');
const { exigirSesion, exigirAdmin } = require('../middleware/auth');
const { enviarPendientesAPowerBI, contarPendientesPowerBI } = require('../lib/powerbi');

/** GET /api/config — cualquier pantalla puede leer la configuración pública
 *  (logo, PIN, voz, tono, desborde). El token del padrón NO se expone aquí. */
router.get('/config', exigirSesion, async (req, res) => {
  const { rows } = await query(
    `SELECT logo_url, pin_salida, voz_nombre, voz_activa, voz_velocidad, voz_tono,
            tono_activo, tono_id,
            desborde_activo, desborde_umbral_fichas, desborde_umbral_minutos,
            (padron_url != '') AS padron_configurado,
            (powerbi_url != '') AS powerbi_configurado,
            (salesforce_url != '') AS salesforce_configurado
     FROM configuracion WHERE id = 1`
  );
  const { rows: anuncios } = await query('SELECT * FROM anuncios ORDER BY orden');
  res.json({ ...rows[0], anuncios });
});

/** PATCH /api/config — solo administradores. */
router.patch('/config', exigirSesion, exigirAdmin, async (req, res) => {
  const permitidos = [
    'logo_url', 'pin_salida', 'voz_nombre', 'voz_activa', 'voz_velocidad', 'voz_tono',
    'tono_activo', 'tono_id',
    'desborde_activo', 'desborde_umbral_fichas', 'desborde_umbral_minutos',
    'padron_url', 'padron_token',
    'powerbi_url', 'powerbi_token', 'salesforce_url', 'salesforce_token',
  ];
  const campos = [];
  const valores = [];
  let i = 1;
  for (const clave of permitidos) {
    if (clave in req.body) { campos.push(`${clave} = $${i++}`); valores.push(req.body[clave]); }
  }
  if (!campos.length) return res.json({ ok: true });
  await query(`UPDATE configuracion SET ${campos.join(', ')} WHERE id = 1`, valores);
  res.json({ ok: true });
});

/** POST /api/config/probar-padron — igual que el botón «Probar conexión»
 *  del prototipo: consulta GET {padron_url}/salud. */
router.post('/config/probar-padron', exigirSesion, exigirAdmin, async (req, res) => {
  const { rows } = await query('SELECT padron_url, padron_token FROM configuracion WHERE id = 1');
  const cfg = rows[0];
  if (!cfg.padron_url) return res.status(400).json({ error: 'No hay dirección de servicio configurada.' });
  try {
    const controlador = new AbortController();
    const limite = setTimeout(() => controlador.abort(), 6000);
    const resp = await fetch(`${cfg.padron_url.replace(/\/$/, '')}/salud`, {
      headers: cfg.padron_token ? { Authorization: `Bearer ${cfg.padron_token}` } : {},
      signal: controlador.signal,
    });
    clearTimeout(limite);
    if (resp.ok) return res.json({ ok: true });
    return res.status(502).json({ error: `El servicio respondió con error ${resp.status}` });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'No respondió a tiempo (6 s).' : 'No se pudo alcanzar la dirección indicada.';
    return res.status(502).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// Power BI (envío real de turnos cerrados — ver src/lib/powerbi.js)
// ---------------------------------------------------------------------------
/** GET /api/config/powerbi/estado — cuántos turnos cerrados faltan por
 *  enviar y cuándo fue el último envío exitoso, para Administración. */
router.get('/config/powerbi/estado', exigirSesion, exigirAdmin, async (req, res) => {
  res.json(await contarPendientesPowerBI());
});

/** POST /api/config/powerbi/enviar — dispara a mano el mismo envío que
 *  corre solo periódicamente (ver setInterval en src/server.js). */
router.post('/config/powerbi/enviar', exigirSesion, exigirAdmin, async (req, res) => {
  try {
    const resultado = await enviarPendientesAPowerBI();
    res.json({ ok: true, ...resultado });
  } catch (e) {
    res.status(e.codigo === 'SIN_CONFIGURAR' ? 400 : 502).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Anuncios (imágenes/video para el kiosco y la sala)
// ---------------------------------------------------------------------------
router.post('/config/anuncios', exigirSesion, exigirAdmin, async (req, res) => {
  const { tipo, src, nombre, destino } = req.body;
  if (!['imagen', 'video'].includes(tipo) || !src) return res.status(400).json({ error: 'Datos incompletos.' });
  const { rows } = await query(
    `INSERT INTO anuncios (tipo, src, nombre, destino, orden)
     VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(orden),0)+1 FROM anuncios)) RETURNING *`,
    [tipo, src, nombre || null, ['ambos', 'kiosco', 'sala'].includes(destino) ? destino : 'ambos']
  );
  res.status(201).json(rows[0]);
});

/** PATCH /api/config/anuncios/:id  { destino } — cambia a qué pantalla se
 *  dirige un anuncio ya subido, sin tener que volver a cargarlo. */
router.patch('/config/anuncios/:id', exigirSesion, exigirAdmin, async (req, res) => {
  const { destino } = req.body;
  if (!['ambos', 'kiosco', 'sala'].includes(destino)) return res.status(400).json({ error: 'Destino no válido.' });
  await query('UPDATE anuncios SET destino = $1 WHERE id = $2', [destino, req.params.id]);
  res.json({ ok: true });
});

router.delete('/config/anuncios/:id', exigirSesion, exigirAdmin, async (req, res) => {
  await query('DELETE FROM anuncios WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
