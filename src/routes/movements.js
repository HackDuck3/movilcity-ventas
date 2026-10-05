'use strict';
// A movement is a sale or an expense. Permissions are enforced here, on the server:
// a worker never receives figures they are not allowed to see.
const { all, get, run } = require('../db');
const { getSetting } = require('../settings');
const { route, fail } = require('../http');
const { cents, euros, localDate, addDays, isDate, str, dateRange } = require('../utils');

const MOVEMENT_SELECT = `
  SELECT m.*, c.name AS category_name, c.color AS category_color, c.expense_type, u.name AS user_name
  FROM movements m
  LEFT JOIN categories c ON c.id = m.category_id
  LEFT JOIN users u ON u.id = m.user_id`;

const isAdmin = (user) => user.role === 'admin';

// Workers may only fix their own entries, and only for a few minutes after creating them.
function canEdit(movement, user, permissions) {
  if (movement.deleted_at) return false;
  if (isAdmin(user)) return true;
  if (movement.user_id !== user.id) return false;
  const minutesAllowed = Number(permissions.worker_edit_minutes) || 0;
  if (minutesAllowed <= 0) return false;
  const createdAt = new Date(String(movement.created_at).replace(' ', 'T'));
  return Date.now() - createdAt.getTime() <= minutesAllowed * 60e3;
}

function toResponse(movement, user, permissions) {
  const response = {
    id: movement.id, type: movement.type, date: movement.date,
    category_id: movement.category_id, category: movement.category_name, color: movement.category_color,
    description: movement.description, amount: euros(movement.amount), profit: euros(movement.profit),
    payment_method: movement.payment_method, user_id: movement.user_id, user: movement.user_name,
    invoice_id: movement.invoice_id, created_at: movement.created_at, deleted_at: movement.deleted_at || null,
    can_edit: canEdit(movement, user, permissions),
  };
  if (!isAdmin(user) && !permissions.worker_see_daily_profit) delete response.profit;
  return response;
}

// Daily cash register: the worker's main screen.
route('GET', '/api/day', 'user', ({ user, query }) => {
  const permissions = getSetting('permissions');
  const today = localDate();
  const date = isDate(query.date) ? query.date : today;
  if (!isAdmin(user)) {
    const oldestAllowed = addDays(today, -(Number(permissions.worker_history_days) || 0));
    if (date > today || date < oldestAllowed) fail(403, 'No tienes permiso para consultar ese día');
  }
  const allowed = (permission) => isAdmin(user) || !!permissions[permission];

  const rows = all(`${MOVEMENT_SELECT} WHERE m.date = ? AND m.deleted_at IS NULL ORDER BY m.created_at, m.id`, date);
  const sales = rows.filter(row => row.type === 'sale');
  let expenses = rows.filter(row => row.type === 'expense');
  if (!allowed('worker_see_daily_expenses')) expenses = expenses.filter(expense => expense.user_id === user.id);

  const sumCents = (list, field) => list.reduce((total, row) => total + row[field], 0);
  const totals = { sales_count: sales.length };
  if (allowed('worker_see_daily_sales')) {
    totals.sales = euros(sumCents(sales, 'amount'));
    const byMethod = {};
    for (const sale of sales) {
      const method = sale.payment_method || '—';
      byMethod[method] = (byMethod[method] || 0) + sale.amount;
    }
    totals.by_payment = Object.entries(byMethod).map(([method, amount]) => ({ method, amount: euros(amount) }));
  }
  if (allowed('worker_see_daily_profit')) totals.profit = euros(sumCents(sales, 'profit'));
  if (allowed('worker_see_daily_expenses')) {
    totals.expenses = euros(sumCents(expenses, 'amount'));
    if (totals.sales !== undefined) totals.balance = euros(sumCents(sales, 'amount') - sumCents(expenses, 'amount'));
  }

  return {
    date, today, totals,
    sales: sales.map(sale => toResponse(sale, user, permissions)),
    expenses: expenses.map(expense => toResponse(expense, user, permissions)),
  };
});

