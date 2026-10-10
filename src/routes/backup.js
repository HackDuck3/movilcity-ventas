'use strict';
// The encrypted full copy: downloaded by the admin, or fetched by another computer with a token
// so that a copy leaves the server every day. See docs/COPIAS.md.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { get, run, backupToTemp, FILES_DIR, ID_DOCUMENTS_DIR } = require('../db');
const { route, fail } = require('../http');
const { str, localDate } = require('../utils');
const { encryptedArchive } = require('../full-backup');

const MIN_PASSPHRASE_LENGTH = 10;
// Kept out of the regular settings, which every logged-in user receives.
const SECRETS_KEY = 'secret:backup';

function readSecrets() {
  const row = get('SELECT value FROM settings WHERE key = ?', SECRETS_KEY);
  return row ? JSON.parse(row.value) : { passphrase: '', token: '', last_fetched_at: null };
}

function writeSecrets(secrets) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    SECRETS_KEY, JSON.stringify(secrets));
}

const statusOf = (secrets) => ({
  has_passphrase: !!secrets.passphrase,
  token: secrets.token,
  last_fetched_at: secrets.last_fetched_at,
});

function sendArchive(res, passphrase) {
  const snapshot = backupToTemp();
  const removeSnapshot = () => fs.rm(snapshot, { force: true }, () => {});
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="movilcity-${localDate()}.mcbackup"`,
  });
  encryptedArchive({ database: snapshot, folders: { files: FILES_DIR, 'id-documents': ID_DOCUMENTS_DIR }, passphrase })
    .on('error', (error) => { console.error('Error en la copia completa:', error.message); res.destroy(); })
    .pipe(res)
    .on('close', removeSnapshot);
}

route('GET', '/api/admin/backup/status', 'admin', () => statusOf(readSecrets()));

// body: { passphrase } sets or changes the password; { new_token: true } replaces the token.
route('PUT', '/api/admin/backup/settings', 'admin', ({ body }) => {
  const secrets = readSecrets();
  if ('passphrase' in body) {
    const passphrase = str(body.passphrase, 200);
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) fail(400, `La contraseña de las copias necesita al menos ${MIN_PASSPHRASE_LENGTH} caracteres`);
    secrets.passphrase = passphrase;
  }
  if (body.new_token || !secrets.token) secrets.token = crypto.randomBytes(24).toString('hex');
  writeSecrets(secrets);
  return statusOf(secrets);
});

route('GET', '/api/admin/backup/full', 'admin', ({ res }) => {
  const { passphrase } = readSecrets();
  if (!passphrase) fail(400, 'Primero pon una contraseña para las copias');
  sendArchive(res, passphrase);
});

// For the computer that keeps the copies: no session, only the token. What it gets is already encrypted.
route('GET', '/api/backup/full', 'public', ({ req, res }) => {
  const secrets = readSecrets();
  const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(secrets.token || '');
  const authorized = secrets.passphrase && expected.length && given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!authorized) fail(401, 'Token no válido');
  writeSecrets({ ...secrets, last_fetched_at: new Date().toISOString() });
  sendArchive(res, secrets.passphrase);
});
