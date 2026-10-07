// End-to-end smoke test: boots the real server on a temporary database and walks through the main flows.
// Run with:  npm test
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 4100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'movilcity-test-'));
let server;

function client() {
  let cookie = '';
  return async function request(method, url, body, headers = {}) {
    const isJson = body !== undefined && !(body instanceof Uint8Array);
    const res = await fetch(BASE + url, {
      method,
      headers: { 'X-Requested-With': 'app', Cookie: cookie, ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: isJson ? JSON.stringify(body) : body,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data };
  };
}

const admin = client();
const worker = client();

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => { if (String(chunk).includes('localhost')) resolve(); });
    server.on('exit', (code) => reject(new Error(`server exited with code ${code}`)));
  });
});

after(() => {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('first run creates the admin account', async () => {
  assert.equal((await admin('GET', '/api/status')).data.needsSetup, true);
  const setup = await admin('POST', '/api/setup', { username: 'owner', name: 'Owner', password: 'secret1', shopName: 'Test Shop' });
  assert.equal(setup.status, 200);
  const me = await admin('GET', '/api/me');
  assert.equal(me.data.user.role, 'admin');
  assert.equal(me.data.settings.shop.name, 'Test Shop');
});

test('requests without a session are rejected', async () => {
  assert.equal((await client()('GET', '/api/day')).status, 401);
});

test('login rejects a wrong password', async () => {
  assert.equal((await client()('POST', '/api/login', { username: 'owner', password: 'nope' })).status, 401);
});

test('seeded products carry a default warranty', async () => {
  const { data } = await admin('GET', '/api/categories');
  const byName = Object.fromEntries(data.map(c => [c.name, c]));
  assert.equal(byName['Movil'].warranty, 'Producto nuevo');
  assert.equal(byName['Reparacion'].warranty, 'Reparación');
  assert.equal(byName['Tarjeta SIM'].warranty, '');
});

test('admin manages products', async () => {
  const created = await admin('POST', '/api/admin/categories', { kind: 'sale', name: 'Test product', warranty: 'Software' });
  assert.equal(created.status, 200);
  const updated = await admin('PUT', `/api/admin/categories/${created.data.id}`, { name: 'Renamed product', default_price: 9.5 });
  assert.equal(updated.status, 200);
  const all = (await admin('GET', '/api/categories?all=1')).data;
  const product = all.find(c => c.id === created.data.id);
  assert.deepEqual([product.name, product.default_price, product.warranty], ['Renamed product', 9.5, 'Software']);
});

test('products can be reordered and users change their own password', async () => {
  const sales = (await admin('GET', '/api/categories')).data.filter(c => c.kind === 'sale');
  const reversed = sales.map(c => c.id).reverse();
  assert.equal((await admin('POST', '/api/admin/categories/reorder', { ids: reversed })).status, 200);
  await admin('POST', '/api/admin/categories/reorder', { ids: sales.map(c => c.id) });

  assert.equal((await admin('POST', '/api/me/password', { current: 'wrong', password: 'secret2' })).status, 400);
  assert.equal((await admin('POST', '/api/me/password', { current: 'secret1', password: 'secret2' })).status, 200);
  assert.equal((await client()('POST', '/api/login', { username: 'owner', password: 'secret2' })).status, 200);
});

test('sales and expenses add up in the daily register', async () => {
  const categories = (await admin('GET', '/api/categories')).data;
  const sale = categories.find(c => c.kind === 'sale');
  const expense = categories.find(c => c.kind === 'expense');
  const created = await admin('POST', '/api/movements', { type: 'sale', category_id: sale.id, amount: '20,50', profit: 8, payment_method: 'Efectivo' });
  assert.equal(created.status, 200);
  await admin('POST', '/api/movements', { type: 'expense', category_id: expense.id, amount: 5 });
  assert.equal((await admin('POST', '/api/movements', { type: 'sale', category_id: sale.id, amount: 10, profit: 11 })).status, 400);

  const day = (await admin('GET', '/api/day')).data;
  assert.deepEqual([day.totals.sales, day.totals.profit, day.totals.expenses, day.totals.balance], [20.5, 8, 5, 15.5]);

  await admin('PUT', `/api/movements/${created.data.id}`, { category_id: sale.id, amount: 30, profit: 10 });
  assert.equal((await admin('GET', '/api/day')).data.totals.sales, 30);

  await admin('DELETE', `/api/movements/${created.data.id}`);
  assert.equal((await admin('GET', '/api/day')).data.totals.sales, 0);
  await admin('POST', `/api/admin/movements/${created.data.id}/restore`);
  assert.equal((await admin('GET', '/api/day')).data.totals.sales, 30);
});

test('tickets and invoices use separate numbering, warranties and the VAT switch', async () => {
  const ticket = await admin('POST', '/api/invoices', {
    kind: 'ticket', show_vat: false, discount: 2,
    items: [{ description: 'Funda', qty: 2, price: 6, warranty: 'Producto nuevo' }, { description: 'SIM', qty: 1, price: 10, warranty: 'Unknown' }],
  });
  assert.equal(ticket.data.number, 'T-1');
  const saved = (await admin('GET', `/api/invoices/${ticket.data.id}`)).data;
  assert.deepEqual([saved.subtotal, saved.total, saved.show_vat], [22, 20, false]);
  assert.match(saved.items[0].warranty_text, /3 años/);
  assert.equal(saved.items[1].warranty, '');

  assert.equal((await admin('POST', '/api/invoices', { kind: 'factura', items: [{ description: 'Movil', price: 100 }] })).status, 400);

  const invoice = await admin('POST', '/api/invoices', {
    kind: 'factura', replaces_id: ticket.data.id, show_vat: true,
    customer_name: 'Customer', customer_nif: 'X', customer_address: 'Street 1',
    items: [{ description: 'Funda', qty: 2, price: 6 }],
  });
  assert.equal(invoice.data.number, '1');
  const full = (await admin('GET', `/api/invoices/${invoice.data.id}`)).data;
  assert.deepEqual([full.show_vat, full.replaces_number], [true, 'T-1']);

  assert.equal((await admin('GET', '/api/invoices?kind=ticket')).data.length, 1);
  await admin('POST', `/api/invoices/${invoice.data.id}/void`);
  assert.equal((await admin('GET', `/api/invoices/${invoice.data.id}`)).data.voided, 1);
});

test('an invoice can register its sale in the daily register', async () => {
  const sale = (await admin('GET', '/api/categories')).data.find(c => c.kind === 'sale');
  const before = (await admin('GET', '/api/day')).data.sales.length;
  await admin('POST', '/api/invoices', {
    kind: 'ticket', items: [{ description: 'Cable', price: 7 }],
    register: { category_id: sale.id, profit: 3, payment_method: 'Tarjeta' },
  });
  const day = (await admin('GET', '/api/day')).data;
  assert.equal(day.sales.length, before + 1);
  assert.ok(day.sales.at(-1).invoice_id);
});

test('repair receipts are numbered, editable and tracked until collected', async () => {
  assert.equal((await admin('POST', '/api/repairs', { model: 'Phone' })).status, 400);
  const created = await admin('POST', '/api/repairs', {
    brand: 'Brand', model: 'Phone 15', customer_name: 'Customer', customer_phone: '600000000',
    unlock_code: '1234', pattern: '1-2-3-6', faults: ['Batería', 'Táctil / cristal'], notes: 'Leaves SIM', amount: '169',
  });
  assert.equal(created.data.number, 'R-1');
  const saved = (await admin('GET', `/api/repairs/${created.data.id}`)).data;
  assert.deepEqual([saved.amount, saved.status, saved.faults.length, saved.pattern], [169, 'pending', 2, '1-2-3-6']);

  await admin('PUT', `/api/repairs/${created.data.id}`, { ...saved, amount: 150, pattern: 'not-a-pattern' });
  await admin('POST', `/api/repairs/${created.data.id}/status`, { status: 'collected' });
  const collected = (await admin('GET', `/api/repairs/${created.data.id}`)).data;
  assert.deepEqual([collected.amount, collected.status, collected.pattern], [150, 'collected', '']);
  assert.ok(collected.collected_at);

  assert.equal((await admin('GET', '/api/repairs?status=pending')).data.length, 0);
  assert.equal((await admin('GET', '/api/repairs?q=Phone')).data.length, 1);
});

test('collecting a repair can charge it in the cash register once', async () => {
  const category = (await admin('GET', '/api/categories')).data.find(c => c.name === 'Reparacion');
  const repair = await admin('POST', '/api/repairs', { model: 'Phone', customer_phone: '600', notes: 'Screen', amount: 50 });
  assert.equal((await admin('GET', '/api/repairs/summary')).data.pending, 1);

  const before = (await admin('GET', '/api/day')).data.totals;
  const register = { category_id: category.id, amount: 60, profit: 40, payment_method: 'Efectivo' };
  const collected = await admin('POST', `/api/repairs/${repair.data.id}/status`, { status: 'collected', register });
  assert.ok(collected.data.movement_id);
  const after = (await admin('GET', '/api/day')).data.totals;
  assert.deepEqual([after.sales - before.sales, after.profit - before.profit], [60, 40]);
  assert.equal((await admin('GET', `/api/repairs/${repair.data.id}`)).data.amount, 60);

  await admin('POST', `/api/repairs/${repair.data.id}/status`, { status: 'pending' });
  assert.equal((await admin('POST', `/api/repairs/${repair.data.id}/status`, { status: 'collected', register })).status, 400);
});

test('a repair goes through ready, keeps its due date and discounts the deposit', async () => {
  const category = (await admin('GET', '/api/categories')).data.find(c => c.name === 'Reparacion');
  const before = (await admin('GET', '/api/day')).data.totals;
  const repair = await admin('POST', '/api/repairs', {
    model: 'Deposit phone', customer_phone: '611', notes: 'Screen', amount: 100, deposit: 30, due_on: '2030-01-15',
    register_deposit: { category_id: category.id, payment_method: 'Efectivo' },
  });
  const id = repair.data.id;
  assert.equal((await admin('POST', '/api/repairs', { model: 'X', customer_phone: '1', notes: 'Y', amount: 10, deposit: 20 })).status, 400);

  let saved = (await admin('GET', `/api/repairs/${id}`)).data;
  assert.deepEqual([saved.deposit, saved.due_on, saved.stage], [30, '2030-01-15', 'pending']);
  assert.equal((await admin('GET', '/api/day')).data.totals.sales - before.sales, 30);

  await admin('POST', `/api/repairs/${id}/status`, { status: 'ready' });
  assert.equal((await admin('GET', `/api/repairs/${id}`)).data.stage, 'ready');
  assert.deepEqual((await admin('GET', '/api/repairs?status=ready')).data.map(r => r.id), [id]);
  assert.equal((await admin('GET', '/api/repairs/summary')).data.ready, 1);

  await admin('PUT', `/api/repairs/${id}`, { ...saved, deposit: 5 });
  assert.equal((await admin('GET', `/api/repairs/${id}`)).data.deposit, 30);

  const tooMuch = { category_id: category.id, amount: 70, profit: 101, payment_method: 'Tarjeta' };
  assert.equal((await admin('POST', `/api/repairs/${id}/status`, { status: 'collected', register: tooMuch })).status, 400);
  const register = { category_id: category.id, amount: 70, profit: 85, payment_method: 'Tarjeta' };
  await admin('POST', `/api/repairs/${id}/status`, { status: 'collected', register });
  saved = (await admin('GET', `/api/repairs/${id}`)).data;
  assert.deepEqual([saved.stage, saved.amount], ['collected', 100]);
  const after = (await admin('GET', '/api/day')).data.totals;
  assert.deepEqual([after.sales - before.sales, after.profit - before.profit], [100, 85]);
});

test('one search finds tickets, repairs, stock and movements', async () => {
  const found = (await admin('GET', '/api/search?q=Deposit')).data;
  assert.equal(found.repairs[0].title, 'Deposit phone');
  assert.ok(found.movements.some(m => m.title.includes('Señal reparación')));
  assert.equal((await admin('GET', '/api/search?q=Funda')).data.invoices.length, 2);
  assert.equal((await admin('GET', '/api/search?q=x')).data.repairs.length, 0);
});

test('old pending repairs are listed as forgotten', async () => {
  const old = await admin('POST', '/api/repairs', { model: 'Old phone', customer_phone: '600', notes: 'Battery', date: '2020-01-01' });
  const forgotten = (await admin('GET', '/api/repairs?status=forgotten')).data;
  assert.deepEqual(forgotten.map(r => r.id), [old.data.id]);
  assert.equal((await admin('GET', '/api/repairs/summary')).data.forgotten, 1);
  await admin('POST', `/api/repairs/${old.data.id}/status`, { status: 'collected' });
});

test('selling a phone from stock records the sale with its profit', async () => {
  const category = (await admin('GET', '/api/categories')).data.find(c => c.name === 'Movil');
  assert.equal((await admin('POST', '/api/admin/stock', { model: 'No cost' })).status, 400);
  const device = await admin('POST', '/api/admin/stock', { brand: 'Brand', model: 'A16', imei: '3500', condition: 'used', cost: 100, price: 150 });
  assert.equal((await admin('GET', '/api/stock')).data[0].cost, 100);

  const before = (await admin('GET', '/api/day')).data.totals;
  const sold = await admin('POST', `/api/stock/${device.data.id}/sell`, { price: 140, category_id: category.id, payment_method: 'Tarjeta' });
  assert.match(sold.data.description, /A16 IMEI 3500/);
  const after = (await admin('GET', '/api/day')).data.totals;
  assert.deepEqual([after.sales - before.sales, after.profit - before.profit], [140, 40]);

  assert.equal((await admin('GET', '/api/stock')).data.length, 0);
  assert.equal((await admin('GET', '/api/stock?sold=1')).data.length, 1);
  assert.equal((await admin('GET', '/api/search?q=3500')).data.stock[0].sold, true);
  assert.equal((await admin('POST', `/api/stock/${device.data.id}/sell`, { price: 140, category_id: category.id })).status, 400);
  assert.equal((await admin('DELETE', `/api/admin/stock/${device.data.id}`)).status, 400);
});

test('buying a used phone adds it to stock, records the expense and keeps the identity document private', async () => {
  const expense = (await admin('GET', '/api/categories')).data.find(c => c.name === 'Compra de móviles');
  const seller = { seller_name: 'Seller Name', seller_nif: '00000000T', seller_address: 'Street 1', model: 'Used A5', imei: '358000000000001', price: 80 };
  assert.equal((await admin('POST', '/api/purchases', { ...seller, seller_nif: '' })).status, 400);

  const before = (await admin('GET', '/api/day')).data.totals.expenses;
  const purchase = await admin('POST', '/api/purchases', { ...seller, brand: 'Brand', add_to_stock: true, expense_category_id: expense.id, payment_method: 'Efectivo' });
  assert.equal(purchase.data.number, 'C-1');
  assert.equal((await admin('GET', '/api/day')).data.totals.expenses - before, 80);
  const inStock = (await admin('GET', '/api/stock?q=358000000000001')).data[0];
  assert.deepEqual([inStock.condition, inStock.cost], ['used', 80]);

  const photo = Buffer.from('fake-jpeg-bytes');
  const url = `/api/purchases/${purchase.data.id}/id-document`;
  assert.equal((await admin('POST', url, photo, { 'Content-Type': 'application/pdf' })).status, 400);
  assert.equal((await admin('POST', url, photo, { 'Content-Type': 'image/jpeg' })).status, 200);
  const saved = (await admin('GET', `/api/purchases/${purchase.data.id}`)).data;
  assert.deepEqual([saved.has_id_document, saved.id_document], [true, undefined]);
  assert.equal((await admin('GET', `/api/admin/purchases/${purchase.data.id}/id-document`)).data.toString(), 'fake-jpeg-bytes');

  const register = (await admin('GET', '/api/admin/purchases-register.csv')).data.toString('utf8');
  assert.match(register, /C-1;.*Seller Name;00000000T;Street 1/);
  assert.equal((await admin('GET', '/api/search?q=Seller')).data.purchases.length, 1);
});

test('notices start with two templates and admins can write more', async () => {
  const starting = (await admin('GET', '/api/notices')).data;
  assert.equal(starting.length, 2);
  assert.equal((await admin('POST', '/api/admin/notices', { body: 'no title' })).status, 400);

  const created = await admin('POST', '/api/admin/notices', { title: 'Holiday hours', body: '# Closed\n- Monday' });
  await admin('PUT', `/api/admin/notices/${created.data.id}`, { title: 'Holiday hours', subtitle: 'August', body: '# Closed\n- Tuesday' });
  const saved = (await admin('GET', `/api/notices/${created.data.id}`)).data;
  assert.deepEqual([saved.subtitle, saved.body], ['August', '# Closed\n- Tuesday']);

  await admin('DELETE', `/api/admin/notices/${created.data.id}`);
  assert.equal((await admin('GET', '/api/notices')).data.length, 2);
});

test('settings are validated and saved', async () => {
  const saved = await admin('PUT', '/api/admin/settings/invoice', {
    vat_rate: 10, color_title: 'not-a-colour',
    warranties: [{ name: 'Custom', text: 'One month' }, { name: '', text: 'ignored' }],
  });
  assert.equal(saved.data.vat_rate, 10);
  assert.equal(saved.data.color_title, '#283593');
  assert.deepEqual(saved.data.warranties, [{ name: 'Custom', text: 'One month' }]);
  assert.equal((await admin('PUT', '/api/admin/settings/nope', {})).status, 404);
});

test('workers are limited by permissions', async () => {
  await admin('POST', '/api/admin/users', { username: 'worker', name: 'Worker', password: '1234' });
  assert.equal((await worker('POST', '/api/login', { username: 'worker', password: '1234' })).status, 200);
  assert.equal((await worker('GET', '/api/admin/stats')).status, 403);

  await admin('PUT', '/api/admin/settings/permissions', { worker_see_daily_profit: false, worker_add_expenses: false });
  const day = (await worker('GET', '/api/day')).data;
  assert.equal(day.totals.profit, undefined);
  assert.equal(day.sales[0].profit, undefined);
  const expense = (await worker('GET', '/api/categories')).data.find(c => c.kind === 'expense');
  assert.equal((await worker('POST', '/api/movements', { type: 'expense', category_id: expense.id, amount: 3 })).status, 403);
  assert.equal((await worker('GET', '/api/purchases')).status, 403);
  assert.equal((await worker('GET', '/api/notices')).status, 200);
  assert.equal((await worker('POST', '/api/admin/notices', { title: 'x' })).status, 403);
  assert.equal((await worker('GET', '/api/admin/purchases/1/id-document')).status, 403);

  const users = (await admin('GET', '/api/admin/users')).data;
  await admin('PUT', `/api/admin/users/${users.find(u => u.username === 'worker').id}`, { active: false });
  assert.equal((await worker('GET', '/api/day')).status, 401);
});

test('statistics, CSV export and import', async () => {
  const stats = (await admin('GET', '/api/admin/stats')).data;
  assert.equal(stats.totals.sales, 337);
  assert.equal((await admin('GET', '/api/admin/year')).data.months.length, 12);
  assert.ok((await admin('GET', '/api/admin/movements')).data.length >= 3);

  const csv = (await admin('GET', '/api/admin/export.csv')).data.toString('utf8');
  assert.match(csv, /fecha;hora;tipo/);

  const imported = await admin('POST', '/api/admin/import', { csv: 'fecha;tipo;categoria;importe;beneficio\n01/09/2026;venta;Imported product;15,00;12,00\nbad;venta;;;' });
  assert.deepEqual([imported.data.imported, imported.data.errors.length], [1, 1]);

  const backup = await admin('GET', '/api/admin/backup');
  assert.equal(backup.data.subarray(0, 15).toString(), 'SQLite format 3');
});

test('shop files can be uploaded, downloaded and deleted', async () => {
  const content = Buffer.from('hello file');
  const upload = await admin('POST', '/api/admin/files', content, { 'Content-Type': 'text/plain', 'X-File-Name': 'note.txt', 'X-Folder': 'Contratos' });
  assert.equal(upload.status, 200);
  const list = (await admin('GET', '/api/admin/files')).data;
  assert.deepEqual([list.files[0].name, list.files[0].folder, list.total.n], ['note.txt', 'Contratos', 1]);
  assert.equal((await admin('GET', `/api/admin/files/${upload.data.id}/download`)).data.toString(), 'hello file');
  await admin('PUT', `/api/admin/files/${upload.data.id}`, { name: 'renamed.txt' });
  await admin('DELETE', `/api/admin/files/${upload.data.id}`);
  assert.equal((await admin('GET', '/api/admin/files')).data.total.n, 0);
});

test('state-changing requests need the app header', async () => {
  const res = await fetch(`${BASE}/api/logout`, { method: 'POST' });
  assert.equal(res.status, 403);
});
