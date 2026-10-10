'use strict';
// Tickets (simplified invoices) and full invoices share one table and differ in `kind`.
const { all, get, run, tx } = require('../db');
const { getSetting, setSetting } = require('../settings');
const { route, fail } = require('../http');
const { cents, euros, localDate, addDays, isDate, str } = require('../utils');
const { validateMovement } = require('./movements');
const { linkInvoice } = require('../customers');

const isAdmin = (user) => user.role === 'admin';

const INVOICE_SELECT = `
  SELECT i.*, u.name AS user_name, replaced.number AS replaces_number, replaced.date AS replaces_date,
         replacement.id AS replaced_by_id, replacement.number AS replaced_by_number,
         rectified.number AS rectifies_number, rectified.date AS rectifies_date, rectified.kind AS rectifies_kind
  FROM invoices i
  LEFT JOIN users u ON u.id = i.user_id
  LEFT JOIN invoices rectified ON rectified.id = i.rectifies_id
  LEFT JOIN invoices replaced ON replaced.id = i.replaces_id
  LEFT JOIN invoices replacement ON replacement.replaces_id = i.id AND replacement.voided = 0`;

function toResponse(invoice) {
  return {
    ...invoice,
    items: JSON.parse(invoice.items).map(item => ({ ...item, price: euros(item.price) })),
    subtotal: euros(invoice.subtotal),
    discount: euros(invoice.discount),
    total: euros(invoice.total),
    // Invoices created before the per-document switch existed follow the global setting.
    show_vat: invoice.show_vat == null ? !!getSetting('invoice').show_vat : !!invoice.show_vat,
  };
}

function oldestDateVisibleTo(user) {
  if (isAdmin(user)) return '0000-00-00';
  return addDays(localDate(), -(Number(getSetting('permissions').worker_history_days) || 0));
}

route('GET', '/api/invoices', 'user', ({ user, query }) => {
  const conditions = ['i.date >= ?'];
  const values = [oldestDateVisibleTo(user)];
  if (['ticket', 'factura'].includes(query.kind)) {
    conditions.push('i.kind = ?');
    values.push(query.kind);
  }
  if (query.q) {
    conditions.push('(i.number LIKE ? OR i.customer_name LIKE ? OR i.items LIKE ?)');
    values.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  return all(`${INVOICE_SELECT} WHERE ${conditions.join(' AND ')} GROUP BY i.id ORDER BY i.id DESC LIMIT 300`, ...values)
    .map(toResponse);
});

route('GET', '/api/invoices/:id', 'user', ({ user, params }) => {
  const invoice = get(`${INVOICE_SELECT} WHERE i.id = ?`, Number(params.id));
  if (!invoice) fail(404, 'Factura no encontrada');
  if (invoice.date < oldestDateVisibleTo(user)) fail(403, 'No tienes acceso a esta factura');
  const refunds = refundsOf(invoice.id);
  return {
    ...toResponse(invoice),
    refunds: refunds.map(refund => ({ id: refund.id, number: refund.number, date: refund.date, total: euros(refund.total) })),
    refunded_qty: refundedQuantities(refunds),
  };
});

// ---- Refunds
// A refund is its own document, in its own series, pointing at the one it corrects through rectifies_id.
// Its lines carry the index of the original line (`line`) and a negative quantity.
const refundsOf = (invoiceId) => all('SELECT * FROM invoices WHERE rectifies_id = ? AND voided = 0 ORDER BY id', invoiceId);

// { originalLineIndex: unitsAlreadyReturned }
function refundedQuantities(refunds) {
  const returned = {};
  for (const refund of refunds) {
    for (const item of JSON.parse(refund.items)) returned[item.line] = (returned[item.line] || 0) - item.qty;
  }
  return returned;
}

// The warranty text is copied into each item so later changes in settings never alter issued documents.
function itemsFromBody(body) {
  const warranties = getSetting('invoice').warranties;
  return (Array.isArray(body.items) ? body.items : [])
    .map(item => {
      const warranty = warranties.find(w => w.name === item.warranty);
      return {
        description: str(item.description, 200),
        detail: str(item.detail, 200),
        qty: Math.max(1, parseInt(item.qty, 10) || 1),
        price: cents(item.price) || 0,
        warranty: warranty ? warranty.name : '',
        warranty_text: warranty ? warranty.text : '',
      };
    })
    .filter(item => item.description);
}

function findTicketToReplace(id) {
  if (!id) return null;
  const ticket = get('SELECT * FROM invoices WHERE id = ?', Number(id));
  if (!ticket || ticket.kind !== 'ticket') fail(400, 'El ticket a sustituir no existe');
  if (get('SELECT 1 AS found FROM invoices WHERE replaces_id = ? AND voided = 0', ticket.id)) fail(400, 'Ese ticket ya se convirtió en factura');
  return ticket;
}

// Takes the next number of the series and advances the counter. Must run inside a transaction.
function takeNextNumber(kind) {
  const config = getSetting('invoice');
  const [prefixField, counterField] = kind === 'ticket' ? ['ticket_prefix', 'ticket_next_number'] : ['prefix', 'next_number'];
  const number = `${config[prefixField] || ''}${config[counterField]}`;
  if (get('SELECT 1 AS found FROM invoices WHERE number = ? AND kind = ?', number, kind)) {
    fail(400, `El número ${number} ya existe. Revisa la numeración en Ajustes → Facturas.`);
  }
  setSetting('invoice', { ...config, [counterField]: Number(config[counterField]) + 1 });
  return number;
}

// An invoice can point at a sale already in the register, or create that sale itself.
// An invoice that replaces a ticket does neither: the sale was recorded with the ticket.
function linkToSale(invoiceId, body, sale, user) {
  if (body.movement_id) {
    run('UPDATE movements SET invoice_id = ? WHERE id = ? AND type = ? AND invoice_id IS NULL', invoiceId, Number(body.movement_id), 'sale');
    return;
  }
  if (!body.register || !body.register.category_id) return;
  const m = validateMovement({
    type: 'sale',
    category_id: body.register.category_id,
    amount: euros(sale.total),
    profit: body.register.profit,
    payment_method: body.register.payment_method,
    description: sale.items.map(item => [item.description, item.detail].filter(Boolean).join(' ')).join(' · '),
  }, user);
  run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id, invoice_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    'sale', sale.date, m.category_id, m.description, m.amount, m.profit, m.payment_method, user.id, invoiceId);
}

