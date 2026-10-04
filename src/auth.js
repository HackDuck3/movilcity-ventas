'use strict';
const crypto = require('node:crypto');
const { get, run } = require('./db');

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 86400e3;
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', token, userId, expires);
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return { token, maxAge: SESSION_DAYS * 86400 };
}

function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

function userFromToken(token) {
  if (!token) return null;
  const row = get(`SELECT u.id, u.username, u.name, u.role, u.active, s.expires_at
                   FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token);
  if (!row || !row.active || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}

// Limitador simple de intentos de login (por IP)
const attempts = new Map();
function tooManyAttempts(ip) {
  const a = attempts.get(ip);
  if (!a) return false;
  if (Date.now() - a.first > 15 * 60e3) { attempts.delete(ip); return false; }
  return a.count >= 10;
}
function registerFailure(ip) {
  const a = attempts.get(ip) || { count: 0, first: Date.now() };
  a.count++; attempts.set(ip, a);
}
function clearFailures(ip) { attempts.delete(ip); }

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession, userFromToken,
  tooManyAttempts, registerFailure, clearFailures,
};
