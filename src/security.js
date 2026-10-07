'use strict';
// Verification codes for printed documents.
// A code is an HMAC of the document's key data with a secret that never leaves the server, so nobody
// can make up a valid code for a document the shop did not issue, or reuse one after changing the amount.
const crypto = require('node:crypto');
const { get, run } = require('./db');

// Stored in the settings table but outside DEFAULT_SETTINGS, so the API never sends it to a browser.
const SECRET_KEY = 'secret:document-codes';
// Crockford base32: no I, L, O or U, so a code read from paper is hard to mistype.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;

function secret() {
  const row = get('SELECT value FROM settings WHERE key = ?', SECRET_KEY);
  if (row) return JSON.parse(row.value);
  const value = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO settings (key, value) VALUES (?, ?)', SECRET_KEY, JSON.stringify(value));
  return value;
}

const grouped = (characters) => characters.match(/.{1,4}/g).join('-');

// parts: the values that identify the document and must not be altered (number, date, total...).
function documentCode(parts) {
  const digest = crypto.createHmac('sha256', secret()).update(parts.join('|')).digest();
  let characters = '';
  for (let i = 0; i < CODE_LENGTH; i++) characters += ALPHABET[digest[i] % ALPHABET.length];
  return grouped(characters);
}

// Accepts a code as a person would type it: any case, with or without dashes, O for 0 and I/L for 1.
// Returns null when it cannot be a code.
function normalizeCode(text) {
  const characters = String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
  const isValid = characters.length === CODE_LENGTH && [...characters].every(character => ALPHABET.includes(character));
  return isValid ? grouped(characters) : null;
}

module.exports = { documentCode, normalizeCode };
