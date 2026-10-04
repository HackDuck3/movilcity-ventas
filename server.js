#!/usr/bin/env node
'use strict';
// Dependency-free HTTP server: serves the web app from public/ and the JSON API under /api/.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { backup } = require('./src/db');
const { routes, HttpError } = require('./src/api');
const auth = require('./src/auth');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_JSON_BODY = 4 * 1024 * 1024;
const BACKUP_CHECK_INTERVAL = 6 * 3600e3;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function parseCookies(header = '') {
  const cookies = {};
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator > 0) cookies[pair.slice(0, separator).trim()] = decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return cookies;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BODY) {
        reject(new HttpError(413, 'Datos demasiado grandes'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'JSON no válido')); }
    });
    req.on('error', reject);
  });
}

// Unknown paths fall back to index.html: the web app does its own routing.
function serveStatic(res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// Adds the response helpers that route handlers use (setCookie, sendJson, sendRaw, sendFile).
function addResponseHelpers(res) {
  const cookies = [];
  const withCookies = (headers) => (cookies.length ? { ...headers, 'Set-Cookie': cookies } : headers);

  res.setCookie = (name, value, maxAge) => {
    cookies.push(`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
  };
  res.sendJson = (status, data) => {
    res.writeHead(status, withCookies({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
    res.end(JSON.stringify(data));
  };
  res.sendRaw = (status, body, type, filename) => {
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
    if (filename) headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    res.writeHead(status, withCookies(headers));
    res.end(body);
  };
  res.sendFile = (file, type, filename, inline) => {
    const asciiName = filename.replace(/[^\x20-\x7e]|"/g, '_');
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': fs.statSync(file).size,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    fs.createReadStream(file).pipe(res);
  };
}

function matchRoute(method, pathname) {
  for (const route of routes) {
    const match = route.method === method && pathname.match(route.re);
    if (!match) continue;
    const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
    return { route, params };
  }
  throw new HttpError(404, 'Ruta no encontrada');
}

async function handleApi(req, res, url) {
  const { route, params } = matchRoute(req.method, url.pathname);

  const token = parseCookies(req.headers.cookie).sid;
  const user = auth.userFromToken(token);
  if (route.access !== 'public' && !user) throw new HttpError(401, 'Sesión caducada. Vuelve a entrar.');
  if (route.access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer esto');
  // Basic CSRF protection: a form on another site cannot set this header.
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'app') throw new HttpError(403, 'Petición no permitida');

  const hasJsonBody = !route.raw && ['POST', 'PUT', 'PATCH'].includes(req.method);
  const result = await route.handler({
    req, res, user, params, token,
    body: hasJsonBody ? await readJsonBody(req) : {},
    query: Object.fromEntries(url.searchParams),
    ip: req.socket.remoteAddress,
  });
  if (!res.headersSent) res.sendJson(200, result ?? { ok: true });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);

  addResponseHelpers(res);
  try {
    await handleApi(req, res, url);
  } catch (error) {
    const expected = error instanceof HttpError;
    if (!expected) console.error(error);
    if (res.headersSent) return;
    const status = expected ? error.status : 500;
    res.sendJson(status, { error: expected ? error.message : 'Error interno del servidor' });
    if (status === 413) req.destroy();
  }
});

server.listen(PORT, HOST, () => {
  const lanAddresses = Object.values(os.networkInterfaces()).flat()
    .filter(network => network && network.family === 'IPv4' && !network.internal)
    .map(network => network.address);
  console.log('\n  Movil City · Control de ventas');
  console.log(`  > En este equipo:     http://localhost:${PORT}`);
  lanAddresses.forEach(address => console.log(`  > En la red local:    http://${address}:${PORT}`));
  console.log('');
});

function dailyBackup() {
  try { backup(); } catch (error) { console.error('Error en copia de seguridad:', error.message); }
}
dailyBackup();
setInterval(dailyBackup, BACKUP_CHECK_INTERVAL).unref();

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
