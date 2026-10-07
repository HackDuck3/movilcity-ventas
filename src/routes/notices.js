'use strict';
// Notices: documents the shop writes once and prints when needed (policies, price lists, announcements).
// Everyone can read and print them; only admins write them.
const { all, get, run } = require('../db');
const { getSetting } = require('../settings');
const { route, fail } = require('../http');
const { str } = require('../utils');

const MAX_BODY_LENGTH = 20000;

function requireModule() {
  if (!getSetting('modules').notices) fail(403, 'El módulo de comunicados está desactivado');
}

function findNotice(id) {
  const notice = get('SELECT * FROM notices WHERE id = ?', Number(id));
  if (!notice) fail(404, 'Comunicado no encontrado');
  return notice;
}

function fieldsFromBody(body) {
  const fields = {
    title: str(body.title, 120),
    subtitle: str(body.subtitle, 160),
    body: String(body.body ?? '').slice(0, MAX_BODY_LENGTH),
  };
  if (!fields.title) fail(400, 'Ponle un título al comunicado');
  return fields;
}

route('GET', '/api/notices', 'user', () => {
  requireModule();
  return all('SELECT id, title, subtitle, updated_at FROM notices ORDER BY title COLLATE NOCASE');
});

route('GET', '/api/notices/:id', 'user', ({ params }) => {
  requireModule();
  return findNotice(params.id);
});

route('POST', '/api/admin/notices', 'admin', ({ user, body }) => {
  requireModule();
  const f = fieldsFromBody(body);
  const { id } = run('INSERT INTO notices (title, subtitle, body, user_id) VALUES (?,?,?,?)', f.title, f.subtitle, f.body, user.id);
  return { ok: true, id };
});

route('PUT', '/api/admin/notices/:id', 'admin', ({ params, body }) => {
  const notice = findNotice(params.id);
  const f = fieldsFromBody(body);
  run("UPDATE notices SET title = ?, subtitle = ?, body = ?, updated_at = datetime('now','localtime') WHERE id = ?",
    f.title, f.subtitle, f.body, notice.id);
  return { ok: true };
});

route('DELETE', '/api/admin/notices/:id', 'admin', ({ params }) => {
  run('DELETE FROM notices WHERE id = ?', findNotice(params.id).id);
  return { ok: true };
});
