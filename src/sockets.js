/**
 * Sincronización en tiempo real entre pantallas.
 *
 * En el prototipo HTML, el kiosco y la sala "se enteraban" de un cambio
 * porque ambos leían el mismo localStorage del navegador. Con un servidor
 * real eso ya no existe: aquí cada pantalla se conecta por WebSocket
 * (Socket.io) a una "sala" por sucursal, y el servidor avisa a todas las
 * pantallas de esa sucursal cada vez que algo cambia — sin que nadie tenga
 * que refrescar la página.
 */
let io = null;

function iniciar(servidorHttp, corsOrigenes) {
  const { Server } = require('socket.io');
  io = new Server(servidorHttp, { cors: { origin: corsOrigenes } });

  io.on('connection', (socket) => {
    socket.on('unirse', (sucursalId) => {
      if (sucursalId) socket.join(`sucursal:${sucursalId}`);
    });
  });

  return io;
}

/** Avisa a todas las pantallas de una sucursal que hay novedades en la fila
 *  (nueva ficha, llamado, pausa, etc.). Las pantallas reaccionan volviendo a
 *  pedir los datos que les interesan — el mensaje solo dice "algo cambió",
 *  no manda el estado completo, para no acoplar el formato del evento a
 *  cada pantalla distinta. */
function avisarCambio(sucursalId, tipo) {
  if (!io) return;
  io.to(`sucursal:${sucursalId}`).emit('cambio', { tipo, cuando: Date.now() });
}

module.exports = { iniciar, avisarCambio };
