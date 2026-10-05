'use strict';
// Repair receipts: what the customer leaves, what is wrong with it and the agreed price.
const { all, get, run, tx } = require('../db');
const { getSetting, setSetting } = require('../settings');
const { route, fail } = require('../http');
const { cents, euros, localDate, isDate, str } = require('../utils');

const REPAIR_SELECT = 'SELECT r.*, u.name AS user_name FROM repairs r LEFT JOIN users u ON u.id = r.user_id';
const PATTERN_FORMAT = /^[1-9](-[1-9]){0,8}$/;

function requireAccess(user) {
  if (!getSetting('modules').repairs) fail(403, 'El módulo de reparaciones está desactivado');
  if (user.role !== 'admin' && !getSetting('permissions').worker_create_repairs) fail(403, 'No tienes permiso para gestionar reparaciones');
}

function toResponse(repair) {
  return { ...repair, faults: JSON.parse(repair.faults), amount: repair.amount == null ? null : euros(repair.amount) };
}

function findRepair(id) {
  const repair = get(`${REPAIR_SELECT} WHERE r.id = ?`, Number(id));
  if (!repair) fail(404, 'Reparación no encontrada');
  return repair;
}

function fieldsFromBody(body) {
  const fields = {
    customer_name: str(body.customer_name, 120),
    customer_nif: str(body.customer_nif, 30),
    customer_phone: str(body.customer_phone, 30),
    brand: str(body.brand, 60),
    model: str(body.model, 80),
    imei: str(body.imei, 40),
    carrier: str(body.carrier, 60),
    unlock_code: str(body.unlock_code, 40),
    pattern: PATTERN_FORMAT.test(body.pattern || '') ? body.pattern : '',
    faults: JSON.stringify((Array.isArray(body.faults) ? body.faults : []).map(fault => str(fault, 40)).filter(Boolean)),
    notes: str(body.notes, 300),
    condition: str(body.condition, 300),
    amount: cents(body.amount),
  };
  if (!fields.brand && !fields.model) fail(400, 'Indica la marca o el modelo del terminal');
  if (!fields.customer_name && !fields.customer_phone) fail(400, 'Indica el nombre o el teléfono del cliente');
  if (fields.faults === '[]' && !fields.notes) fail(400, 'Marca al menos una reparación o descríbela en "Otros"');
  if (fields.amount !== null && fields.amount < 0) fail(400, 'El importe no puede ser negativo');
  return fields;
}

// Must run inside a transaction.
function takeNextNumber() {
  const config = getSetting('repairs');
  const number = `${config.prefix || ''}${config.next_number}`;
  if (get('SELECT 1 AS found FROM repairs WHERE number = ?', number)) {
    fail(400, `El número ${number} ya existe. Revisa la numeración en Ajustes → Reparaciones.`);
  }
  setSetting('repairs', { ...config, next_number: Number(config.next_number) + 1 });
  return number;
}

route('GET', '/api/repairs', 'user', ({ user, query }) => {
  requireAccess(user);
  const conditions = ['1=1'];
  const values = [];
  if (['pending', 'collected'].includes(query.status)) {
    conditions.push('r.status = ? AND r.voided = 0');
    values.push(query.status);
  }
  if (query.q) {
    const like = `%${query.q}%`;
    conditions.push('(r.number LIKE ? OR r.customer_name LIKE ? OR r.customer_phone LIKE ? OR r.brand LIKE ? OR r.model LIKE ? OR r.imei LIKE ?)');
    values.push(like, like, like, like, like, like);
  }
  return all(`${REPAIR_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY r.id DESC LIMIT 300`, ...values).map(toResponse);
});

route('GET', '/api/repairs/:id', 'user', ({ user, params }) => {
  requireAccess(user);
  return toResponse(findRepair(params.id));
});

route('POST', '/api/repairs', 'user', ({ user, body }) => {
  requireAccess(user);
  const f = fieldsFromBody(body);
  const date = user.role === 'admin' && isDate(body.date) ? body.date : localDate();
  return tx(() => {
    const number = takeNextNumber();
    const { id } = run(`INSERT INTO repairs (number, date, customer_name, customer_nif, customer_phone, brand, model, imei, carrier,
                        unlock_code, pattern, faults, notes, condition, amount, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, date, f.customer_name, f.customer_nif, f.customer_phone, f.brand, f.model, f.imei, f.carrier,
      f.unlock_code, f.pattern, f.faults, f.notes, f.condition, f.amount, user.id);
    return { ok: true, id, number };
  });
});

route('PUT', '/api/repairs/:id', 'user', ({ user, params, body }) => {
  requireAccess(user);
  const repair = findRepair(params.id);
  if (repair.voided) fail(400, 'Esta reparación está anulada');
  const f = fieldsFromBody(body);
  run(`UPDATE repairs SET customer_name=?, customer_nif=?, customer_phone=?, brand=?, model=?, imei=?, carrier=?,
       unlock_code=?, pattern=?, faults=?, notes=?, condition=?, amount=? WHERE id=?`,
    f.customer_name, f.customer_nif, f.customer_phone, f.brand, f.model, f.imei, f.carrier,
    f.unlock_code, f.pattern, f.faults, f.notes, f.condition, f.amount, repair.id);
  return { ok: true };
});

route('POST', '/api/repairs/:id/status', 'user', ({ user, params, body }) => {
  requireAccess(user);
  const repair = findRepair(params.id);
  if (!['pending', 'collected'].includes(body.status)) fail(400, 'Estado no válido');
  const collectedAt = body.status === 'collected' ? "datetime('now','localtime')" : 'NULL';
  run(`UPDATE repairs SET status = ?, collected_at = ${collectedAt} WHERE id = ?`, body.status, repair.id);
  return { ok: true };
});

route('POST', '/api/repairs/:id/void', 'admin', ({ params }) => {
  run('UPDATE repairs SET voided = 1 WHERE id = ?', findRepair(params.id).id);
  return { ok: true };
});
