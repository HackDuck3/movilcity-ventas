'use strict';
// Customers are remembered from the documents made for them: saving an invoice or a repair
// with a NIF or a phone creates the customer, or completes the one already on file.
const { get, run } = require('./db');

const DETAIL_FIELDS = ['name', 'nif', 'phone', 'address', 'postcode', 'city', 'province'];

// Spaces, dots and dashes are ignored when comparing a NIF or a phone.
const compact = (text) => String(text || '').replace(/[\s.\-]/g, '').toUpperCase();
const COMPACT_SQL = (column) => `UPPER(REPLACE(REPLACE(REPLACE(${column}, ' ', ''), '.', ''), '-', ''))`;

function findMatch(details) {
  const byColumn = (column, value) => (compact(value)
    ? get(`SELECT * FROM customers WHERE ${COMPACT_SQL(column)} = ? ORDER BY id LIMIT 1`, compact(value))
    : null);
  const sameNif = byColumn('nif', details.nif);
  if (sameNif) return sameNif;
  // Two people can share a phone: it only identifies someone when their NIFs do not disagree.
  const samePhone = byColumn('phone', details.phone);
  const nifsDisagree = samePhone && compact(details.nif) && compact(samePhone.nif);
  return nifsDisagree ? null : samePhone;
}

// Returns the id of the customer these details belong to, creating or completing it.
// A name alone is not enough to tell two people apart, so it returns null.
function rememberCustomer(details) {
  if (!compact(details.nif) && !compact(details.phone)) return null;
  const existing = findMatch(details);
  if (!existing) {
    return run(`INSERT INTO customers (${DETAIL_FIELDS.join(', ')}) VALUES (?,?,?,?,?,?,?)`,
      ...DETAIL_FIELDS.map(field => details[field] || '')).id;
  }
  // What is typed now wins; what is left empty keeps the value on file.
  const merged = DETAIL_FIELDS.map(field => details[field] || existing[field]);
  run(`UPDATE customers SET ${DETAIL_FIELDS.map(field => `${field} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`,
    ...merged, existing.id);
  return existing.id;
}

const fromInvoice = (invoice) => ({
  name: invoice.customer_name, nif: invoice.customer_nif, phone: invoice.customer_phone, address: invoice.customer_address,
  postcode: invoice.customer_postcode, city: invoice.customer_city, province: invoice.customer_province,
});
const fromRepair = (repair) => ({ name: repair.customer_name, nif: repair.customer_nif, phone: repair.customer_phone });

function linkInvoice(id) {
  const invoice = get('SELECT * FROM invoices WHERE id = ?', id);
  run('UPDATE invoices SET customer_id = ? WHERE id = ?', rememberCustomer(fromInvoice(invoice)), id);
}

function linkRepair(id) {
  const repair = get('SELECT * FROM repairs WHERE id = ?', id);
  run('UPDATE repairs SET customer_id = ? WHERE id = ?', rememberCustomer(fromRepair(repair)), id);
}

module.exports = { compact, COMPACT_SQL, findMatch, rememberCustomer, linkInvoice, linkRepair };
