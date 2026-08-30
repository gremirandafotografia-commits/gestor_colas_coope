const router = require('express').Router();
const { query } = require('../db');
const { exigirSesion, exigirAdmin } = require('../middleware/auth');
const { calcularMetricas } = require('../lib/metrics');

/** GET /api/reportes/metricas?desde=&hasta=&plataforma=
 *  Devuelve todo lo que necesitan tanto el tablero de indicadores como el
 *  reporte PDF/Excel del lado del cliente — una sola fuente de verdad. */
router.get('/reportes/metricas', exigirSesion, exigirAdmin, async (req, res) => {
  const { desde, hasta, plataforma } = req.query;
  const metricas = await calcularMetricas({ desde, hasta, plataforma });
  res.json(metricas);
});

/** GET /api/reportes/pausas — historial de detenciones de atención ya
 *  cerradas (ver POST /puestos/:id/reanudar, que archiva cada una aquí),
 *  para las estadísticas de tiempo detenido del Resumen. */
router.get('/reportes/pausas', exigirSesion, exigirAdmin, async (req, res) => {
  const { rows } = await query('SELECT * FROM pausas_historial ORDER BY hasta DESC');
  res.json(rows);
});

module.exports = router;
