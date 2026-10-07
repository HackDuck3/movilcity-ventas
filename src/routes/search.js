'use strict';
// One search box for everything: tickets, invoices, repairs, stock and (for admins) movements.
// Each user only gets results from the sections they are allowed to open.
const { all } = require('../db');
const { getSetting } = require('../settings');
const { route } = require('../http');
const { euros, str } = require('../utils');
const { oldestDateVisibleTo } = require('./invoices');

const RESULTS_PER_SECTION = 15;
const MIN_QUERY_LENGTH = 2;

// Builds "(a LIKE ? OR b LIKE ?)" and its values for a list of columns.
function matchAny(columns, query) {
  return {
    condition: `(${columns.map(column => `${column} LIKE ?`).join(' OR ')})`,
    values: columns.map(() => `%${query}%`),
  };
}

function searchInvoices(query, user) {
  const match = matchAny(['number', 'customer_name', 'customer_nif', 'customer_phone', 'items'], query);
  return all(`SELECT id, kind, number, date, customer_name, items, total, voided FROM invoices
              WHERE ${match.condition} AND date >= ? ORDER BY id DESC LIMIT ?`,
    ...match.values, oldestDateVisibleTo(user), RESULTS_PER_SECTION)
    .map(invoice => ({
      id: invoice.id, kind: invoice.kind, number: invoice.number, date: invoice.date,
      title: JSON.parse(invoice.items).map(item => [item.description, item.detail].filter(Boolean).join(' ')).join(', '),
      customer: invoice.customer_name, amount: euros(invoice.total), voided: invoice.voided,
    }));
}

function searchRepairs(query) {
  const match = matchAny(['number', 'customer_name', 'customer_phone', 'customer_nif', 'brand', 'model', 'imei'], query);
  return all(`SELECT id, number, date, customer_name, customer_phone, brand, model, imei, amount, status, ready_at, voided FROM repairs
              WHERE ${match.condition} ORDER BY id DESC LIMIT ?`, ...match.values, RESULTS_PER_SECTION)
    .map(repair => ({
      id: repair.id, number: repair.number, date: repair.date,
      title: [repair.brand, repair.model, repair.imei && `IMEI ${repair.imei}`].filter(Boolean).join(' '),
      customer: [repair.customer_name, repair.customer_phone].filter(Boolean).join(' · '),
      amount: repair.amount == null ? null : euros(repair.amount),
      stage: repair.status === 'collected' ? 'collected' : repair.ready_at ? 'ready' : 'pending',
      voided: repair.voided,
    }));
}

function searchStock(query) {
  const match = matchAny(['brand', 'model', 'imei', 'notes'], query);
  return all(`SELECT id, brand, model, imei, price, purchased_on, sold_on FROM devices
              WHERE ${match.condition} ORDER BY id DESC LIMIT ?`, ...match.values, RESULTS_PER_SECTION)
    .map(device => ({
      id: device.id, date: device.sold_on || device.purchased_on,
      title: [device.brand, device.model, device.imei && `IMEI ${device.imei}`].filter(Boolean).join(' '),
      amount: device.price == null ? null : euros(device.price),
      sold: !!device.sold_on,
    }));
}

function searchPurchases(query) {
  const match = matchAny(['number', 'seller_name', 'seller_nif', 'brand', 'model', 'imei'], query);
  return all(`SELECT id, number, date, seller_name, brand, model, imei, price, voided FROM purchases
              WHERE ${match.condition} ORDER BY id DESC LIMIT ?`, ...match.values, RESULTS_PER_SECTION)
    .map(purchase => ({
      id: purchase.id, number: purchase.number, date: purchase.date,
      title: [purchase.brand, purchase.model, `IMEI ${purchase.imei}`].filter(Boolean).join(' '),
      customer: purchase.seller_name, amount: euros(purchase.price), voided: purchase.voided,
    }));
}

function searchMovements(query) {
  const match = matchAny(['m.description', 'c.name'], query);
  return all(`SELECT m.id, m.type, m.date, m.description, m.amount, m.invoice_id, c.name AS category
              FROM movements m LEFT JOIN categories c ON c.id = m.category_id
              WHERE ${match.condition} AND m.deleted_at IS NULL ORDER BY m.date DESC, m.id DESC LIMIT ?`,
    ...match.values, RESULTS_PER_SECTION)
    .map(movement => ({
      id: movement.id, type: movement.type, date: movement.date, invoice_id: movement.invoice_id,
      title: [movement.category, movement.description].filter(Boolean).join(' · '),
      amount: euros(movement.amount),
    }));
}

route('GET', '/api/search', 'user', ({ user, query }) => {
  const text = str(query.q, 80);
  if (text.length < MIN_QUERY_LENGTH) return { invoices: [], repairs: [], stock: [], purchases: [], movements: [] };

  const isAdmin = user.role === 'admin';
  const modules = getSetting('modules');
  const permissions = getSetting('permissions');
  const allowed = (permission) => isAdmin || !!permissions[permission];

  return {
    invoices: modules.invoices && allowed('worker_create_invoices') ? searchInvoices(text, user) : [],
    repairs: modules.repairs && allowed('worker_create_repairs') ? searchRepairs(text) : [],
    stock: modules.stock ? searchStock(text) : [],
    purchases: modules.purchases && allowed('worker_create_purchases') ? searchPurchases(text) : [],
    movements: isAdmin ? searchMovements(text) : [],
  };
});
