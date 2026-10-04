'use strict';
// Tickets (simplified invoices) and full invoices share one table and differ in `kind`.
const { all, get, run, tx } = require('../db');
const { getSetting, setSetting } = require('../settings');
const { route, fail } = require('../http');
const { cents, euros, localDate, addDays, isDate, str } = require('../utils');
const { validateMovement } = require('./movements');

const isAdmin = (user) => user.role === 'admin';

const INVOICE_SELECT = `
  SELECT i.*, u.name AS user_name, replaced.number AS replaces_number, replaced.date AS replaces_date,
         replacement.id AS replaced_by_id, replacement.number AS replaced_by_number
  FROM invoices i
  LEFT JOIN users u ON u.id = i.user_id
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
  return toResponse(invoice);
});

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
    address: str(body.customer_address, 200), phone: str(body.customer_phone, 30),
  };
  if (kind === 'factura' && (!customer.name || !customer.nif || !customer.address)) {
    fail(400, 'Una factura completa necesita nombre, NIF y dirección del cliente. Si no los tienes, haz un ticket.');
  }
  const showVat = 'show_vat' in body ? !!body.show_vat : !!getSetting('invoice').show_vat;
  const replacedTicket = findTicketToReplace(body.replaces_id);

  return tx(() => {
    const number = takeNextNumber(kind);
    const { id } = run(`INSERT INTO invoices (number, kind, date, customer_name, customer_nif, customer_address, customer_phone,
                        items, subtotal, discount, total, notes, user_id, replaces_id, show_vat) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, kind, date, customer.name, customer.nif, customer.address, customer.phone,
      JSON.stringify(items), subtotal, discount, total, str(body.notes, 500), user.id,
      replacedTicket ? replacedTicket.id : null, showVat ? 1 : 0);
    if (!replacedTicket) linkToSale(id, body, { items, total, date }, user);
    return { ok: true, id, number };
  });
});

// Voiding keeps the document and its number; numbers are never reused.
route('POST', '/api/invoices/:id/void', 'admin', ({ params }) => {
  run('UPDATE invoices SET voided = 1 WHERE id = ?', Number(params.id));
  return { ok: true };
});
