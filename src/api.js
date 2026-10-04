'use strict';
// API REST. Toda la lógica de permisos se aplica AQUÍ (en el servidor):
// el trabajador nunca recibe datos que no deba ver, aunque inspeccione la web.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, all, get, run, tx, getSetting, setSetting, allSettings, DEFAULT_SETTINGS, backupToTemp, FILES_DIR } = require('./db');

const auth = require('./auth');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };

// ---------------------------------------------------------------- utilidades
const cents = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s|€/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};
const euros = (c) => Math.round(Number(c || 0)) / 100;
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localDate(d); };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const isColor = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

function movementOut(m, user, perms) {
  const out = {
    id: m.id, type: m.type, date: m.date, category_id: m.category_id, category: m.category_name,
    color: m.category_color, description: m.description, amount: euros(m.amount), profit: euros(m.profit),
    payment_method: m.payment_method, user_id: m.user_id, user: m.user_name, invoice_id: m.invoice_id,
    created_at: m.created_at, deleted_at: m.deleted_at || null,
  };
  if (user.role !== 'admin' && !perms.worker_see_daily_profit) delete out.profit;
  out.can_edit = canEdit(m, user, perms);
  return out;
}

function canEdit(m, user, perms) {
  if (m.deleted_at) return false;
  if (user.role === 'admin') return true;
  if (m.user_id !== user.id) return false;
  const mins = Number(perms.worker_edit_minutes) || 0;
  if (mins <= 0) return false;
  const created = new Date(String(m.created_at).replace(' ', 'T'));
  return Date.now() - created.getTime() <= mins * 60e3;
}

const MOV_SELECT = `
  SELECT m.*, c.name AS category_name, c.color AS category_color, c.expense_type,
         u.name AS user_name
  FROM movements m
  LEFT JOIN categories c ON c.id = m.category_id
  LEFT JOIN users u ON u.id = m.user_id`;

function publicSettings() {
  const s = allSettings();
  return s; // ninguno de estos ajustes contiene cifras de negocio
}

// ---------------------------------------------------------------- rutas
const routes = [];
const route = (method, path, access, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, access, handler, raw: !!opts.raw });
};

// ---- Estado / instalación / sesión
route('GET', '/api/status', 'public', () => {
  const needsSetup = !get('SELECT 1 AS x FROM users WHERE role = ? LIMIT 1', 'admin');
  const s = allSettings();
  return { needsSetup, shop: { name: s.shop.name, logo: s.shop.logo }, appearance: s.appearance };
});

route('POST', '/api/setup', 'public', ({ body, res }) => {
  if (get('SELECT 1 AS x FROM users WHERE role = ? LIMIT 1', 'admin')) fail(400, 'La aplicación ya está configurada');
  const username = str(body.username, 40), name = str(body.name, 80) || username, password = String(body.password || '');
  if (!username || password.length < 6) fail(400, 'Usuario obligatorio y contraseña de al menos 6 caracteres');
  const { id } = run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)',
    username, name, auth.hashPassword(password), 'admin');
  if (body.shopName) setSetting('shop', { ...getSetting('shop'), name: str(body.shopName, 80) });
  const s = auth.createSession(id);
  res.setCookie('sid', s.token, s.maxAge);
  return { ok: true };
});

route('POST', '/api/login', 'public', ({ body, res, ip }) => {
  if (auth.tooManyAttempts(ip)) fail(429, 'Demasiados intentos. Espera 15 minutos.');
  const u = get('SELECT * FROM users WHERE username = ?', str(body.username, 40));
  if (!u || !u.active || !auth.verifyPassword(body.password || '', u.password_hash)) {
    auth.registerFailure(ip);
    fail(401, 'Usuario o contraseña incorrectos');
  }
  auth.clearFailures(ip);
  const s = auth.createSession(u.id);
  res.setCookie('sid', s.token, s.maxAge);
  return { ok: true };
});

route('POST', '/api/logout', 'public', ({ token, res }) => {
  auth.destroySession(token);
  res.setCookie('sid', '', 0);
  return { ok: true };
});

route('GET', '/api/me', 'user', ({ user }) => ({ user, settings: publicSettings(), today: localDate() }));

route('POST', '/api/me/password', 'user', ({ user, body }) => {
  const u = get('SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!auth.verifyPassword(body.current || '', u.password_hash)) fail(400, 'La contraseña actual no es correcta');
  if (String(body.password || '').length < 4) fail(400, 'La nueva contraseña es demasiado corta');
  run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(body.password), user.id);
  return { ok: true };
});

// ---- Categorías
route('GET', '/api/categories', 'user', ({ user, query }) => {
  const showAll = user.role === 'admin' && query.all === '1';
  const rows = all(`SELECT * FROM categories ${showAll ? '' : 'WHERE active = 1'} ORDER BY kind, favorite DESC, sort, name`);
  return rows.map(c => ({ ...c, default_price: c.default_price == null ? null : euros(c.default_price),
    default_profit: c.default_profit == null ? null : euros(c.default_profit) }));
});

