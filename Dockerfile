# Imagen ligera (~60 MB) para Umbrel, Docker o Portainer. Funciona en Raspberry Pi (arm64) y PC (amd64).
FROM node:22-alpine

RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    TZ=Europe/Madrid

WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# usuario "node" (uid 1000), el mismo que usa Umbrel para los datos de las apps
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/status >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
