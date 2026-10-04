// Fills a DEMO database (data-demo/) with two months of made-up sales.
// Usage:  npm run demo   → then open http://localhost:3001  (admin / admin123 · trabajador / 1234)
'use strict';
process.env.DATA_DIR = process.env.DATA_DIR || require('node:path').join(__dirname, '..', 'data-demo');
const { all, get, run, tx } = require('../src/db');
const { hashPassword } = require('../src/auth');

if (get('SELECT 1 AS x FROM movements LIMIT 1')) { console.log('La demo ya tiene datos. Borra la carpeta data-demo/ para regenerarla.'); process.exit(0); }

if (!get('SELECT 1 AS x FROM users LIMIT 1')) {
  run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)', 'admin', 'Dueño', hashPassword('admin123'), 'admin');
  run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)', 'trabajador', 'Mehedi', hashPassword('1234'), 'worker');
  run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)', 'ana', 'Ana', hashPassword('1234'), 'worker');
}
const users = all('SELECT id FROM users').map(u => u.id);
const cat = Object.fromEntries(all('SELECT id, name FROM categories').map(c => [c.name, c.id]));

// [product, min price, max price, approx. margin, weight]
const P = [
  ['Funda', 7, 17, .7, 14], ['Protector', 7, 20, .8, 12], ['Funda y protector', 15, 25, .72, 5], ['Cascos', 7, 26, .6, 8],
  ['Cargador', 13, 29, .6, 8], ['Cable USB', 6, 10, .8, 6], ['Cable Tipo-C', 6, 12, .8, 6], ['Tarjeta SIM', 10, 15, .8, 7],
  ['Duplicado', 10, 10, .8, 6], ['Reparacion', 10, 100, .6, 8], ['Adaptador', 7, 13, .7, 4], ['Soporte para movil', 14, 20, .65, 3],
  ['Movil', 125, 380, .25, 2], ['Altavoz', 15, 35, .5, 2], ['PowerBank', 15, 30, .5, 2], ['Copias', 1, 5, .9, 3], ['Impresion', 1, 6, .9, 3],
  ['Smart TV Stick', 25, 45, .4, 1], ['Reloj inteligente', 20, 60, .45, 1],
];
const totalW = P.reduce((a, p) => a + p[4], 0);
const pick = () => { let r = Math.random() * totalW; for (const p of P) { r -= p[4]; if (r <= 0) return p; } return P[0]; };
const pms = ['Efectivo', 'Efectivo', 'Efectivo', 'Tarjeta', 'Tarjeta', 'Bizum'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 63);
tx(() => {
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 && Math.random() < .7) continue; // mostly closed on Sundays
    const date = iso(d); const n = 10 + Math.floor(Math.random() * 14);
    for (let i = 0; i < n; i++) {
      const [name, lo, hi, margin] = pick();
      const price = Math.round((lo + Math.random() * (hi - lo)) * 2) / 2;
      const profit = Math.round(price * margin * (0.85 + Math.random() * 0.3) * 2) / 2;
      const h = 10 + Math.floor((i / n) * 10), m = Math.floor(Math.random() * 60);
      run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        'sale', date, cat[name], name === 'Movil' ? 'Samsung Galaxy A16 128gb' : '', Math.round(price * 100), Math.round(Math.min(profit, price) * 100),
        pms[Math.floor(Math.random() * pms.length)], users[Math.floor(Math.random() * users.length)], `${date} ${pad(h)}:${pad(m)}:00`);
    }
    const exp = (c, a, desc) => run(`INSERT INTO movements (type, date, category_id, description, amount, payment_method, user_id, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      'expense', date, cat[c], desc, Math.round(a * 100), 'Efectivo', users[0], `${date} 13:00:00`);
    if (Math.random() < .12) exp('Compra de móviles', 300 + Math.round(Math.random() * 500), 'Compra móviles proveedor');
    if (Math.random() < .2) exp('Compra de accesorios', 60 + Math.round(Math.random() * 200), 'Fundas y protectores');
    if (Math.random() < .25) exp('Comida / Mercadona', 15 + Math.round(Math.random() * 50), 'Mercadona');
    if (d.getDate() === 1) { exp('Alquiler', 1100, 'Alquiler local'); exp('Luz / agua / internet', 180, 'Facturas'); }
  }
});
console.log('Demo creada en data-demo/. Arranca con:  npm run demo');