// ---- Caja del día (pantalla principal del trabajador)
route('GET', '/api/day', 'user', ({ user, query }) => {
  const perms = getSetting('permissions');
  const today = localDate();
  const date = isDate(query.date) ? query.date : today;
  if (user.role !== 'admin') {
    const minDate = addDays(today, -(Number(perms.worker_history_days) || 0));
    if (date > today || date < minDate) fail(403, 'No tienes permiso para consultar ese día');
  }
  const rows = all(`${MOV_SELECT} WHERE m.date = ? AND m.deleted_at IS NULL ORDER BY m.created_at, m.id`, date);
  const sales = rows.filter(r => r.type === 'sale');
  let expenses = rows.filter(r => r.type === 'expense');
  const isAdmin = user.role === 'admin';
  if (!isAdmin && !perms.worker_see_daily_expenses) expenses = expenses.filter(e => e.user_id === user.id);

  const sum = (arr, k) => euros(arr.reduce((a, r) => a + r[k], 0));
  const totals = { sales_count: sales.length };
  if (isAdmin || perms.worker_see_daily_sales) totals.sales = sum(sales, 'amount');
  if (isAdmin || perms.worker_see_daily_profit) totals.profit = sum(sales, 'profit');
  if (isAdmin || perms.worker_see_daily_expenses) {
    totals.expenses = sum(expenses, 'amount');
    if (totals.sales !== undefined) totals.balance = euros(Math.round(totals.sales * 100) - Math.round(totals.expenses * 100));
  }
  // desglose por método de pago (útil para cuadrar la caja)
  if (isAdmin || perms.worker_see_daily_sales) {
    const pm = {};
    for (const s of sales) pm[s.payment_method || '—'] = (pm[s.payment_method || '—'] || 0) + s.amount;
    totals.by_payment = Object.entries(pm).map(([k, v]) => ({ method: k, amount: euros(v) }));
  }
  return {
    date, today, totals,
    sales: sales.map(m => movementOut(m, user, perms)),
    expenses: expenses.map(m => movementOut(m, user, perms)),
  };
});

function validateMovement(body, user, existing) {
  const perms = getSetting('permissions');
  const salesCfg = getSetting('sales');
  const type = existing ? existing.type : body.type;
  if (!['sale', 'expense'].includes(type)) fail(400, 'Tipo no válido');
  if (type === 'expense' && user.role !== 'admin' && !perms.worker_add_expenses) fail(403, 'No tienes permiso para registrar gastos');
  const cat = get('SELECT * FROM categories WHERE id = ?', Number(body.category_id));
  if (!cat || cat.kind !== type) fail(400, 'Elige una categoría válida');
  const amount = cents(body.amount);
  if (!amount || amount <= 0) fail(400, 'El importe debe ser mayor que 0');
  let profit = 0;
  if (type === 'sale') {
    profit = cents(body.profit);
    if (profit === null) fail(400, 'Indica el beneficio (o el coste)');
    if (profit > amount) fail(400, 'El beneficio no puede ser mayor que el precio de venta');
  }
  const description = str(body.description, 300);
  const reqOver = Number(salesCfg.require_description_over) || 0;
  if (type === 'sale' && reqOver > 0 && amount >= reqOver * 100 && !description)
    fail(400, `Para ventas de ${reqOver} € o más, añade una descripción (modelo, IMEI...)`);
  let date = localDate();
  if (user.role === 'admin' && isDate(body.date)) date = body.date;
  if (existing && user.role !== 'admin') date = existing.date;
  return { type, category_id: cat.id, amount, profit, description, date, payment_method: str(body.payment_method, 40) };
}

