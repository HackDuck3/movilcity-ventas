// Base de datos SQLite (sin dependencias externas: usa node:sqlite, Node >= 22.13)
'use strict';
const path = require('node:path');
const fs = require('node:fs');

let Database;
try {
  ({ DatabaseSync: Database } = require('node:sqlite'));
} catch (e) {
  try { Database = require('better-sqlite3'); }
  catch (_) {
    console.error('\n[ERROR] Necesitas Node.js 22.13 o superior (incluye SQLite).');
    console.error('        Versión actual: ' + process.version + '\n');
    process.exit(1);
  }
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'ventas.db');

const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

// ---------------------------------------------------------------------------
// Esquema
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','worker')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- kind: 'sale' (producto/servicio que se vende) | 'expense' (motivo de gasto)
-- expense_type: 'stock' (compra de mercancía: móviles, fundas...) | 'operating' (alquiler, luz, comida...)
CREATE TABLE IF NOT EXISTS categories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL CHECK (kind IN ('sale','expense')),
  name           TEXT NOT NULL,
  color          TEXT NOT NULL DEFAULT '#64748b',
  expense_type   TEXT CHECK (expense_type IN ('stock','operating')),
  default_price  INTEGER,            -- céntimos
  default_profit INTEGER,            -- céntimos
  favorite       INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0
);

-- Todo el dinero se guarda en CÉNTIMOS (enteros) para evitar errores de redondeo.
CREATE TABLE IF NOT EXISTS movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL CHECK (type IN ('sale','expense')),
  date           TEXT NOT NULL,          -- YYYY-MM-DD
  category_id    INTEGER REFERENCES categories(id),
  description    TEXT NOT NULL DEFAULT '',
  amount         INTEGER NOT NULL,       -- precio de venta o importe del gasto
  profit         INTEGER NOT NULL DEFAULT 0, -- beneficio (solo ventas)
  payment_method TEXT NOT NULL DEFAULT '',
  user_id        INTEGER REFERENCES users(id),
  invoice_id     INTEGER REFERENCES invoices(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT,
  updated_by     INTEGER,
  deleted_at     TEXT,
  deleted_by     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mov_date ON movements(date);
CREATE INDEX IF NOT EXISTS idx_mov_type_date ON movements(type, date);

CREATE TABLE IF NOT EXISTS invoices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  number           TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'factura' CHECK (kind IN ('factura','ticket')),
  date             TEXT NOT NULL,
  customer_name    TEXT NOT NULL DEFAULT '',
  customer_nif     TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  customer_phone   TEXT NOT NULL DEFAULT '',
  items            TEXT NOT NULL,          -- JSON [{description, detail, qty, price}] (price en céntimos)
  subtotal         INTEGER NOT NULL,
  discount         INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  user_id          INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  voided           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inv_kind ON invoices(kind, id);

-- Archivos de la tienda (solo administrador). El fichero se guarda en data/files/<stored_name>
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  folder      TEXT NOT NULL DEFAULT 'General',
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        INTEGER NOT NULL DEFAULT 0,
  stored_name TEXT NOT NULL UNIQUE,
  note        TEXT NOT NULL DEFAULT '',
  uploaded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

// ---------------------------------------------------------------------------
// Valores por defecto
// ---------------------------------------------------------------------------
const SALE_CATEGORIES = [
  'Movil', 'Tablet', 'Funda', 'Protector', 'Funda y protector', 'Cascos', 'Cable USB', 'Cable Tipo-C',
  'Cable HDMI', 'Cable de red', 'Cable de TV', 'Adaptador', 'PowerBank', 'Reparacion', 'Solucion Tecnica',
  'Cargador', 'Cargador de portatil', 'Soporte para movil', 'Selfie Stick', 'Tarjeta SIM', 'Duplicado',
  'Pendrive', 'Memoria', 'Disco Duro', 'Raton', 'Teclado', 'Webcam', 'Altavoz', 'Karaoke', 'Radio', 'Mando',
  'Ventilador', 'Calefactor', 'Secadora pelo', 'Maquina de barba/pelo', 'Tostadora', 'Batidora',
  'Olla a presion', 'Arrocera', 'Plancha ropa', 'Plancha pelo', 'Consola', 'Reloj despertador', 'Reloj de mano',
  'Reloj inteligente', 'Smart TV Stick', 'Telefono fijo', 'Mechero', 'Copias', 'Impresion', 'Escaneo',
  'Correa', 'OTG', 'Calculadora',
];
const FAVORITES = new Set(['Movil', 'Funda', 'Protector', 'Funda y protector', 'Cascos', 'Cargador',
  'Cable USB', 'Cable Tipo-C', 'Reparacion', 'Tarjeta SIM', 'Duplicado', 'Adaptador']);

const EXPENSE_CATEGORIES = [
  ['Compra de móviles', 'stock'], ['Compra de accesorios', 'stock'], ['Compra tienda / proveedor', 'stock'],
  ['Tarjetas SIM / recargas', 'stock'], ['Recambios reparación', 'stock'],
  ['Alquiler', 'operating'], ['Luz / agua / internet', 'operating'], ['Sueldos', 'operating'],
  ['Comida / Mercadona', 'operating'], ['Publicidad / web', 'operating'], ['Deuda / préstamo', 'operating'],
  ['Otros gastos', 'operating'],
];

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  '#0891b2', '#7c3aed', '#be123c', '#4d7c0f', '#b45309', '#475569'];

