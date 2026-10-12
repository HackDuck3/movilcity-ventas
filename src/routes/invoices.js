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

// Shares `total` among parts in proportion to their weights, in whole cents that add up exactly.
function shareOut(total, weights) {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  let given = 0;
  return weights.map((weight, index) => {
    const share = index === weights.length - 1 ? total - given : Math.round(weightSum ? total * weight / weightSum : 0);
    given += share;
    return share;
  });
}

// An invoice can point at a sale already in the register, or create its sales itself: one per line,
// each under its own product, so the register and the charts show what was really sold.
// An invoice that replaces a ticket does neither: the sale was recorded with the ticket.
function linkToSale(invoiceId, body, sale, user) {
  if (body.movement_id) {
    run('UPDATE movements SET invoice_id = ? WHERE id = ? AND type = ? AND invoice_id IS NULL', invoiceId, Number(body.movement_id), 'sale');
    return;
  }
  const { register } = body;
  if (!register) return;
  // register.lines[i] = { category_id, profit } for sale.items[i]. Without it, the whole document is one sale.
  const perLine = Array.isArray(register.lines);
  if (perLine && register.lines.length !== sale.items.length) fail(400, 'Cada línea necesita su producto y su beneficio');
  if (!perLine && !register.category_id) return;
  const lines = perLine ? register.lines : [{ category_id: register.category_id, profit: register.profit }];

  const gross = perLine ? sale.items.map(item => item.qty * item.price) : [sale.total + sale.discount];
  // A discount lowers what each line brought in, and comes out of its profit.
  const discounts = shareOut(sale.discount, gross);
  lines.forEach((line, index) => {
    const amount = gross[index] - discounts[index];
    if (amount <= 0) return; // a free line is not a sale
    const items = perLine ? [sale.items[index]] : sale.items;
    const m = validateMovement({
      type: 'sale',
      category_id: line.category_id,
      amount: euros(amount),
      profit: perLine ? euros((cents(line.profit) ?? NaN) - discounts[index]) : line.profit,
      payment_method: register.payment_method,
      description: items.map(item => [item.qty > 1 ? `${item.qty} ×` : '', item.description, item.detail].filter(Boolean).join(' ')).join(' · '),
    }, user);
    run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id, invoice_id, invoice_line)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      'sale', sale.date, m.category_id, m.description, m.amount, m.profit, m.payment_method, user.id, invoiceId, perLine ? index : null);
  });
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
    if (!replacedTicket) linkToSale(id, body, { items, total, discount, date }, user);
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

// The sales behind a document. For an invoice that replaced a ticket, they hang from the ticket.
// Documents recorded line by line have one sale per line; older ones have a single sale for everything.
function salesOf(invoice) {
  const sales = all(`SELECT * FROM movements WHERE invoice_id IN (?, ?) AND type = 'sale' AND amount > 0 AND deleted_at IS NULL ORDER BY id`,
    invoice.id, invoice.replaces_id || invoice.id);
  return {
    whole: sales.find(sale => sale.invoice_line === null) || null,
    byLine: Object.fromEntries(sales.filter(sale => sale.invoice_line !== null).map(sale => [sale.invoice_line, sale])),
  };
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
    if (body.register) registerRefund(id, number, original, { items, gross, refunded }, body.register, user);
    return { ok: true, id, number };
  });
});

// Takes the money out of the register as negative sales, one per returned line and under that line's
// product, so the day's totals, the profit and the charts go down where they went up.
function registerRefund(refundId, number, original, refund, register, user) {
  const sales = salesOf(original);
  const amounts = shareOut(refund.refunded, refund.items.map(item => -item.qty * item.price));
  const typedProfit = cents(register.profit);

  refund.items.forEach((item, index) => {
    const sale = sales.byLine[item.line] || sales.whole;
    // A line recorded on its own goes back under its product; otherwise the user says which one.
    const categoryId = (sales.byLine[item.line] && sale.category_id) || Number(register.category_id) || (sale && sale.category_id);
    const category = get("SELECT id FROM categories WHERE id = ? AND kind = 'sale'", categoryId);
    if (!category) fail(400, 'Elige el producto de la venta que se devuelve');
    // Without a figure from the user, the profit lost is the sale's profit in proportion to what is returned.
    const proportional = sale && sale.amount ? Math.round(sale.profit * amounts[index] / sale.amount) : 0;
    const profitLost = typedProfit === null ? proportional : Math.round(refund.refunded ? typedProfit * amounts[index] / refund.refunded : 0);
    run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id, invoice_id, invoice_line)
         VALUES ('sale', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      localDate(), category.id, str(`Devolución ${number} de ${original.number} · ${item.description}`, 300),
      -amounts[index], -profitLost, str(register.payment_method, 40), user.id, refundId, index);
  });
}

// What the refund dialog needs to propose a product and the profit that goes with the money.
route('GET', '/api/invoices/:id/sale', 'user', ({ user, params }) => {
  const invoice = get('SELECT * FROM invoices WHERE id = ?', Number(params.id));
  if (!invoice) fail(404, 'Documento no encontrado');
  const seesProfit = isAdmin(user) || !!getSetting('permissions').worker_see_daily_profit;
  const summary = (sale) => sale && {
    category_id: sale.category_id, payment_method: sale.payment_method,
    amount: euros(sale.amount), profit: seesProfit ? euros(sale.profit) : undefined,
  };
  const sales = salesOf(invoice);
  // `whole` is the single sale of a document recorded in one go; `lines` holds one sale per line index.
  return {
    whole: summary(sales.whole),
    lines: Object.fromEntries(Object.entries(sales.byLine).map(([line, sale]) => [line, summary(sale)])),
  };
});

// Voiding keeps the document and its number; numbers are never reused.
route('POST', '/api/invoices/:id/void', 'admin', ({ params }) => {
  run('UPDATE invoices SET voided = 1 WHERE id = ?', Number(params.id));
  return { ok: true };
});

module.exports = { oldestDateVisibleTo };