route('POST', '/api/movements', 'user', ({ user, body }) => {
  const m = validateMovement(body, user);
  const { id } = run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id)
                      VALUES (?,?,?,?,?,?,?,?)`, m.type, m.date, m.category_id, m.description, m.amount, m.profit, m.payment_method, user.id);
  return { ok: true, id };
});

route('PUT', '/api/movements/:id', 'user', ({ user, body, params }) => {
  const perms = getSetting('permissions');
  const existing = get('SELECT * FROM movements WHERE id = ?', Number(params.id));
  if (!existing) fail(404, 'No encontrado');
  if (!canEdit(existing, user, perms)) fail(403, 'Ya no puedes modificar este apunte. Pide al administrador que lo corrija.');
  const m = validateMovement(body, user, existing);
  run(`UPDATE movements SET date=?, category_id=?, description=?, amount=?, profit=?, payment_method=?,
       updated_at=datetime('now','localtime'), updated_by=? WHERE id=?`,
    m.date, m.category_id, m.description, m.amount, m.profit, m.payment_method, user.id, existing.id);
  return { ok: true };
});

route('DELETE', '/api/movements/:id', 'user', ({ user, params }) => {
  const perms = getSetting('permissions');
  const existing = get('SELECT * FROM movements WHERE id = ?', Number(params.id));
  if (!existing) fail(404, 'No encontrado');
  if (!canEdit(existing, user, perms)) fail(403, 'Ya no puedes borrar este apunte. Pide al administrador que lo haga.');
  // borrado "suave": queda registrado quién y cuándo lo borró (auditoría)
  run(`UPDATE movements SET deleted_at = datetime('now','localtime'), deleted_by = ? WHERE id = ?`, user.id, existing.id);
  return { ok: true };
});

// ---- Facturas / tickets
function invoiceOut(inv) {
  return {
    ...inv,
    items: JSON.parse(inv.items).map(i => ({ ...i, price: euros(i.price) })),
    subtotal: euros(inv.subtotal), discount: euros(inv.discount), total: euros(inv.total),
    show_vat: inv.show_vat == null ? !!getSetting('invoice').show_vat : !!inv.show_vat,
  };
}

route('GET', '/api/invoices', 'user', ({ user, query }) => {
  const perms = getSetting('permissions');
  let where = '1=1'; const p = [];
  if (query.kind === 'ticket' || query.kind === 'factura') { where += ' AND i.kind = ?'; p.push(query.kind); }
  if (user.role !== 'admin') {
    where += ' AND i.date >= ?'; p.push(addDays(localDate(), -(Number(perms.worker_history_days) || 0)));
  }
  if (query.q) { where += ' AND (i.number LIKE ? OR i.customer_name LIKE ? OR i.items LIKE ?)'; const q = `%${query.q}%`; p.push(q, q, q); }
  const rows = all(`SELECT i.*, u.name AS user_name, r.number AS replaces_number,
                      (SELECT number FROM invoices x WHERE x.replaces_id = i.id AND x.voided = 0 LIMIT 1) AS replaced_by_number
                    FROM invoices i LEFT JOIN users u ON u.id = i.user_id LEFT JOIN invoices r ON r.id = i.replaces_id
                    WHERE ${where} ORDER BY i.id DESC LIMIT 300`, ...p);
  return rows.map(invoiceOut);
});

route('GET', '/api/invoices/:id', 'user', ({ user, params }) => {
  const inv = get(`SELECT i.*, u.name AS user_name, r.number AS replaces_number, r.date AS replaces_date,
                     (SELECT id FROM invoices x WHERE x.replaces_id = i.id AND x.voided = 0 LIMIT 1) AS replaced_by_id,
                     (SELECT number FROM invoices x WHERE x.replaces_id = i.id AND x.voided = 0 LIMIT 1) AS replaced_by_number
                   FROM invoices i LEFT JOIN users u ON u.id = i.user_id LEFT JOIN invoices r ON r.id = i.replaces_id WHERE i.id = ?`, Number(params.id));
  if (!inv) fail(404, 'Factura no encontrada');
  if (user.role !== 'admin') {
    const perms = getSetting('permissions');
    if (inv.date < addDays(localDate(), -(Number(perms.worker_history_days) || 0))) fail(403, 'No tienes acceso a esta factura');
  }
  return invoiceOut(inv);
});

route('POST', '/api/invoices', 'user', ({ user, body }) => {
  const perms = getSetting('permissions');
  if (user.role !== 'admin' && !perms.worker_create_invoices) fail(403, 'No tienes permiso para crear facturas');
  const warranties = getSetting('invoice').warranties;
  const items = (Array.isArray(body.items) ? body.items : [])
    .map(i => {
      const warranty = warranties.find(w => w.name === i.warranty);
      return {
        description: str(i.description, 200), detail: str(i.detail, 200),
        qty: Math.max(1, parseInt(i.qty, 10) || 1), price: cents(i.price) || 0,
        warranty: warranty ? warranty.name : '', warranty_text: warranty ? warranty.text : '',
      };
    })
    .filter(i => i.description);
  if (!items.length) fail(400, 'Añade al menos una línea');
  const subtotal = items.reduce((a, i) => a + i.qty * i.price, 0);
  const discount = Math.max(0, cents(body.discount) || 0);
  if (discount > subtotal) fail(400, 'El descuento no puede superar el subtotal');
  const total = subtotal - discount;
  const kind = body.kind === 'ticket' ? 'ticket' : 'factura';
  const date = user.role === 'admin' && isDate(body.date) ? body.date : localDate();
  // Una factura completa necesita identificar al cliente (nombre, NIF y domicilio)
  if (kind === 'factura' && (!str(body.customer_name) || !str(body.customer_nif) || !str(body.customer_address)))
    fail(400, 'Una factura completa necesita nombre, NIF y dirección del cliente. Si no los tienes, haz un ticket.');
  const showVat = ('show_vat' in body ? !!body.show_vat : !!getSetting('invoice').show_vat) ? 1 : 0;
  let replaces = null;
  if (body.replaces_id) {
    replaces = get('SELECT * FROM invoices WHERE id = ?', Number(body.replaces_id));
    if (!replaces || replaces.kind !== 'ticket') fail(400, 'El ticket a sustituir no existe');
    if (get('SELECT 1 AS x FROM invoices WHERE replaces_id = ? AND voided = 0', replaces.id)) fail(400, 'Ese ticket ya se convirtió en factura');
  }

  return tx(() => {
    const cfg = getSetting('invoice');
    let number;
    if (kind === 'ticket') {
      number = `${cfg.ticket_prefix || ''}${cfg.ticket_next_number}`;
      setSetting('invoice', { ...cfg, ticket_next_number: Number(cfg.ticket_next_number) + 1 });
    } else {
      number = `${cfg.prefix || ''}${cfg.next_number}`;
      setSetting('invoice', { ...cfg, next_number: Number(cfg.next_number) + 1 });
    }
    if (get('SELECT 1 AS x FROM invoices WHERE number = ? AND kind = ?', number, kind)) fail(400, `El número ${number} ya existe. Revisa la numeración en Ajustes → Facturas.`);
    const { id } = run(`INSERT INTO invoices (number, kind, date, customer_name, customer_nif, customer_address, customer_phone,
                        items, subtotal, discount, total, notes, user_id, replaces_id, show_vat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, kind, date, str(body.customer_name, 120), str(body.customer_nif, 30), str(body.customer_address, 200),
      str(body.customer_phone, 30), JSON.stringify(items), subtotal, discount, total, str(body.notes, 500), user.id,
      replaces ? replaces.id : null, showVat);

    // Vincular a una venta ya registrada en caja (una factura que sustituye a un ticket no crea venta nueva)
    if (replaces) { /* la venta ya está registrada con el ticket */ }
    else if (body.movement_id) {
      run('UPDATE movements SET invoice_id = ? WHERE id = ? AND type = ? AND invoice_id IS NULL', id, Number(body.movement_id), 'sale');
    } else if (body.register && body.register.category_id) {
      // o registrar la venta en caja a la vez que se hace la factura
      const m = validateMovement({ type: 'sale', category_id: body.register.category_id, amount: euros(total),
        profit: body.register.profit, payment_method: body.register.payment_method,
        description: items.map(i => [i.description, i.detail].filter(Boolean).join(' ')).join(' · ') }, user);
      run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id, invoice_id)
           VALUES (?,?,?,?,?,?,?,?,?)`, 'sale', date, m.category_id, m.description, m.amount, m.profit, m.payment_method, user.id, id);
    }
    return { ok: true, id, number };
  });
});

route('POST', '/api/invoices/:id/void', 'admin', ({ params }) => {
  run('UPDATE invoices SET voided = 1 WHERE id = ?', Number(params.id));
  return { ok: true };
});

// ================================================================ ADMIN
function rangeFromQuery(q) {
  const today = localDate();
  const from = isDate(q.from) ? q.from : today.slice(0, 8) + '01';
  const to = isDate(q.to) ? q.to : today;
  if (from > to) fail(400, 'Rango de fechas no válido');
  return { from, to };
}

function totalsFor(from, to) {
  const s = get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(profit),0) AS profit
                 FROM movements WHERE type='sale' AND deleted_at IS NULL AND date BETWEEN ? AND ?`, from, to);
  const e = get(`SELECT COALESCE(SUM(m.amount),0) AS total,
                        COALESCE(SUM(CASE WHEN c.expense_type='stock' THEN m.amount ELSE 0 END),0) AS stock,
                        COALESCE(SUM(CASE WHEN c.expense_type='stock' THEN 0 ELSE m.amount END),0) AS operating
                 FROM movements m LEFT JOIN categories c ON c.id = m.category_id
                 WHERE m.type='expense' AND m.deleted_at IS NULL AND m.date BETWEEN ? AND ?`, from, to);
  return {
    sales_count: s.n, sales: euros(s.amount), profit: euros(s.profit),
    expenses: euros(e.total), expenses_stock: euros(e.stock), expenses_operating: euros(e.operating),
    net: euros(s.profit - e.operating),          // beneficio real = beneficio de ventas - gastos operativos
    cash: euros(s.amount - e.total),             // flujo de caja = lo que entra - todo lo que sale
    avg_ticket: s.n ? euros(Math.round(s.amount / s.n)) : 0,
    margin: s.amount ? Math.round((s.profit / s.amount) * 1000) / 10 : 0,
  };
}

