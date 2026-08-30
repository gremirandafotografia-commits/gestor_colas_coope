FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 4000
# migrate.js y seed.js son idempotentes (ver sus comentarios), pero son
# migraciones de esquema/datos iniciales, no parte del arranque del
# servidor: deben correr una vez antes del deploy (o manualmente con
# `npm run migrate` / `npm run seed`), no en cada reinicio del contenedor.
CMD ["node", "src/server.js"]