// Returns the clean values to store (amounts in cents). `existing` is set when editing.
function validateMovement(body, user, existing) {
  const permissions = getSetting('permissions');
  const type = existing ? existing.type : body.type;
  if (!['sale', 'expense'].includes(type)) fail(400, 'Tipo no válido');
  if (type === 'expense' && !isAdmin(user) && !permissions.worker_add_expenses) fail(403, 'No tienes permiso para registrar gastos');

  const category = get('SELECT * FROM categories WHERE id = ?', Number(body.category_id));
  if (!category || category.kind !== type) fail(400, 'Elige una categoría válida');

  const amount = cents(body.amount);
  if (!amount || amount <= 0) fail(400, 'El importe debe ser mayor que 0');

  let profit = 0;
  if (type === 'sale') {
    profit = cents(body.profit);
    if (profit === null) fail(400, 'Indica el beneficio (o el coste)');
    if (profit > amount) fail(400, 'El beneficio no puede ser mayor que el precio de venta');
  }

  const description = str(body.description, 300);
  const descriptionRequiredFrom = Number(getSetting('sales').require_description_over) || 0;
  if (type === 'sale' && descriptionRequiredFrom > 0 && amount >= descriptionRequiredFrom * 100 && !description) {
    fail(400, `Para ventas de ${descriptionRequiredFrom} € o más, añade una descripción (modelo, IMEI...)`);
  }

  // Only admins can back-date; workers always record on today's date.
  let date = localDate();
  if (isAdmin(user) && isDate(body.date)) date = body.date;
  else if (existing) date = existing.date;

  return { type, category_id: category.id, amount, profit, description, date, payment_method: str(body.payment_method, 40) };
}

function findEditable(id, user, deniedMessage) {
  const movement = get('SELECT * FROM movements WHERE id = ?', Number(id));
  if (!movement) fail(404, 'No encontrado');
  if (!canEdit(movement, user, getSetting('permissions'))) fail(403, deniedMessage);
  return movement;
}

route('POST', '/api/movements', 'user', ({ user, body }) => {
  const m = validateMovement(body, user);
  const { id } = run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id)
                      VALUES (?,?,?,?,?,?,?,?)`,
    m.type, m.date, m.category_id, m.description, m.amount, m.profit, m.payment_method, user.id);
  return { ok: true, id };
});

route('PUT', '/api/movements/:id', 'user', ({ user, body, params }) => {
  const existing = findEditable(params.id, user, 'Ya no puedes modificar este apunte. Pide al administrador que lo corrija.');
  const m = validateMovement(body, user, existing);
  run(`UPDATE movements SET date=?, category_id=?, description=?, amount=?, profit=?, payment_method=?,
       updated_at=datetime('now','localtime'), updated_by=? WHERE id=?`,
    m.date, m.category_id, m.description, m.amount, m.profit, m.payment_method, user.id, existing.id);
  return { ok: true };
});

// Soft delete: the row stays, with who deleted it and when, for auditing.
route('DELETE', '/api/movements/:id', 'user', ({ user, params }) => {
  const existing = findEditable(params.id, user, 'Ya no puedes borrar este apunte. Pide al administrador que lo haga.');
  run(`UPDATE movements SET deleted_at = datetime('now','localtime'), deleted_by = ? WHERE id = ?`, user.id, existing.id);
  return { ok: true };
});

route('GET', '/api/admin/movements', 'admin', ({ user, query }) => {
  const { from, to } = dateRange(query);
  const conditions = ['m.date BETWEEN ? AND ?'];
  const values = [from, to];
  const filter = (condition, value) => { conditions.push(condition); values.push(value); };

  if (['sale', 'expense'].includes(query.type)) filter('m.type = ?', query.type);
  if (query.category_id) filter('m.category_id = ?', Number(query.category_id));
  if (query.user_id) filter('m.user_id = ?', Number(query.user_id));
  if (query.q) filter('m.description LIKE ?', `%${query.q}%`);
  conditions.push(query.deleted === '1' ? 'm.deleted_at IS NOT NULL' : 'm.deleted_at IS NULL');

  const rows = all(`SELECT m.*, c.name AS category_name, c.color AS category_color, c.expense_type,
                           u.name AS user_name, deleter.name AS deleted_by_name
                    FROM movements m
                    LEFT JOIN categories c ON c.id = m.category_id
                    LEFT JOIN users u ON u.id = m.user_id
                    LEFT JOIN users deleter ON deleter.id = m.deleted_by
                    WHERE ${conditions.join(' AND ')} ORDER BY m.date DESC, m.created_at DESC LIMIT 2000`, ...values);
  const permissions = getSetting('permissions');
  return rows.map(row => ({
    ...toResponse(row, user, permissions),
    deleted_by: row.deleted_by_name || null,
    expense_type: row.expense_type,
  }));
});

route('POST', '/api/admin/movements/:id/restore', 'admin', ({ params }) => {
  run('UPDATE movements SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', Number(params.id));
  return { ok: true };
});

// Records a sale on behalf of another feature (repairs, stock) and returns its id.
function recordSale(sale, user) {
  const m = validateMovement({ ...sale, type: 'sale' }, user);
  return run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id)
              VALUES (?,?,?,?,?,?,?,?)`,
    'sale', m.date, m.category_id, m.description, m.amount, m.profit, m.payment_method, user.id).id;
}

module.exports = { MOVEMENT_SELECT, validateMovement, recordSale };