route('GET', '/api/admin/stats', 'admin', ({ query }) => {
  const { from, to } = rangeFromQuery(query);
  const days = Math.round((new Date(to) - new Date(from)) / 86400e3) + 1;
  const prevTo = addDays(from, -1), prevFrom = addDays(from, -days);
  const byDay = all(`SELECT date,
        COALESCE(SUM(CASE WHEN type='sale' THEN amount END),0) AS sales,
        COALESCE(SUM(CASE WHEN type='sale' THEN profit END),0) AS profit,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expenses,
        SUM(CASE WHEN type='sale' THEN 1 ELSE 0 END) AS n
      FROM movements WHERE deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`, from, to)
    .map(r => ({ date: r.date, sales: euros(r.sales), profit: euros(r.profit), expenses: euros(r.expenses), n: r.n }));
  const byCategory = all(`SELECT c.id, c.name, c.color, COUNT(*) AS n, SUM(m.amount) AS amount, SUM(m.profit) AS profit
      FROM movements m JOIN categories c ON c.id = m.category_id
      WHERE m.type='sale' AND m.deleted_at IS NULL AND m.date BETWEEN ? AND ?
      GROUP BY c.id ORDER BY profit DESC`, from, to)
    .map(r => ({ ...r, amount: euros(r.amount), profit: euros(r.profit) }));
  const expenseByCategory = all(`SELECT c.id, c.name, c.expense_type, COUNT(*) AS n, SUM(m.amount) AS amount
      FROM movements m JOIN categories c ON c.id = m.category_id
      WHERE m.type='expense' AND m.deleted_at IS NULL AND m.date BETWEEN ? AND ?
      GROUP BY c.id ORDER BY amount DESC`, from, to).map(r => ({ ...r, amount: euros(r.amount) }));
  const byUser = all(`SELECT u.id, u.name, COUNT(*) AS n, SUM(m.amount) AS amount, SUM(m.profit) AS profit
      FROM movements m JOIN users u ON u.id = m.user_id
      WHERE m.type='sale' AND m.deleted_at IS NULL AND m.date BETWEEN ? AND ?
      GROUP BY u.id ORDER BY amount DESC`, from, to).map(r => ({ ...r, amount: euros(r.amount), profit: euros(r.profit) }));
  const byPayment = all(`SELECT CASE WHEN payment_method = '' THEN '—' ELSE payment_method END AS method, COUNT(*) AS n, SUM(amount) AS amount
      FROM movements WHERE type='sale' AND deleted_at IS NULL AND date BETWEEN ? AND ?
      GROUP BY method ORDER BY amount DESC`, from, to).map(r => ({ ...r, amount: euros(r.amount) }));
  const deletedCount = get(`SELECT COUNT(*) AS n FROM movements WHERE deleted_at IS NOT NULL AND date BETWEEN ? AND ?`, from, to).n;
  return { from, to, totals: totalsFor(from, to), previous: { from: prevFrom, to: prevTo, totals: totalsFor(prevFrom, prevTo) },
    byDay, byCategory, expenseByCategory, byUser, byPayment, deletedCount };
});

