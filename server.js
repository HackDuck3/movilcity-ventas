#!/usr/bin/env node
'use strict';
// Dependency-free HTTP server: serves the web app from public/ and the JSON API under /api/.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

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

// Files from public/ are kept in memory with their gzip and brotli versions, so each one is read and
// compressed once instead of on every request. The ETag lets browsers revalidate with a 304 instead of
// downloading the file again. An entry is rebuilt when the file on disk changes.
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest']);
const staticCache = new Map();

function loadStatic(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  if (stat.isDirectory()) return null;
  const cached = staticCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
  const body = fs.readFileSync(file);
  const extension = path.extname(file);
  const entry = {
    mtimeMs: stat.mtimeMs, size: stat.size, body,
    type: MIME_TYPES[extension] || 'application/octet-stream',
    etag: `"${crypto.createHash('sha1').update(body).digest('base64url')}"`,
  };
  if (COMPRESSIBLE.has(extension)) {
    entry.br = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
    entry.gzip = zlib.gzipSync(body, { level: 9 });
  }
  staticCache.set(file, entry);
  return entry;
}

// Unknown paths fall back to index.html: the web app does its own routing.
function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    return res.end(); // a malformed %-sequence, usually a bot probing the server
  }
  const file = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  const entry = loadStatic(file) || loadStatic(path.join(PUBLIC_DIR, 'index.html'));
  const headers = {
    'Content-Type': entry.type,
    'Cache-Control': 'no-cache',
    'ETag': entry.etag,
    'Vary': 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const accepted = String(req.headers['accept-encoding'] || '');
  let body = entry.body;
  if (entry.br && /\bbr\b/.test(accepted)) { body = entry.br; headers['Content-Encoding'] = 'br'; }
  else if (entry.gzip && /\bgzip\b/.test(accepted)) { body = entry.gzip; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// A read error must end this one response, not the whole process.
function streamFile(file, res) {
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
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
    streamFile(file, res);
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
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

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
