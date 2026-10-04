'use strict';
const { all, get, run } = require('../db');
const auth = require('../auth');
const { route, fail } = require('../http');
const { str } = require('../utils');

const MIN_PASSWORD_LENGTH = 4; // workers may use a 4-digit PIN

function requireValidPassword(password) {
  if (String(password || '').length < MIN_PASSWORD_LENGTH) fail(400, 'La contraseña/PIN debe tener al menos 4 caracteres');
}

route('GET', '/api/admin/users', 'admin', () =>
  all('SELECT id, username, name, role, active, created_at FROM users ORDER BY role, name'));

route('POST', '/api/admin/users', 'admin', ({ body }) => {
  const username = str(body.username, 40);
  const name = str(body.name, 80) || username;
  if (!username) fail(400, 'El usuario es obligatorio');
  requireValidPassword(body.password);
  if (get('SELECT 1 AS found FROM users WHERE username = ?', username)) fail(400, 'Ese nombre de usuario ya existe');

  const role = body.role === 'admin' ? 'admin' : 'worker';
  const { id } = run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)',
    username, name, auth.hashPassword(body.password), role);
  return { ok: true, id };
});

route('PUT', '/api/admin/users/:id', 'admin', ({ body, params, user: currentUser }) => {
  const target = get('SELECT * FROM users WHERE id = ?', Number(params.id));
  if (!target) fail(404, 'Usuario no encontrado');

  const role = ['admin', 'worker'].includes(body.role) ? body.role : target.role;
  const active = 'active' in body ? (body.active ? 1 : 0) : target.active;
  const isSelf = target.id === currentUser.id;
  if (isSelf && (role !== 'admin' || !active)) fail(400, 'No puedes quitarte el rol de administrador ni desactivarte');
  if (body.password) requireValidPassword(body.password);

  run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?',
    str(body.name ?? target.name, 80) || target.username, role, active, target.id);
  if (body.password) {
    run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(body.password), target.id);
    if (!isSelf) run('DELETE FROM sessions WHERE user_id = ?', target.id);
  }
  if (!active) run('DELETE FROM sessions WHERE user_id = ?', target.id);
  return { ok: true };
});