route('GET', '/api/admin/year', 'admin', ({ query }) => {
  const year = /^\d{4}$/.test(query.year || '') ? query.year : String(new Date().getFullYear());
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const from = `${year}-${pad(m)}-01`;
    const to = localDate(new Date(Number(year), m, 0));
    months.push({ month: `${year}-${pad(m)}`, ...totalsFor(from, to) });
  }
  return { year, months, totals: totalsFor(`${year}-01-01`, `${year}-12-31`) };
});

route('GET', '/api/admin/movements', 'admin', ({ query }) => {
  const { from, to } = rangeFromQuery(query);
  let where = 'm.date BETWEEN ? AND ?'; const p = [from, to];
  if (query.type === 'sale' || query.type === 'expense') { where += ' AND m.type = ?'; p.push(query.type); }
  if (query.category_id) { where += ' AND m.category_id = ?'; p.push(Number(query.category_id)); }
  if (query.user_id) { where += ' AND m.user_id = ?'; p.push(Number(query.user_id)); }
  if (query.q) { where += ' AND m.description LIKE ?'; p.push(`%${query.q}%`); }
  where += query.deleted === '1' ? ' AND m.deleted_at IS NOT NULL' : ' AND m.deleted_at IS NULL';
  const rows = all(`${MOV_SELECT.replace('u.name AS user_name', "u.name AS user_name, du.name AS deleted_by_name")}
                    LEFT JOIN users du ON du.id = m.deleted_by
                    WHERE ${where} ORDER BY m.date DESC, m.created_at DESC LIMIT 2000`, ...p);
  const perms = getSetting('permissions');
  const admin = { role: 'admin' };
  return rows.map(r => ({ ...movementOut(r, admin, perms), deleted_by: r.deleted_by_name || null, expense_type: r.expense_type }));
});

