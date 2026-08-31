require('dotenv').config();
const express = require('express');
require('express-async-errors');
const helmet = require('helmet');
const cors = require('cors');
const http = require('http');

const path = require('path');
const sockets = require('./sockets');
const { enviarPendientesAPowerBI } = require('./lib/powerbi');

const app = express();
// El CSP por defecto de helmet bloquea scripts inline (script-src 'self'
// sin 'unsafe-inline'), y COOPELESCA_Filas_Demo.html es un único <script>
// inline — con el default, el navegador lo descarta en silencio y la
// pantalla queda completamente en blanco, sin ningún error visible salvo en
// la consola. Como es un archivo estático (sin motor de plantillas), usar
// un nonce por request no aplica aquí; se permite 'unsafe-inline' en
// script-src en su lugar.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", "'unsafe-inline'"],
    },
  },
}));
// Los anuncios del kiosco/sala se suben como data URI dentro del cuerpo
// JSON (hasta 8MB de video en el navegador, ~33% más grande ya en base64);
// 2mb se quedaba corto y el POST fallaba antes de llegar a la ruta.
app.use(express.json({ limit: '15mb' }));

const origenes = (process.env.CORS_ORIGENES || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origenes.length ? origenes : true }));

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/catalogo'));
app.use('/api', require('./routes/turnos'));
app.use('/api', require('./routes/encuestas'));
app.use('/api', require('./routes/reportes'));
app.use('/api', require('./routes/config'));

app.get('/salud', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

// Pantallas (kiosco, sala, ventanilla, encuestas, admin): un solo archivo
// estático, servido desde el mismo origen que la API para que no haga falta
// abrir CORS a ningún otro dominio.
const RUTA_HTML = path.join(__dirname, '..', 'COOPELESCA_Filas_Demo.html');
app.get('/', (req, res) => res.sendFile(RUTA_HTML));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
const servidorHttp = http.createServer(app);
sockets.iniciar(servidorHttp, origenes.length ? origenes : true);

const PUERTO = process.env.PORT || 8080;
servidorHttp.listen(PUERTO, () => {
  console.log(`Sistema de Gestión de Filas — backend escuchando en el puerto ${PUERTO}`);
});

// Envío periódico a Power BI: cada 5 minutos revisa si hay turnos cerrados
// sin mandar. Si Administración no ha configurado una dirección de Power BI,
// enviarPendientesAPowerBI() lanza SIN_CONFIGURAR y aquí se ignora en
// silencio — no hace falta un interruptor aparte para activarlo/desactivarlo.
const INTERVALO_POWERBI_MS = 5 * 60 * 1000;
setInterval(() => {
  enviarPendientesAPowerBI().catch((e) => {
    if (e.codigo !== 'SIN_CONFIGURAR') console.error('Envío periódico a Power BI:', e.message);
  });
}, INTERVALO_POWERBI_MS);
