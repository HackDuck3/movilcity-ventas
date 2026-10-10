'use strict';
// The customer list, each customer's history and the search behind the autocomplete.
const { all, get, run, once } = require('../db');
const { getSetting } = require('../settings');
const { route, fail } = require('../http');
const { euros, str } = require('../utils');
const { compact, COMPACT_SQL, findMatch, linkInvoice, linkRepair } = require('../customers');
const { oldestDateVisibleTo } = require('./invoices');

const LIST_LIMIT = 200;

function requireAccess() {
  if (!getSetting('modules').customers) fail(403, 'El módulo de clientes está desactivado');
}

function fieldsFromBody(body) {
  return {
    name: str(body.name, 120), nif: str(body.nif, 30), phone: str(body.phone, 30),
    address: str(body.address, 200), postcode: str(body.postcode, 12),
    city: str(body.city, 80), province: str(body.province, 80),
  };
}

// Documents made before customers existed.
once('customers_from_documents', () => {
  all('SELECT id FROM invoices WHERE voided = 0 ORDER BY id').forEach(invoice => linkInvoice(invoice.id));
  all('SELECT id FROM repairs WHERE voided = 0 ORDER BY id').forEach(repair => linkRepair(repair.id));
});

route('GET', '/api/customers', 'user', ({ query }) => {
  requireAccess();
  const text = str(query.q, 80);
  const limit = Math.min(Number(query.limit) || LIST_LIMIT, LIST_LIMIT);
  if (!text) return all('SELECT * FROM customers ORDER BY updated_at DESC, id DESC LIMIT ?', limit);
  const like = `%${text}%`;
  const compactLike = `%${compact(text)}%`;
  return all(`SELECT * FROM customers
              WHERE name LIKE ? OR ${COMPACT_SQL('nif')} LIKE ? OR ${COMPACT_SQL('phone')} LIKE ?
              ORDER BY updated_at DESC, id DESC LIMIT ?`, like, compactLike, compactLike, limit);
});

function findCustomer(id) {
  const customer = get('SELECT * FROM customers WHERE id = ?', Number(id));
  if (!customer) fail(404, 'Cliente no encontrado');
  return customer;
}

// The customer with everything bought and repaired. Workers only get the documents they may open.
route('GET', '/api/customers/:id', 'user', ({ user, params }) => {
  requireAccess();
  const customer = findCustomer(params.id);
  const isAdmin = user.role === 'admin';
  const modules = getSetting('modules');
  const permissions = getSetting('permissions');
  const allowed = (module, permission) => modules[module] && (isAdmin || !!permissions[permission]);

  const invoices = allowed('invoices', 'worker_create_invoices')
    ? all(`SELECT id, kind, number, date, items, total, voided, rectifies_id FROM invoices
           WHERE customer_id = ? AND date >= ? ORDER BY id DESC`, customer.id, oldestDateVisibleTo(user))
      .map(invoice => ({
        id: invoice.id, kind: invoice.kind, number: invoice.number, date: invoice.date, voided: invoice.voided,
        is_refund: !!invoice.rectifies_id,
        title: JSON.parse(invoice.items).map(item => item.description).join(', '),
        total: euros(invoice.total),
      }))
    : [];
  const repairs = allowed('repairs', 'worker_create_repairs')
    ? all(`SELECT id, number, date, brand, model, amount, status, ready_at, voided FROM repairs
           WHERE customer_id = ? ORDER BY id DESC`, customer.id)
      .map(repair => ({
        id: repair.id, number: repair.number, date: repair.date, voided: repair.voided,
        title: [repair.brand, repair.model].filter(Boolean).join(' '),
        amount: repair.amount == null ? null : euros(repair.amount),
        stage: repair.status === 'collected' ? 'collected' : repair.ready_at ? 'ready' : 'pending',
      }))
    : [];
  return { ...customer, invoices, repairs };
});

function validated(body) {
  const fields = { ...fieldsFromBody(body), notes: str(body.notes, 500) };
  if (!fields.name && !fields.phone) fail(400, 'Indica el nombre o el teléfono');
  return fields;
}

route('POST', '/api/customers', 'user', ({ body }) => {
  requireAccess();
  const f = validated(body);
  const duplicate = findMatch(f);
  if (duplicate) fail(400, `Ya hay un cliente con ese NIF o teléfono: ${duplicate.name || duplicate.phone}`);
  const { id } = run('INSERT INTO customers (name, nif, phone, address, postcode, city, province, notes) VALUES (?,?,?,?,?,?,?,?)',
    f.name, f.nif, f.phone, f.address, f.postcode, f.city, f.province, f.notes);
  return { ok: true, id };
});

route('PUT', '/api/customers/:id', 'user', ({ params, body }) => {
  requireAccess();
  const customer = findCustomer(params.id);
  const f = validated(body);
  run(`UPDATE customers SET name=?, nif=?, phone=?, address=?, postcode=?, city=?, province=?, notes=?,
       updated_at = datetime('now','localtime') WHERE id=?`,
    f.name, f.nif, f.phone, f.address, f.postcode, f.city, f.province, f.notes, customer.id);
  return { ok: true };
});

// Documents keep the customer's details they were issued with; only the link to the record goes.
route('DELETE', '/api/customers/:id', 'admin', ({ params }) => {
  const customer = findCustomer(params.id);
  run('UPDATE invoices SET customer_id = NULL WHERE customer_id = ?', customer.id);
  run('UPDATE repairs SET customer_id = NULL WHERE customer_id = ?', customer.id);
  run('DELETE FROM customers WHERE id = ?', customer.id);
  return { ok: true };
});