route('POST', '/api/admin/movements/:id/restore', 'admin', ({ params }) => {
  run('UPDATE movements SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', Number(params.id));
  return { ok: true };
});

// ---- Ajustes
route('GET', '/api/admin/settings', 'admin', () => allSettings());

route('PUT', '/api/admin/settings/:key', 'admin', ({ params, body }) => {
  const key = params.key;
  if (!(key in DEFAULT_SETTINGS)) fail(404, 'Ajuste desconocido');
  const def = DEFAULT_SETTINGS[key];
  const current = getSetting(key);
  const next = { ...current };
  for (const k of Object.keys(def)) {
    if (!(k in body)) continue;
    const dv = def[k], v = body[k];
    if (typeof dv === 'boolean') next[k] = !!v;
    else if (typeof dv === 'number') { const n = Number(v); if (Number.isFinite(n)) next[k] = n; }
    else if (k === 'warranties') next[k] = (Array.isArray(v) ? v : [])
      .map(w => ({ name: str(w && w.name, 60), text: str(w && w.text, 300) })).filter(w => w.name);
    else if (Array.isArray(dv)) next[k] = (Array.isArray(v) ? v : []).map(x => str(x, 40)).filter(Boolean);
    else if (k === 'logo') next[k] = typeof v === 'string' && (v === '' || v.startsWith('data:image/')) ? v.slice(0, 1_500_000) : current[k];
    else if (k.startsWith('color') || k === 'primary' || k === 'accent') { if (isColor(v)) next[k] = v; }
    else next[k] = str(v, 300);
  }
  setSetting(key, next);
  return next;
});

// ---- Categorías (admin)
function catFromBody(body, existing = {}) {
  const kind = existing.kind || (body.kind === 'expense' ? 'expense' : 'sale');
  const name = str(body.name ?? existing.name, 60);
  if (!name) fail(400, 'El nombre es obligatorio');
  return {
    kind, name,
    color: isColor(body.color) ? body.color : (existing.color || '#64748b'),
    expense_type: kind === 'expense' ? (body.expense_type === 'stock' ? 'stock' : (body.expense_type === 'operating' ? 'operating' : existing.expense_type || 'operating')) : null,
    default_price: 'default_price' in body ? cents(body.default_price) : existing.default_price ?? null,
    default_profit: 'default_profit' in body ? cents(body.default_profit) : existing.default_profit ?? null,
    warranty: kind === 'sale' ? str(body.warranty ?? existing.warranty, 60) : '',
    favorite: 'favorite' in body ? (body.favorite ? 1 : 0) : (existing.favorite || 0),
    active: 'active' in body ? (body.active ? 1 : 0) : (existing.active ?? 1),
  };
}
route('POST', '/api/admin/categories', 'admin', ({ body }) => {
  const c = catFromBody(body);
  const sort = (get('SELECT MAX(sort) AS s FROM categories WHERE kind = ?', c.kind).s || 0) + 1;
  const { id } = run(`INSERT INTO categories (kind, name, color, expense_type, default_price, default_profit, favorite, active, sort, warranty)
                      VALUES (?,?,?,?,?,?,?,?,?,?)`, c.kind, c.name, c.color, c.expense_type, c.default_price, c.default_profit, c.favorite, c.active, sort, c.warranty);
  return { ok: true, id };
});
route('PUT', '/api/admin/categories/:id', 'admin', ({ body, params }) => {
  const existing = get('SELECT * FROM categories WHERE id = ?', Number(params.id));
  if (!existing) fail(404, 'No encontrada');
  const c = catFromBody(body, existing);
  run(`UPDATE categories SET name=?, color=?, expense_type=?, default_price=?, default_profit=?, favorite=?, active=?, warranty=? WHERE id=?`,
    c.name, c.color, c.expense_type, c.default_price, c.default_profit, c.favorite, c.active, c.warranty, existing.id);
  return { ok: true };
});
route('POST', '/api/admin/categories/reorder', 'admin', ({ body }) => {
  const ids = Array.isArray(body.ids) ? body.ids : [];
  tx(() => ids.forEach((id, i) => run('UPDATE categories SET sort = ? WHERE id = ?', i, Number(id))));
  return { ok: true };
});

// ---- Usuarios
route('GET', '/api/admin/users', 'admin', () =>
  all('SELECT id, username, name, role, active, created_at FROM users ORDER BY role, name'));

route('POST', '/api/admin/users', 'admin', ({ body }) => {
  const username = str(body.username, 40), name = str(body.name, 80) || username;
  if (!username) fail(400, 'El usuario es obligatorio');
  if (String(body.password || '').length < 4) fail(400, 'La contraseña/PIN debe tener al menos 4 caracteres');
  if (get('SELECT 1 AS x FROM users WHERE username = ?', username)) fail(400, 'Ese nombre de usuario ya existe');
  const role = body.role === 'admin' ? 'admin' : 'worker';
  const { id } = run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)', username, name, auth.hashPassword(body.password), role);
  return { ok: true, id };
});

