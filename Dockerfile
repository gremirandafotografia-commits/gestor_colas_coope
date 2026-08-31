# Debian (no Alpine): la red privada de Railway (*.railway.internal) solo
# publica registros DNS IPv6, y musl libc (la base de las imágenes alpine)
# tiene un bug conocido resolviendo dominios IPv6-only — la conexión a
# Postgres fallaba con "getaddrinfo ENOTFOUND postgres.railway.internal"
# aunque el DATABASE_URL estuviera bien configurado.
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 8080
# migrate.js y seed.js son idempotentes (ver sus comentarios), pero son
# migraciones de esquema/datos iniciales, no parte del arranque del
# servidor: deben correr una vez antes del deploy (o manualmente con
# `npm run migrate` / `npm run seed`), no en cada reinicio del contenedor.
CMD ["node", "src/server.js"]

