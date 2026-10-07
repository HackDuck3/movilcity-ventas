'use strict';
// Used phones bought from private sellers. Each purchase produces a contract, can add the phone to stock
// and can record the payment as an expense. The list doubles as the shop's register of used goods bought.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { all, get, run, tx, ID_DOCUMENTS_DIR } = require('../db');
const { getSetting, setSetting } = require('../settings');
const { route, fail, HttpError } = require('../http');
const { cents, euros, localDate, isDate, str, dateRange } = require('../utils');
const { recordExpense } = require('./movements');

const PURCHASE_SELECT = 'SELECT p.*, u.name AS user_name FROM purchases p LEFT JOIN users u ON u.id = p.user_id';
const ID_DOCUMENT_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_ID_DOCUMENT_BYTES = 8 * 1024 * 1024;

function requireAccess(user) {
  if (!getSetting('modules').purchases) fail(403, 'El módulo de compras está desactivado');
  if (user.role !== 'admin' && !getSetting('permissions').worker_create_purchases) fail(403, 'No tienes permiso para registrar compras');
}

// The file name of the identity document never leaves the server; clients only learn whether there is one.
function toResponse(purchase) {
  const { id_document: idDocument, id_document_mime: mime, ...rest } = purchase;
  return { ...rest, price: euros(purchase.price), has_id_document: !!idDocument };
}

function findPurchase(id) {
  const purchase = get(`${PURCHASE_SELECT} WHERE p.id = ?`, Number(id));
  if (!purchase) fail(404, 'Compra no encontrada');
  return purchase;
}

function fieldsFromBody(body) {
  const fields = {
    seller_name: str(body.seller_name, 120),
    seller_nif: str(body.seller_nif, 30),
    seller_address: str(body.seller_address, 200),
    seller_phone: str(body.seller_phone, 30),
    brand: str(body.brand, 60),
    model: str(body.model, 80),
    imei: str(body.imei, 40),
    condition: str(body.condition, 300),
    price: cents(body.price),
    payment_method: str(body.payment_method, 40),
  };
  if (!fields.seller_name || !fields.seller_nif) fail(400, 'Indica el nombre y el DNI/NIE del vendedor');
  if (!fields.seller_address) fail(400, 'Indica el domicilio del vendedor');
  if (!fields.model) fail(400, 'Indica el modelo del móvil');
  if (!fields.imei) fail(400, 'Indica el IMEI: identifica el móvil en el contrato');
  if (!fields.price || fields.price <= 0) fail(400, 'Indica el precio pagado');
  return fields;
}

// Must run inside a transaction.
function takeNextNumber() {
  const config = getSetting('purchases');
  const number = `${config.prefix || ''}${config.next_number}`;
  if (get('SELECT 1 AS found FROM purchases WHERE number = ?', number)) {
    fail(400, `El número ${number} ya existe. Revisa la numeración en Ajustes → Compras.`);
  }
  setSetting('purchases', { ...config, next_number: Number(config.next_number) + 1 });
  return number;
}

route('GET', '/api/purchases', 'user', ({ user, query }) => {
  requireAccess(user);
  const conditions = ['1=1'];
  const values = [];
  if (query.q) {
    const like = `%${query.q}%`;
    conditions.push('(p.number LIKE ? OR p.seller_name LIKE ? OR p.seller_nif LIKE ? OR p.brand LIKE ? OR p.model LIKE ? OR p.imei LIKE ?)');
    values.push(like, like, like, like, like, like);
  }
  return all(`${PURCHASE_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY p.id DESC LIMIT 300`, ...values).map(toResponse);
});

route('GET', '/api/purchases/:id', 'user', ({ user, params }) => {
  requireAccess(user);
  return toResponse(findPurchase(params.id));
});

