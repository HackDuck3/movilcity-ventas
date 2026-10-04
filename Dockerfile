# Small image (~60 MB) for Umbrel, Docker or Portainer. Runs on Raspberry Pi (arm64) and PC (amd64).
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

# The "node" user (uid 1000) is the one Umbrel uses for app data.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/status >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
