#!/usr/bin/env node
'use strict';
// Movil City · Control de ventas
// Servidor HTTP sin dependencias externas. Arranca con:  node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { backup } = require('./src/db');
const { routes, HttpError } = require('./src/api');
const auth = require('./src/auth');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 4 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Datos demasiado grandes')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'JSON no válido')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const cookies = [];
  res.setCookie = (name, value, maxAge) => {
    cookies.push(`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
  };
  res.sendRaw = (status, body, type, filename) => {
    const h = { 'Content-Type': type, 'Cache-Control': 'no-store' };
    if (filename) h['Content-Disposition'] = `attachment; filename="${filename}"`;
    if (cookies.length) h['Set-Cookie'] = cookies;
    res.writeHead(status, h); res.end(body); res.sent = true;
  };
  res.sendFile = (file, type, filename, inline) => {
    const stat = fs.statSync(file);
    const h = { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}` };
    res.writeHead(200, h); fs.createReadStream(file).pipe(res); res.sent = true;
  };
  const sendJSON = (status, data) => {
    const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (cookies.length) h['Set-Cookie'] = cookies;
    res.writeHead(status, h); res.end(JSON.stringify(data));
  };

  try {
    const r = routes.find(r => r.method === req.method && r.re.test(pathname));
    if (!r) throw new HttpError(404, 'Ruta no encontrada');
    const m = pathname.match(r.re); const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

    const token = parseCookies(req.headers.cookie).sid;
    const user = auth.userFromToken(token);
    if (r.access !== 'public' && !user) throw new HttpError(401, 'Sesión caducada. Vuelve a entrar.');
    if (r.access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer esto');
    // protección CSRF básica: las peticiones que modifican datos deben venir de la propia app
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'app') throw new HttpError(403, 'Petición no permitida');

    const body = !r.raw && ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const ip = req.socket.remoteAddress;
    const query = Object.fromEntries(url.searchParams);
    const result = await r.handler({ req, res, user, body, params, query, token, ip });
    if (!res.sent) sendJSON(200, result ?? { ok: true });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    const status = err instanceof HttpError ? err.status : 500;
    if (!res.headersSent) {
      sendJSON(status, { error: err instanceof HttpError ? err.message : 'Error interno del servidor' });
      if (status === 413) req.destroy(); // corta la subida de un archivo demasiado grande
    }
  }
});

server.listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  Movil City · Control de ventas');
  console.log(`  > En este equipo:     http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  > En la red local:    http://${ip}:${PORT}`));
  console.log('');
});

// Copia de seguridad diaria automática (data/backups, se guardan 30 días)
const doBackup = () => { try { backup(); } catch (e) { console.error('Error en copia de seguridad:', e.message); } };
doBackup();
setInterval(doBackup, 6 * 3600e3).unref();

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