// body.add_to_stock: also create the phone in stock.  body.expense_category_id: also record the payment as an expense.
route('POST', '/api/purchases', 'user', ({ user, body }) => {
  requireAccess(user);
  const f = fieldsFromBody(body);
  const date = user.role === 'admin' && isDate(body.date) ? body.date : localDate();
  const device = [f.brand, f.model].filter(Boolean).join(' ');

  return tx(() => {
    const number = takeNextNumber();
    let deviceId = null;
    if (body.add_to_stock && getSetting('modules').stock) {
      deviceId = run(`INSERT INTO devices (brand, model, imei, condition, cost, notes, purchased_on, user_id) VALUES (?,?,?,?,?,?,?,?)`,
        f.brand, f.model, f.imei, 'used', f.price, `Compra ${number}${f.condition ? ` · ${f.condition}` : ''}`, date, user.id).id;
    }
    const movementId = body.expense_category_id
      ? recordExpense({
        category_id: body.expense_category_id, amount: euros(f.price), payment_method: f.payment_method,
        description: `Compra ${number} · ${device} IMEI ${f.imei}`, date,
      }, user)
      : null;
    const { id } = run(`INSERT INTO purchases (number, date, seller_name, seller_nif, seller_address, seller_phone, brand, model, imei,
                        condition, price, payment_method, device_id, movement_id, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, date, f.seller_name, f.seller_nif, f.seller_address, f.seller_phone, f.brand, f.model, f.imei,
      f.condition, f.price, f.payment_method, deviceId, movementId, user.id);
    return { ok: true, id, number };
  });
});

route('POST', '/api/purchases/:id/void', 'admin', ({ params }) => {
  run('UPDATE purchases SET voided = 1 WHERE id = ?', findPurchase(params.id).id);
  return { ok: true };
});

// ---- Photo of the seller's identity document
const idDocumentPath = (fileName) => path.join(ID_DOCUMENTS_DIR, fileName);

// The request body is the raw image. It replaces any previous one.
route('POST', '/api/purchases/:id/id-document', 'user', ({ req, user, params }) => new Promise((resolve, reject) => {
  requireAccess(user);
  const purchase = findPurchase(params.id);
  const mime = String(req.headers['content-type'] || '').split(';')[0];
  const extension = ID_DOCUMENT_TYPES[mime];
  if (!extension) return reject(new HttpError(400, 'La foto del documento debe ser JPG, PNG o WebP'));

  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_ID_DOCUMENT_BYTES) {
      reject(new HttpError(413, 'La foto es demasiado grande'));
      req.destroy();
    } else chunks.push(chunk);
  });
  req.on('error', reject);
  req.on('end', () => {
    if (!size) return reject(new HttpError(400, 'La foto está vacía'));
    const fileName = crypto.randomBytes(16).toString('hex') + extension;
    fs.writeFileSync(idDocumentPath(fileName), Buffer.concat(chunks), { mode: 0o600 });
    run('UPDATE purchases SET id_document = ?, id_document_mime = ? WHERE id = ?', fileName, mime, purchase.id);
    if (purchase.id_document) fs.rm(idDocumentPath(purchase.id_document), { force: true }, () => {});
    resolve({ ok: true });
  });
}), { raw: true });

// Only admins can look at identity documents afterwards.
route('GET', '/api/admin/purchases/:id/id-document', 'admin', ({ params, res }) => {
  const purchase = findPurchase(params.id);
  if (!purchase.id_document || !fs.existsSync(idDocumentPath(purchase.id_document))) fail(404, 'Esta compra no tiene foto del documento');
  res.sendFile(idDocumentPath(purchase.id_document), purchase.id_document_mime, `documento-${purchase.number}`, true);
});

// ---- Register of used goods bought, for the gestoría or the police
const csvCell = (value) => {
  const text = String(value ?? '');
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

route('GET', '/api/admin/purchases-register.csv', 'admin', ({ query, res }) => {
  const { from, to } = dateRange(query);
  const header = ['numero', 'fecha', 'vendedor', 'dni_nie', 'domicilio', 'telefono', 'marca', 'modelo', 'imei', 'estado', 'precio', 'forma_pago', 'anulada'];
  const rows = all('SELECT * FROM purchases WHERE date BETWEEN ? AND ? ORDER BY id', from, to).map(p => [
    p.number, p.date, p.seller_name, p.seller_nif, p.seller_address, p.seller_phone, p.brand, p.model, p.imei, p.condition,
    euros(p.price).toFixed(2).replace('.', ','), p.payment_method, p.voided ? 'sí' : '',
  ].map(csvCell).join(';'));
  res.sendRaw(200, '﻿' + [header.join(';'), ...rows].join('\r\n'), 'text/csv; charset=utf-8', `registro-compras_${from}_${to}.csv`);
});
