'use strict';
const { get, run } = require('../db');
const { getSetting, setSetting, allSettings } = require('../settings');
const auth = require('../auth');
const { route, fail } = require('../http');
const { str, localDate } = require('../utils');

const adminExists = () => !!get('SELECT 1 AS found FROM users WHERE role = ? LIMIT 1', 'admin');

function startSession(res, userId) {
  const session = auth.createSession(userId);
  res.setCookie('sid', session.token, session.maxAge);
}

route('GET', '/api/status', 'public', () => {
  const { shop, appearance } = allSettings();
  return { needsSetup: !adminExists(), shop: { name: shop.name, logo: shop.logo }, appearance };
});

route('POST', '/api/setup', 'public', ({ body, res }) => {
  if (adminExists()) fail(400, 'La aplicación ya está configurada');
  const username = str(body.username, 40);
  const name = str(body.name, 80) || username;
  const password = String(body.password || '');
  if (!username || password.length < 6) fail(400, 'Usuario obligatorio y contraseña de al menos 6 caracteres');

  const { id } = run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)',
    username, name, auth.hashPassword(password), 'admin');
  if (body.shopName) setSetting('shop', { ...getSetting('shop'), name: str(body.shopName, 80) });
  startSession(res, id);
  return { ok: true };
});

route('POST', '/api/login', 'public', ({ body, res, ip }) => {
  if (auth.tooManyAttempts(ip)) fail(429, 'Demasiados intentos. Espera 15 minutos.');
  const user = get('SELECT * FROM users WHERE username = ?', str(body.username, 40));
  if (!user || !user.active || !auth.verifyPassword(body.password || '', user.password_hash)) {
    auth.registerFailure(ip);
    fail(401, 'Usuario o contraseña incorrectos');
  }
  auth.clearFailures(ip);
  startSession(res, user.id);
  return { ok: true };
});

route('POST', '/api/logout', 'public', ({ token, res }) => {
  auth.destroySession(token);
  res.setCookie('sid', '', 0);
  return { ok: true };
});

route('GET', '/api/me', 'user', ({ user }) => ({ user, settings: allSettings(), today: localDate() }));

route('POST', '/api/me/password', 'user', ({ user, body }) => {
  const { password_hash: currentHash } = get('SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!auth.verifyPassword(body.current || '', currentHash)) fail(400, 'La contraseña actual no es correcta');
  if (String(body.password || '').length < 4) fail(400, 'La nueva contraseña es demasiado corta');
  run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(body.password), user.id);
  return { ok: true };
});
