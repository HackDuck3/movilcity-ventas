'use strict';
// Repair receipts: what the customer leaves, what is wrong with it and the agreed price.
const { all, get, run, tx } = require('../db');
const { getSetting, setSetting } = require('../settings');
const { route, fail } = require('../http');
const { cents, euros, localDate, addDays, isDate, str } = require('../utils');
const { recordSale } = require('./movements');

const REPAIR_SELECT = 'SELECT r.*, u.name AS user_name FROM repairs r LEFT JOIN users u ON u.id = r.user_id';
const PATTERN_FORMAT = /^[1-9](-[1-9]){0,8}$/;

// The stored status is only pending/collected; "ready" is a pending repair with ready_at set.
const STAGE_CONDITIONS = {
  pending: "r.status = 'pending' AND r.ready_at IS NULL AND r.voided = 0",
  ready: "r.status = 'pending' AND r.ready_at IS NOT NULL AND r.voided = 0",
  collected: "r.status = 'collected' AND r.voided = 0",
};
// A repair is "forgotten" when it has not been collected after the number of days set in settings.
const FORGOTTEN = "r.status = 'pending' AND r.voided = 0 AND r.date <= ?";
const forgottenBefore = () => addDays(localDate(), -(Number(getSetting('repairs').reminder_days) || 15));

function requireAccess(user) {
  if (!getSetting('modules').repairs) fail(403, 'El módulo de reparaciones está desactivado');
  if (user.role !== 'admin' && !getSetting('permissions').worker_create_repairs) fail(403, 'No tienes permiso para gestionar reparaciones');
}

const eurosOrNull = (amount) => (amount == null ? null : euros(amount));

function stageOf(repair) {
  if (repair.status === 'collected') return 'collected';
  return repair.ready_at ? 'ready' : 'pending';
}

function toResponse(repair) {
  return {
    ...repair,
    stage: stageOf(repair),
    faults: JSON.parse(repair.faults),
    amount: eurosOrNull(repair.amount),
    deposit: eurosOrNull(repair.deposit),
  };
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
    deposit: cents(body.deposit) || null,
    due_on: isDate(body.due_on) ? body.due_on : null,
  };
  if (!fields.brand && !fields.model) fail(400, 'Indica la marca o el modelo del terminal');
  if (!fields.customer_name && !fields.customer_phone) fail(400, 'Indica el nombre o el teléfono del cliente');
  if (fields.faults === '[]' && !fields.notes) fail(400, 'Marca al menos una reparación o descríbela en "Otros"');
  if (fields.amount !== null && fields.amount < 0) fail(400, 'El importe no puede ser negativo');
  if (fields.deposit !== null && fields.deposit < 0) fail(400, 'La señal no puede ser negativa');
  if (fields.deposit !== null && fields.amount !== null && fields.deposit > fields.amount) fail(400, 'La señal no puede superar el importe');
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

const saleDescription = (prefix, repair) => `${prefix} ${repair.number} · ${[repair.brand, repair.model].filter(Boolean).join(' ')}`;

// Puts the advance payment in the cash register. Profit is entered later, when the repair is collected.
function registerDeposit(repair, register, user) {
  const movementId = recordSale({
    category_id: register.category_id,
    amount: euros(repair.deposit),
    profit: 0,
    payment_method: register.payment_method,
    description: saleDescription('Señal reparación', repair),
  }, user);
  run('UPDATE repairs SET deposit_movement_id = ? WHERE id = ?', movementId, repair.id);
}

route('GET', '/api/repairs', 'user', ({ user, query }) => {
  requireAccess(user);
  const conditions = ['1=1'];
  const values = [];
  if (STAGE_CONDITIONS[query.status]) conditions.push(STAGE_CONDITIONS[query.status]);
  if (query.status === 'forgotten') {
    conditions.push(FORGOTTEN);
    values.push(forgottenBefore());
  }
  if (query.q) {
    const like = `%${query.q}%`;
    conditions.push('(r.number LIKE ? OR r.customer_name LIKE ? OR r.customer_phone LIKE ? OR r.brand LIKE ? OR r.model LIKE ? OR r.imei LIKE ?)');
    values.push(like, like, like, like, like, like);
  }
  return all(`${REPAIR_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY r.id DESC LIMIT 300`, ...values).map(toResponse);
});