route('POST', '/api/invoices', 'user', ({ user, body }) => {
  if (!isAdmin(user) && !getSetting('permissions').worker_create_invoices) fail(403, 'No tienes permiso para crear facturas');

  const items = itemsFromBody(body);
  if (!items.length) fail(400, 'Añade al menos una línea');
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const discount = Math.max(0, cents(body.discount) || 0);
  if (discount > subtotal) fail(400, 'El descuento no puede superar el subtotal');
  const total = subtotal - discount;

  const kind = body.kind === 'ticket' ? 'ticket' : 'factura';
  const date = isAdmin(user) && isDate(body.date) ? body.date : localDate();
  const customer = {
    name: str(body.customer_name, 120), nif: str(body.customer_nif, 30),
    address: str(body.customer_address, 200), postcode: str(body.customer_postcode, 12),
    city: str(body.customer_city, 80), province: str(body.customer_province, 80),
    phone: str(body.customer_phone, 30),
  };
  if (kind === 'factura' && (!customer.name || !customer.nif || !customer.address)) {
    fail(400, 'Una factura completa necesita nombre, NIF y dirección del cliente. Si no los tienes, haz un ticket.');
  }
  const showVat = 'show_vat' in body ? !!body.show_vat : !!getSetting('invoice').show_vat;
  const replacedTicket = findTicketToReplace(body.replaces_id);

  return tx(() => {
    const number = takeNextNumber(kind);
    const { id } = run(`INSERT INTO invoices (number, kind, date, customer_name, customer_nif, customer_address, customer_postcode,
                        customer_city, customer_province, customer_phone,
                        items, subtotal, discount, total, notes, user_id, replaces_id, show_vat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, kind, date, customer.name, customer.nif, customer.address, customer.postcode,
      customer.city, customer.province, customer.phone,
      JSON.stringify(items), subtotal, discount, total, str(body.notes, 500), user.id,
      replacedTicket ? replacedTicket.id : null, showVat ? 1 : 0);
    linkInvoice(id);
    if (!replacedTicket) linkToSale(id, body, { items, total, date }, user);
    return { ok: true, id, number };
  });
});

function takeNextRefundNumber() {
  const config = getSetting('invoice');
  const number = `${config.refund_prefix || ''}${config.refund_next_number}`;
  if (get('SELECT 1 AS found FROM invoices WHERE number = ?', number)) {
    fail(400, `El número ${number} ya existe. Revisa la serie de devoluciones en Ajustes → Tickets y facturas.`);
  }
  setSetting('invoice', { ...config, refund_next_number: Number(config.refund_next_number) + 1 });
  return number;
}

// The sale behind a document. For an invoice that replaced a ticket, the sale hangs from the ticket.
function saleOf(invoice) {
  return get(`SELECT * FROM movements WHERE invoice_id IN (?, ?) AND type = 'sale' AND amount > 0 AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    invoice.id, invoice.replaces_id || invoice.id);
}

// body: { items: [{ line, qty }], reason, register: { category_id, payment_method, profit } | null }
route('POST', '/api/invoices/:id/refund', 'user', ({ user, params, body }) => {
  if (!isAdmin(user) && !getSetting('permissions').worker_refund) fail(403, 'No tienes permiso para hacer devoluciones');
  const original = get('SELECT * FROM invoices WHERE id = ?', Number(params.id));
  if (!original) fail(404, 'Documento no encontrado');
  if (original.voided) fail(400, 'Este documento está anulado');
  if (original.rectifies_id) fail(400, 'Una devolución no se puede devolver');
  if (get('SELECT 1 AS found FROM invoices WHERE replaces_id = ? AND voided = 0', original.id)) {
    fail(400, 'Este ticket se convirtió en factura: haz la devolución desde la factura');
  }

  const originalItems = JSON.parse(original.items);
  const alreadyReturned = refundedQuantities(refundsOf(original.id));
  const items = (Array.isArray(body.items) ? body.items : [])
    .map(({ line, qty }) => ({ line: Number(line), qty: parseInt(qty, 10) || 0 }))
    .filter(({ qty }) => qty > 0)
    .map(({ line, qty }) => {
      const item = originalItems[line];
      if (!item) fail(400, 'Línea no válida');
      if (qty > item.qty - (alreadyReturned[line] || 0)) fail(400, `De "${item.description}" no quedan tantas unidades por devolver`);
      return { line, description: item.description, detail: item.detail, qty: -qty, price: item.price, warranty: '', warranty_text: '' };
    });
  if (!items.length) fail(400, 'Marca lo que se devuelve');

  // The discount of the original is returned in the same proportion.
  const gross = items.reduce((sum, item) => sum - item.qty * item.price, 0);
  const refunded = original.subtotal ? Math.round(gross * original.total / original.subtotal) : gross;
  const reason = str(body.reason, 300);

  return tx(() => {
    const number = takeNextRefundNumber();
    const { id } = run(`INSERT INTO invoices (number, kind, date, customer_name, customer_nif, customer_address, customer_postcode,
                        customer_city, customer_province, customer_phone, customer_id,
                        items, subtotal, discount, total, notes, user_id, show_vat, rectifies_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, original.kind, localDate(), original.customer_name, original.customer_nif, original.customer_address, original.customer_postcode,
      original.customer_city, original.customer_province, original.customer_phone, original.customer_id,
      JSON.stringify(items), -gross, -(gross - refunded), -refunded, reason, user.id, original.show_vat, original.id);
    if (body.register) registerRefund(id, number, original, { items, refunded }, body.register, user);
    return { ok: true, id, number };
  });
});

// Takes the money out of the register as a negative sale, so the day's totals and the profit go down with it.
function registerRefund(refundId, number, original, refund, register, user) {
  const sale = saleOf(original);
  const category = get("SELECT id FROM categories WHERE id = ? AND kind = 'sale'", Number(register.category_id) || (sale && sale.category_id));
  if (!category) fail(400, 'Elige el producto de la venta que se devuelve');
  // Without a figure from the user, the profit lost is the sale's profit in proportion to what is returned.
  const proportional = sale && sale.amount ? Math.round(sale.profit * refund.refunded / sale.amount) : 0;
  const typed = cents(register.profit);
  const profitLost = typed === null ? proportional : typed;
  const description = `Devolución ${number} de ${original.number} · ${refund.items.map(item => item.description).join(', ')}`;
  run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id, invoice_id)
       VALUES ('sale', ?, ?, ?, ?, ?, ?, ?, ?)`,
    localDate(), category.id, str(description, 300), -refund.refunded, -profitLost, str(register.payment_method, 40), user.id, refundId);
}

// What the refund dialog needs to propose a product and the profit that goes with the money.
route('GET', '/api/invoices/:id/sale', 'user', ({ user, params }) => {
  const invoice = get('SELECT * FROM invoices WHERE id = ?', Number(params.id));
  if (!invoice) fail(404, 'Documento no encontrado');
  const sale = saleOf(invoice);
  if (!sale) return { found: false };
  const seesProfit = isAdmin(user) || !!getSetting('permissions').worker_see_daily_profit;
  return {
    found: true, category_id: sale.category_id, payment_method: sale.payment_method,
    amount: euros(sale.amount), profit: seesProfit ? euros(sale.profit) : undefined,
  };
});

module.exports = { oldestDateVisibleTo };

// Voiding keeps the document and its number; numbers are never reused.
route('POST', '/api/invoices/:id/void', 'admin', ({ params }) => {
  run('UPDATE invoices SET voided = 1 WHERE id = ?', Number(params.id));
  return { ok: true };
});
