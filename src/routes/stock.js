'use strict';
// Phone stock: each device is added with its cost and sold with one click, so profit is never typed by hand.
const { all, get, run, tx } = require('../db');
const { getSetting } = require('../settings');
const { route, fail } = require('../http');
const { cents, euros, localDate, isDate, str } = require('../utils');
const { recordSale } = require('./movements');

const isAdmin = (user) => user.role === 'admin';

function requireModule() {
  if (!getSetting('modules').stock) fail(403, 'El módulo de stock está desactivado');
}

// The cost reveals the profit, so workers only see it when they are allowed to see profit.
function toResponse(device, user) {
  const canSeeCost = isAdmin(user) || getSetting('permissions').worker_see_daily_profit;
  return {
    ...device,
    cost: canSeeCost ? euros(device.cost) : undefined,
    price: device.price == null ? null : euros(device.price),
  };
}

function findDevice(id) {
  const device = get('SELECT * FROM devices WHERE id = ?', Number(id));
  if (!device) fail(404, 'Móvil no encontrado');
  return device;
}

function fieldsFromBody(body) {
  const fields = {
    brand: str(body.brand, 60),
    model: str(body.model, 80),
    imei: str(body.imei, 40),
    condition: body.condition === 'used' ? 'used' : 'new',
    cost: cents(body.cost),
    price: cents(body.price),
    notes: str(body.notes, 300),
    purchased_on: isDate(body.purchased_on) ? body.purchased_on : localDate(),
  };
  if (!fields.model) fail(400, 'Indica el modelo');
  if (fields.cost === null || fields.cost < 0) fail(400, 'Indica lo que te costó el móvil');
  return fields;
}

route('GET', '/api/stock', 'user', ({ user, query }) => {
  requireModule();
  const conditions = [query.sold === '1' ? 'd.sold_on IS NOT NULL' : 'd.sold_on IS NULL'];
  const values = [];
  if (query.q) {
    const like = `%${query.q}%`;
    conditions.push('(d.brand LIKE ? OR d.model LIKE ? OR d.imei LIKE ?)');
    values.push(like, like, like);
  }
  const devices = all(`SELECT d.* FROM devices d WHERE ${conditions.join(' AND ')}
                       ORDER BY COALESCE(d.sold_on, d.purchased_on) DESC, d.id DESC LIMIT 500`, ...values);
  return devices.map(device => toResponse(device, user));
});

route('POST', '/api/admin/stock', 'admin', ({ user, body }) => {
  requireModule();
  const f = fieldsFromBody(body);
  const { id } = run(`INSERT INTO devices (brand, model, imei, condition, cost, price, notes, purchased_on, user_id)
                      VALUES (?,?,?,?,?,?,?,?,?)`,
    f.brand, f.model, f.imei, f.condition, f.cost, f.price, f.notes, f.purchased_on, user.id);
  return { ok: true, id };
});

route('PUT', '/api/admin/stock/:id', 'admin', ({ params, body }) => {
  const device = findDevice(params.id);
  if (device.sold_on) fail(400, 'Este móvil ya está vendido');
  const f = fieldsFromBody(body);
  run('UPDATE devices SET brand=?, model=?, imei=?, condition=?, cost=?, price=?, notes=?, purchased_on=? WHERE id=?',
    f.brand, f.model, f.imei, f.condition, f.cost, f.price, f.notes, f.purchased_on, device.id);
  return { ok: true };
});

route('DELETE', '/api/admin/stock/:id', 'admin', ({ params }) => {
  const device = findDevice(params.id);
  if (device.sold_on) fail(400, 'Un móvil vendido no se puede borrar: forma parte del historial');
  run('DELETE FROM devices WHERE id = ?', device.id);
  return { ok: true };
});

route('POST', '/api/stock/:id/sell', 'user', ({ user, params, body }) => {
  requireModule();
  const device = findDevice(params.id);
  if (device.sold_on) fail(400, 'Este móvil ya está vendido');
  const price = cents(body.price);
  if (!price || price <= 0) fail(400, 'Indica el precio de venta');

  return tx(() => {
    const description = [device.brand, device.model, device.imei && `IMEI ${device.imei}`].filter(Boolean).join(' ');
    const movementId = recordSale({
      category_id: body.category_id,
      amount: euros(price),
      profit: euros(price - device.cost),
      payment_method: body.payment_method,
      description,
    }, user);
    run('UPDATE devices SET sold_on = ?, movement_id = ? WHERE id = ?', localDate(), movementId, device.id);
    return { ok: true, movement_id: movementId, description };
  });
});