route('GET', '/api/repairs/summary', 'user', ({ user }) => {
  requireAccess(user);
  const count = (condition, ...values) => get(`SELECT COUNT(*) AS n FROM repairs r WHERE ${condition}`, ...values).n;
  return {
    pending: count(STAGE_CONDITIONS.pending),
    ready: count(STAGE_CONDITIONS.ready),
    forgotten: count(FORGOTTEN, forgottenBefore()),
  };
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
                        unlock_code, pattern, faults, notes, condition, amount, deposit, due_on, user_id)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, date, f.customer_name, f.customer_nif, f.customer_phone, f.brand, f.model, f.imei, f.carrier,
      f.unlock_code, f.pattern, f.faults, f.notes, f.condition, f.amount, f.deposit, f.due_on, user.id);
    if (f.deposit && body.register_deposit) registerDeposit({ ...f, id, number }, body.register_deposit, user);
    return { ok: true, id, number };
  });
});

route('PUT', '/api/repairs/:id', 'user', ({ user, params, body }) => {
  requireAccess(user);
  const repair = findRepair(params.id);
  if (repair.voided) fail(400, 'Esta reparación está anulada');
  const f = fieldsFromBody(body);
  // Once the deposit is in the register its amount is fixed, so both always agree.
  const deposit = repair.deposit_movement_id ? repair.deposit : f.deposit;
  run(`UPDATE repairs SET customer_name=?, customer_nif=?, customer_phone=?, brand=?, model=?, imei=?, carrier=?,
       unlock_code=?, pattern=?, faults=?, notes=?, condition=?, amount=?, deposit=?, due_on=? WHERE id=?`,
    f.customer_name, f.customer_nif, f.customer_phone, f.brand, f.model, f.imei, f.carrier,
    f.unlock_code, f.pattern, f.faults, f.notes, f.condition, f.amount, deposit, f.due_on, repair.id);
  return { ok: true };
});

// Charges what is still owed and links the sale to the repair. Only possible once per repair.
// register.profit is the profit of the whole repair. A sale cannot hold more profit than its amount,
// so whatever does not fit in this payment is added to the deposit already in the register.
function registerCollection(repair, register, user) {
  if (repair.movement_id) fail(400, 'Esta reparación ya se cobró en caja');
  const charged = cents(register.amount) || 0;
  const totalProfit = cents(register.profit);
  if (totalProfit === null) fail(400, 'Indica el beneficio');
  const depositInRegister = repair.deposit_movement_id ? repair.deposit : 0;
  if (totalProfit > charged + depositInRegister) fail(400, 'El beneficio no puede ser mayor que el importe de la reparación');

  const profitInThisPayment = Math.min(totalProfit, charged);
  const profitInDeposit = totalProfit - profitInThisPayment;
  if (profitInDeposit) run('UPDATE movements SET profit = ? WHERE id = ?', profitInDeposit, repair.deposit_movement_id);

  const movementId = charged > 0
    ? recordSale({
      category_id: register.category_id,
      amount: euros(charged),
      profit: euros(profitInThisPayment),
      payment_method: register.payment_method,
      description: saleDescription('Reparación', repair),
    }, user)
    : repair.deposit_movement_id; // fully paid in advance: the deposit is the sale
  if (!movementId) fail(400, 'Indica el importe cobrado');
  run('UPDATE repairs SET amount = ?, movement_id = ? WHERE id = ?', charged + (repair.deposit || 0), movementId, repair.id);
  return movementId;
}

// body.status: 'pending' | 'ready' | 'collected'
route('POST', '/api/repairs/:id/status', 'user', ({ user, params, body }) => {
  requireAccess(user);
  const repair = findRepair(params.id);
  const NOW = "datetime('now','localtime')";
  const changes = {
    pending: "status = 'pending', ready_at = NULL, collected_at = NULL",
    ready: `status = 'pending', ready_at = ${NOW}, collected_at = NULL`,
    collected: `status = 'collected', collected_at = ${NOW}`,
  }[body.status];
  if (!changes) fail(400, 'Estado no válido');

  return tx(() => {
    run(`UPDATE repairs SET ${changes} WHERE id = ?`, repair.id);
    if (body.status !== 'collected' || !body.register) return { ok: true };
    return { ok: true, movement_id: registerCollection(repair, body.register, user) };
  });
});

route('POST', '/api/repairs/:id/void', 'admin', ({ params }) => {
  run('UPDATE repairs SET voided = 1 WHERE id = ?', findRepair(params.id).id);
  return { ok: true };
});