route('PUT', '/api/admin/users/:id', 'admin', ({ body, params, user }) => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(params.id));
  if (!u) fail(404, 'Usuario no encontrado');
  const role = body.role === 'admin' ? 'admin' : body.role === 'worker' ? 'worker' : u.role;
  const active = 'active' in body ? (body.active ? 1 : 0) : u.active;
  if (u.id === user.id && (role !== 'admin' || !active)) fail(400, 'No puedes quitarte el rol de administrador ni desactivarte');
  run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', str(body.name ?? u.name, 80) || u.username, role, active, u.id);
  if (body.password) {
    if (String(body.password).length < 4) fail(400, 'La contraseña/PIN debe tener al menos 4 caracteres');
    run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(body.password), u.id);
    run('DELETE FROM sessions WHERE user_id = ? AND user_id != ?', u.id, user.id);
  }
  if (!active) run('DELETE FROM sessions WHERE user_id = ?', u.id);
  return { ok: true };
});

// ---- Datos: exportar / importar / copia de seguridad
const csvCell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvNum = (n) => Number(n).toFixed(2).replace('.', ',');

route('GET', '/api/admin/export.csv', 'admin', ({ query, res }) => {
  const { from, to } = rangeFromQuery(query);
  const rows = all(`${MOV_SELECT} WHERE m.deleted_at IS NULL AND m.date BETWEEN ? AND ? ORDER BY m.date, m.created_at`, from, to);
  const head = ['fecha', 'hora', 'tipo', 'categoria', 'descripcion', 'importe', 'beneficio', 'metodo_pago', 'usuario', 'tipo_gasto'];
  const lines = [head.join(';')].concat(rows.map(r => [
    r.date, String(r.created_at).slice(11, 16), r.type === 'sale' ? 'venta' : 'gasto', r.category_name, r.description,
    csvNum(euros(r.amount)), r.type === 'sale' ? csvNum(euros(r.profit)) : '', r.payment_method, r.user_name,
    r.type === 'expense' ? (r.expense_type === 'stock' ? 'mercancia' : 'operativo') : '',
  ].map(csvCell).join(';')));
  res.sendRaw(200, '﻿' + lines.join('\r\n'), 'text/csv; charset=utf-8', `movimientos_${from}_${to}.csv`);
});

