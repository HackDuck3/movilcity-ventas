'use strict';
// Shop documents (supplier invoices, contracts...). Admin only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { all, get, run, FILES_DIR } = require('../db');
const { getSetting } = require('../settings');
const { route, fail, HttpError } = require('../http');
const { str } = require('../utils');

const DEFAULT_FOLDER = 'General';
const DEFAULT_NAME = 'archivo';
const MB = 1024 * 1024;
// Only these types open inside the browser; anything else downloads, so uploaded HTML can never run.
const SAFE_INLINE_TYPES = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain)$/;

const safeFileName = (name) => str(name, 200).replace(/[\\/\x00-\x1f]/g, '_');

function decodeHeader(value, fallback) {
  try { return decodeURIComponent(String(value || '')) || fallback; } catch { return fallback; }
}

function findFile(id) {
  const file = get('SELECT * FROM files WHERE id = ?', Number(id));
  if (!file) fail(404, 'Archivo no encontrado');
  return file;
}

const removeFromDisk = (storedName) => fs.rm(path.join(FILES_DIR, storedName), { force: true }, () => {});

route('GET', '/api/admin/files', 'admin', ({ query }) => {
  const conditions = ['1=1'];
  const values = [];
  if (query.folder) {
    conditions.push('f.folder = ?');
    values.push(query.folder);
  }
  if (query.q) {
    conditions.push('(f.name LIKE ? OR f.note LIKE ?)');
    values.push(`%${query.q}%`, `%${query.q}%`);
  }
  const files = all(`SELECT f.id, f.name, f.folder, f.mime, f.size, f.note, f.created_at, u.name AS uploaded_by
                     FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
                     WHERE ${conditions.join(' AND ')} ORDER BY f.created_at DESC, f.id DESC`, ...values);
  const folders = all('SELECT folder, COUNT(*) AS n, SUM(size) AS size FROM files GROUP BY folder ORDER BY folder');
  const total = get('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS size FROM files');
  return { files, folders, total };
});

// The request body is the raw file; it is streamed straight to disk. Name and folder travel in headers.
route('POST', '/api/admin/files', 'admin', ({ req, user }) => new Promise((resolve, reject) => {
  const maxBytes = (Number(getSetting('files').max_mb) || 50) * MB;
  const tooLarge = () => new HttpError(413, `El archivo supera el máximo de ${maxBytes / MB} MB`);
  if (Number(req.headers['content-length'] || 0) > maxBytes) return reject(tooLarge());

  const name = safeFileName(decodeHeader(req.headers['x-file-name'], DEFAULT_NAME)) || DEFAULT_NAME;
  const folder = str(decodeHeader(req.headers['x-folder'], DEFAULT_FOLDER), 80) || DEFAULT_FOLDER;
  const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].slice(0, 100);
  const extension = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
  const storedName = crypto.randomBytes(16).toString('hex') + extension;

  const output = fs.createWriteStream(path.join(FILES_DIR, storedName), { flags: 'wx' });
  let size = 0;
  let aborted = false;
  const abort = (error) => {
    if (aborted) return;
    aborted = true;
    output.destroy();
    removeFromDisk(storedName);
    reject(error);
  };

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxBytes) {
      abort(tooLarge());
      req.resume();
    }
  });
  req.on('error', abort);
  output.on('error', abort);
  output.on('finish', () => {
    if (aborted) return;
    if (!size) return abort(new HttpError(400, 'El archivo está vacío'));
    const { id } = run('INSERT INTO files (name, folder, mime, size, stored_name, uploaded_by) VALUES (?,?,?,?,?,?)',
      name, folder, mime, size, storedName, user.id);
    resolve({ ok: true, id });
  });
  req.pipe(output);
}), { raw: true });

route('GET', '/api/admin/files/:id/download', 'admin', ({ params, query, res }) => {
  const file = findFile(params.id);
  const diskPath = path.join(FILES_DIR, file.stored_name);
  if (!fs.existsSync(diskPath)) fail(404, 'El archivo no está en el disco');
  const safeInline = SAFE_INLINE_TYPES.test(file.mime);
  res.sendFile(diskPath, safeInline ? file.mime : 'application/octet-stream', file.name, query.inline === '1' && safeInline);
});

route('PUT', '/api/admin/files/:id', 'admin', ({ params, body }) => {
  const file = findFile(params.id);
  run('UPDATE files SET name = ?, folder = ?, note = ? WHERE id = ?',
    safeFileName(body.name ?? file.name) || file.name,
    str(body.folder ?? file.folder, 80) || DEFAULT_FOLDER,
    str(body.note ?? file.note, 500),
    file.id);
  return { ok: true };
});

route('DELETE', '/api/admin/files/:id', 'admin', ({ params }) => {
  const file = findFile(params.id);
  run('DELETE FROM files WHERE id = ?', file.id);
  removeFromDisk(file.stored_name);
  return { ok: true };
});
