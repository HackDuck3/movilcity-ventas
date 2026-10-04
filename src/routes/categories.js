'use strict';
const { all, get, run, tx } = require('../db');
const { route, fail } = require('../http');
const { cents, euros, str, isColor } = require('../utils');

const DEFAULT_COLOR = '#64748b';
const eurosOrNull = (amount) => (amount == null ? null : euros(amount));

route('GET', '/api/categories', 'user', ({ user, query }) => {
  const includeInactive = user.role === 'admin' && query.all === '1';
  const rows = all(`SELECT * FROM categories ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY kind, favorite DESC, sort, name`);
  return rows.map(category => ({
    ...category,
    default_price: eurosOrNull(category.default_price),
    default_profit: eurosOrNull(category.default_profit),
  }));
});

// Fields missing from the request keep the value they already had.
function categoryFromBody(body, existing = {}) {
  const kind = existing.kind || (body.kind === 'expense' ? 'expense' : 'sale');
  const name = str(body.name ?? existing.name, 60);
  if (!name) fail(400, 'El nombre es obligatorio');

  let expenseType = null;
  if (kind === 'expense') {
    expenseType = ['stock', 'operating'].includes(body.expense_type) ? body.expense_type : existing.expense_type || 'operating';
  }
  const flag = (field, fallback) => (field in body ? (body[field] ? 1 : 0) : existing[field] ?? fallback);

  return {
    kind, name,
    color: isColor(body.color) ? body.color : existing.color || DEFAULT_COLOR,
    expense_type: expenseType,
    default_price: 'default_price' in body ? cents(body.default_price) : existing.default_price ?? null,
    default_profit: 'default_profit' in body ? cents(body.default_profit) : existing.default_profit ?? null,
    warranty: kind === 'sale' ? str(body.warranty ?? existing.warranty, 60) : '',
    favorite: flag('favorite', 0),
    active: flag('active', 1),
  };
}

route('POST', '/api/admin/categories', 'admin', ({ body }) => {
  const c = categoryFromBody(body);
  const sort = (get('SELECT MAX(sort) AS last FROM categories WHERE kind = ?', c.kind).last || 0) + 1;
  const { id } = run(`INSERT INTO categories (kind, name, color, expense_type, default_price, default_profit, favorite, active, sort, warranty)
                      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    c.kind, c.name, c.color, c.expense_type, c.default_price, c.default_profit, c.favorite, c.active, sort, c.warranty);
  return { ok: true, id };
});

route('PUT', '/api/admin/categories/:id', 'admin', ({ body, params }) => {
  const existing = get('SELECT * FROM categories WHERE id = ?', Number(params.id));
  if (!existing) fail(404, 'No encontrada');
  const c = categoryFromBody(body, existing);
  run(`UPDATE categories SET name=?, color=?, expense_type=?, default_price=?, default_profit=?, favorite=?, active=?, warranty=? WHERE id=?`,
    c.name, c.color, c.expense_type, c.default_price, c.default_profit, c.favorite, c.active, c.warranty, existing.id);
  return { ok: true };
});

route('POST', '/api/admin/categories/reorder', 'admin', ({ body }) => {
  const ids = Array.isArray(body.ids) ? body.ids : [];
  tx(() => ids.forEach((id, position) => run('UPDATE categories SET sort = ? WHERE id = ?', position, Number(id))));
  return { ok: true };
});