function parseCSV(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

route('POST', '/api/admin/import', 'admin', ({ body, user }) => {
  const rows = parseCSV(String(body.csv || '').replace(/^﻿/, ''));
  if (rows.length < 2) fail(400, 'El CSV está vacío');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (names) => head.findIndex(h => names.includes(h));
  const iDate = col(['fecha', 'date']), iType = col(['tipo', 'type']), iCat = col(['categoria', 'categoría', 'producto', 'motivo']),
    iDesc = col(['descripcion', 'descripción', 'concepto']), iAmt = col(['importe', 'precio', 'amount', 'gasto']),
    iProfit = col(['beneficio', 'ganancia', 'profit']), iPm = col(['metodo_pago', 'método', 'metodo', 'pago']),
    iEt = col(['tipo_gasto']);
  if (iDate < 0 || iCat < 0 || iAmt < 0) fail(400, 'El CSV necesita al menos las columnas: fecha, categoria, importe');
  const toIso = (s) => {
    s = String(s).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
    return null;
  };
  let imported = 0; const errors = [];
  tx(() => {
    rows.slice(1).forEach((r, idx) => {
      const date = toIso(r[iDate]); const amount = cents(r[iAmt]);
      const typeRaw = iType >= 0 ? String(r[iType]).toLowerCase() : 'venta';
      const type = /gasto|expense/.test(typeRaw) ? 'expense' : 'sale';
      const catName = String(r[iCat] || '').trim();
      if (!date || !amount || !catName) { errors.push(`Fila ${idx + 2}: datos incompletos`); return; }
      let cat = get('SELECT id FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE', type, catName);
      if (!cat) {
        const et = type === 'expense' ? (iEt >= 0 && /merc|stock/i.test(r[iEt]) ? 'stock' : 'operating') : null;
        cat = { id: run('INSERT INTO categories (kind, name, color, expense_type, sort) VALUES (?,?,?,?,999)', type, catName, '#64748b', et).id };
      }
      run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id) VALUES (?,?,?,?,?,?,?,?)`,
        type, date, cat.id, iDesc >= 0 ? str(r[iDesc], 300) : '', amount, type === 'sale' ? (cents(iProfit >= 0 ? r[iProfit] : 0) || 0) : 0,
        iPm >= 0 ? str(r[iPm], 40) : '', user.id);
      imported++;
    });
  });
  return { ok: true, imported, errors: errors.slice(0, 50) };
});

route('GET', '/api/admin/backup', 'admin', ({ res }) => {
  const file = backupToTemp();
  const buf = fs.readFileSync(file); fs.unlinkSync(file);
  res.sendRaw(200, buf, 'application/octet-stream', `ventas-backup-${localDate()}.db`);
});

// ================================================================ ARCHIVOS (solo administrador)
const fileOut = (f) => ({ id: f.id, name: f.name, folder: f.folder, mime: f.mime, size: f.size, note: f.note,
  created_at: f.created_at, uploaded_by: f.user_name || null });

route('GET', '/api/admin/files', 'admin', ({ query }) => {
  let where = '1=1'; const p = [];
  if (query.folder) { where += ' AND f.folder = ?'; p.push(query.folder); }
  if (query.q) { where += ' AND (f.name LIKE ? OR f.note LIKE ?)'; p.push(`%${query.q}%`, `%${query.q}%`); }
  const files = all(`SELECT f.*, u.name AS user_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
                     WHERE ${where} ORDER BY f.created_at DESC, f.id DESC`, ...p).map(fileOut);
  const folders = all('SELECT folder, COUNT(*) AS n, SUM(size) AS size FROM files GROUP BY folder ORDER BY folder');
  const total = get('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS size FROM files');
  return { files, folders, total };
});

// Subida: el cuerpo es el fichero en bruto (se guarda en disco sin pasar por memoria)
route('POST', '/api/admin/files', 'admin', ({ req, user }) => new Promise((resolve, reject) => {
  const maxBytes = (Number(getSetting('files').max_mb) || 50) * 1024 * 1024;
  let name = 'archivo';
  try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'archivo')); } catch { /* nombre por defecto */ }
  name = name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 200) || 'archivo';
  let folder = 'General';
  try { folder = str(decodeURIComponent(String(req.headers['x-folder'] || 'General')), 80) || 'General'; } catch { /* general */ }
  const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].slice(0, 100);
  const ext = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
  const stored = crypto.randomBytes(16).toString('hex') + ext;
  const dest = path.join(FILES_DIR, stored);
  if (Number(req.headers['content-length'] || 0) > maxBytes) return reject(new HttpError(413, `El archivo supera el máximo de ${maxBytes / 1048576} MB`));
  const out = fs.createWriteStream(dest, { flags: 'wx' });
  let size = 0, aborted = false;
  const abort = (err) => { if (aborted) return; aborted = true; out.destroy(); fs.rm(dest, { force: true }, () => {}); reject(err); };
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxBytes) { abort(new HttpError(413, `El archivo supera el máximo de ${maxBytes / 1048576} MB`)); req.resume(); }
  });
  req.on('error', abort);
  out.on('error', abort);
  req.pipe(out);
  out.on('finish', () => {
    if (aborted) return;
    if (!size) { fs.rm(dest, { force: true }, () => {}); return reject(new HttpError(400, 'El archivo está vacío')); }
    const { id } = run('INSERT INTO files (name, folder, mime, size, stored_name, uploaded_by) VALUES (?,?,?,?,?,?)', name, folder, mime, size, stored, user.id);
    resolve({ ok: true, id });
  });
}), { raw: true });

route('GET', '/api/admin/files/:id/download', 'admin', ({ params, query, res }) => {
  const f = get('SELECT * FROM files WHERE id = ?', Number(params.id));
  if (!f) fail(404, 'Archivo no encontrado');
  const file = path.join(FILES_DIR, f.stored_name);
  if (!fs.existsSync(file)) fail(404, 'El archivo no está en el disco');
  // solo se muestran "en línea" tipos seguros; el resto se descarga (evita ejecutar HTML subido)
  const safeInline = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain)$/.test(f.mime);
  res.sendFile(file, safeInline ? f.mime : 'application/octet-stream', f.name, query.inline === '1' && safeInline);
});

route('PUT', '/api/admin/files/:id', 'admin', ({ params, body }) => {
  const f = get('SELECT * FROM files WHERE id = ?', Number(params.id));
  if (!f) fail(404, 'Archivo no encontrado');
  const name = str(body.name ?? f.name, 200).replace(/[\\/\x00-\x1f]/g, '_') || f.name;
  run('UPDATE files SET name = ?, folder = ?, note = ? WHERE id = ?', name, str(body.folder ?? f.folder, 80) || 'General', str(body.note ?? f.note, 500), f.id);
  return { ok: true };
});

route('DELETE', '/api/admin/files/:id', 'admin', ({ params }) => {
  const f = get('SELECT * FROM files WHERE id = ?', Number(params.id));
  if (!f) fail(404, 'Archivo no encontrado');
  run('DELETE FROM files WHERE id = ?', f.id);
  fs.rm(path.join(FILES_DIR, f.stored_name), { force: true }, () => {});
  return { ok: true };
});

module.exports = { routes, HttpError };