const DEFAULT_SETTINGS = {
  shop: {
    name: 'Movil City',            // nombre comercial
    legal_name: '',                // nombre y apellidos del titular (autónomo) o razón social
    address1: '',
    address2: '',
    phone: '',
    email: '',
    nif: '',
    logo: '',
  },
  appearance: {
    appName: 'Movil City · Ventas',
    primary: '#283593',
    accent: '#e91e63',
    dark: false,
    density: 'normal',     // normal | compact
  },
  permissions: {
    worker_see_daily_sales: true,      // ve el total vendido del día
    worker_see_daily_profit: true,     // ve el beneficio del día
    worker_see_daily_expenses: false,  // ve los gastos del día
    worker_add_expenses: true,         // puede registrar gastos
    worker_create_invoices: true,      // puede hacer facturas/tickets
    worker_edit_minutes: 15,           // minutos para corregir/borrar sus propios apuntes (0 = nunca)
    worker_history_days: 0,            // días anteriores que puede consultar (0 = solo hoy)
  },
  sales: {
    payment_methods: ['Efectivo', 'Tarjeta', 'Bizum'],
    ask_payment_method: true,
    require_description_over: 0,       // € a partir de los cuales la descripción es obligatoria (0 = nunca)
    profit_input: 'both',              // both | profit | cost
  },
  invoice: {
    // Dos series de numeración separadas (obligatorio en España): facturas completas y tickets (facturas simplificadas)
    next_number: 1,
    prefix: '',
    ticket_next_number: 1,
    ticket_prefix: 'T-',
    title: 'Factura',
    ticket_title: 'Factura simplificada',
    warranty: 'Garantía 15 dias de software',
    footer: '',
    show_vat: true,
    vat_rate: 21,
    color_shop: '#6c63e6',
    color_title: '#283593',
    color_accent: '#e91e63',
    min_rows: 6,
    ticket_format: 'ticket',      // formato de impresión de los tickets: 'ticket' (80 mm) o 'a4'
  },
  modules: {
    invoices: true,
    payment_methods: true,
    files: true,
  },
  files: {
    folders: ['Facturas de proveedores', 'Contratos', 'Impuestos', 'Seguros', 'Garantías', 'Nóminas', 'Otros'],
    max_mb: 50,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function all(sql, ...params) { return db.prepare(sql).all(...params); }
function get(sql, ...params) { return db.prepare(sql).get(...params); }
function run(sql, ...params) {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  const def = DEFAULT_SETTINGS[key];
  if (!row) return def ? structuredClone(def) : null;
  const val = JSON.parse(row.value);
  // fusiona con los valores por defecto (para claves nuevas tras actualizar la app)
  return def && typeof def === 'object' && !Array.isArray(def) ? { ...def, ...val } : val;
}
function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value));
}
function allSettings() {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = getSetting(k);
  return out;
}

// Semilla inicial de categorías
if (!get('SELECT 1 AS x FROM categories LIMIT 1')) {
  tx(() => {
    SALE_CATEGORIES.forEach((name, i) => {
      run('INSERT INTO categories (kind, name, color, favorite, sort) VALUES (?,?,?,?,?)',
        'sale', name, PALETTE[i % PALETTE.length], FAVORITES.has(name) ? 1 : 0, i);
    });
    EXPENSE_CATEGORIES.forEach(([name, type], i) => {
      run('INSERT INTO categories (kind, name, color, expense_type, sort) VALUES (?,?,?,?,?)',
        'expense', name, type === 'stock' ? '#b45309' : '#475569', type, i);
    });
  });
}

// Copia de seguridad diaria (se guardan las últimas 30)
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
function backup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(BACKUP_DIR, `ventas-${stamp}.db`);
  if (fs.existsSync(file)) return file;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
  while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  return file;
}
function backupToTemp() {
  const file = path.join(DATA_DIR, `export-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

const FILES_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });

module.exports = {
  FILES_DIR, db, all, get, run, tx, getSetting, setSetting, allSettings, DEFAULT_SETTINGS, PALETTE,
  backup, backupToTemp, DB_PATH, DATA_DIR,
};
