'use strict';
// SQLite through Node's built-in node:sqlite (Node >= 22.13), so the app has no dependencies.
const path = require('node:path');
const fs = require('node:fs');
const {
  SALE_CATEGORIES, FAVORITE_CATEGORIES, EXPENSE_CATEGORIES, PALETTE, STARTING_NOTICES, defaultWarrantyFor,
} = require('./defaults');

let Database;
try {
  ({ DatabaseSync: Database } = require('node:sqlite'));
} catch {
  console.error(`\n[ERROR] Necesitas Node.js 22.13 o superior (incluye SQLite). Versión actual: ${process.version}\n`);
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ventas.db');
const FILES_DIR = path.join(DATA_DIR, 'files');
const ID_DOCUMENTS_DIR = path.join(DATA_DIR, 'id-documents');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUPS_TO_KEEP = 30;

fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(ID_DOCUMENTS_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

// All money columns are integers in cents. Dates are 'YYYY-MM-DD' strings in local time.
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

-- A category is either a product/service that is sold or a reason for an expense.
CREATE TABLE IF NOT EXISTS categories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL CHECK (kind IN ('sale','expense')),
  name           TEXT NOT NULL,
  color          TEXT NOT NULL DEFAULT '#64748b',
  expense_type   TEXT CHECK (expense_type IN ('stock','operating')),
  default_price  INTEGER,
  default_profit INTEGER,
  favorite       INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0,
  warranty       TEXT NOT NULL DEFAULT ''
);

-- One row per sale or expense. Rows are never removed: deleted_at marks a soft delete.
CREATE TABLE IF NOT EXISTS movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL CHECK (type IN ('sale','expense')),
  date           TEXT NOT NULL,
  category_id    INTEGER REFERENCES categories(id),
  description    TEXT NOT NULL DEFAULT '',
  amount         INTEGER NOT NULL,
  profit         INTEGER NOT NULL DEFAULT 0,
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

-- kind 'factura' is a full invoice, 'ticket' a simplified one.
-- items is JSON: [{ description, detail, qty, price, warranty, warranty_text }].
-- replaces_id links a full invoice to the ticket it replaces.
CREATE TABLE IF NOT EXISTS invoices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  number           TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'factura' CHECK (kind IN ('factura','ticket')),
  date             TEXT NOT NULL,
  customer_name    TEXT NOT NULL DEFAULT '',
  customer_nif     TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  customer_phone   TEXT NOT NULL DEFAULT '',
  items            TEXT NOT NULL,
  subtotal         INTEGER NOT NULL,
  discount         INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  user_id          INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  voided           INTEGER NOT NULL DEFAULT 0,
  replaces_id      INTEGER,
  show_vat         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_inv_kind ON invoices(kind, id);

-- Repair receipts: the slip the customer keeps while the shop has their device.
-- faults is a JSON array of names; pattern is the unlock pattern as dot numbers, e.g. '1-4-7-8'.
-- A pending repair with ready_at set is repaired and waiting for the customer.
-- deposit is what the customer paid in advance; deposit_movement_id is that payment in the register.
CREATE TABLE IF NOT EXISTS repairs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL,
  date           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','collected')),
  collected_at   TEXT,
  customer_name  TEXT NOT NULL DEFAULT '',
  customer_nif   TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  brand          TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  imei           TEXT NOT NULL DEFAULT '',
  carrier        TEXT NOT NULL DEFAULT '',
  unlock_code    TEXT NOT NULL DEFAULT '',
  pattern        TEXT NOT NULL DEFAULT '',
  faults         TEXT NOT NULL DEFAULT '[]',
  notes          TEXT NOT NULL DEFAULT '',
  condition      TEXT NOT NULL DEFAULT '',
  amount         INTEGER,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  voided         INTEGER NOT NULL DEFAULT 0,
  movement_id    INTEGER REFERENCES movements(id),
  ready_at       TEXT,
  due_on         TEXT,
  deposit        INTEGER,
  deposit_movement_id INTEGER REFERENCES movements(id)
);

-- Phones in stock. Selling one creates a sale movement with profit = price - cost.
CREATE TABLE IF NOT EXISTS devices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  brand        TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL,
  imei         TEXT NOT NULL DEFAULT '',
  condition    TEXT NOT NULL DEFAULT 'new' CHECK (condition IN ('new','used')),
  cost         INTEGER NOT NULL,
  price        INTEGER,
  notes        TEXT NOT NULL DEFAULT '',
  purchased_on TEXT NOT NULL,
  sold_on      TEXT,
  movement_id  INTEGER REFERENCES movements(id),
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Used phones bought from private sellers, each with a signed contract.
-- id_document is the file name, inside ID_DOCUMENTS_DIR, of the photo of the seller's identity card.
CREATE TABLE IF NOT EXISTS purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL,
  date           TEXT NOT NULL,
  seller_name    TEXT NOT NULL,
  seller_nif     TEXT NOT NULL,
  seller_address TEXT NOT NULL DEFAULT '',
  seller_phone   TEXT NOT NULL DEFAULT '',
  brand          TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL,
  imei           TEXT NOT NULL DEFAULT '',
  condition      TEXT NOT NULL DEFAULT '',
  price          INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT '',
  id_document    TEXT,
  id_document_mime TEXT,
  device_id      INTEGER REFERENCES devices(id),
  movement_id    INTEGER REFERENCES movements(id),
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  voided         INTEGER NOT NULL DEFAULT 0
);

-- Notices the shop writes and prints: policies, price lists, announcements.
CREATE TABLE IF NOT EXISTS notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  subtitle   TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Uploaded shop documents. The content lives on disk at FILES_DIR/<stored_name>.
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

const all = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);

function run(sql, ...params) {
  const result = db.prepare(sql).run(...params);
  return { changes: Number(result.changes), id: Number(result.lastInsertRowid) };
}

function tx(work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Brings databases created by older versions up to the schema above.
function migrate() {
  const hasColumn = (table, column) => all(`PRAGMA table_info(${table})`).some(c => c.name === column);

  if (!hasColumn('invoices', 'replaces_id')) db.exec('ALTER TABLE invoices ADD COLUMN replaces_id INTEGER');
  if (!hasColumn('invoices', 'show_vat')) db.exec('ALTER TABLE invoices ADD COLUMN show_vat INTEGER');
  if (!hasColumn('repairs', 'movement_id')) db.exec('ALTER TABLE repairs ADD COLUMN movement_id INTEGER');
  for (const [column, type] of [['ready_at', 'TEXT'], ['due_on', 'TEXT'], ['deposit', 'INTEGER'], ['deposit_movement_id', 'INTEGER']]) {
    if (!hasColumn('repairs', column)) db.exec(`ALTER TABLE repairs ADD COLUMN ${column} ${type}`);
  }
  if (!hasColumn('categories', 'warranty')) {
    db.exec("ALTER TABLE categories ADD COLUMN warranty TEXT NOT NULL DEFAULT ''");
    tx(() => all("SELECT id, name FROM categories WHERE kind = 'sale'").forEach(category =>
      run('UPDATE categories SET warranty = ? WHERE id = ?', defaultWarrantyFor(category.name), category.id)));
  }
  once('starting_notices', () => {
    for (const notice of STARTING_NOTICES) {
      run('INSERT INTO notices (title, subtitle, body) VALUES (?,?,?)', notice.title, notice.subtitle, notice.body);
    }
  });
  once('vat_breakdown_off_by_default', () => {
    const row = get("SELECT value FROM settings WHERE key = 'invoice'");
    const config = row ? JSON.parse(row.value) : {};
    // Documents issued before the per-document switch keep the look they were printed with.
    run('UPDATE invoices SET show_vat = ? WHERE show_vat IS NULL', config.show_vat === false ? 0 : 1);
    if (row) run("UPDATE settings SET value = ? WHERE key = 'invoice'", JSON.stringify({ ...config, show_vat: false }));
  });
}

// Runs a data migration a single time per database, remembering it in the settings table.
function once(name, change) {
  const key = `migration:${name}`;
  if (get('SELECT 1 AS found FROM settings WHERE key = ?', key)) return;
  tx(() => {
    change();
    run('INSERT INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(new Date().toISOString()));
  });
}

function seedCategories() {
  if (get('SELECT 1 AS found FROM categories LIMIT 1')) return;
  tx(() => {
    SALE_CATEGORIES.forEach((name, index) => {
      run('INSERT INTO categories (kind, name, color, favorite, sort, warranty) VALUES (?,?,?,?,?,?)',
        'sale', name, PALETTE[index % PALETTE.length], FAVORITE_CATEGORIES.has(name) ? 1 : 0, index, defaultWarrantyFor(name));
    });
    EXPENSE_CATEGORIES.forEach(([name, expenseType], index) => {
      run('INSERT INTO categories (kind, name, color, expense_type, sort) VALUES (?,?,?,?,?)',
        'expense', name, expenseType === 'stock' ? '#b45309' : '#475569', expenseType, index);
    });
  });
}

migrate();
seedCategories();

function snapshotTo(file) {
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

// One snapshot per day, keeping the most recent BACKUPS_TO_KEEP.
function backup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `ventas-${new Date().toISOString().slice(0, 10)}.db`);
  if (fs.existsSync(file)) return file;
  snapshotTo(file);
  const snapshots = fs.readdirSync(BACKUP_DIR).filter(name => name.endsWith('.db')).sort();
  while (snapshots.length > BACKUPS_TO_KEEP) fs.unlinkSync(path.join(BACKUP_DIR, snapshots.shift()));
  return file;
}

const backupToTemp = () => snapshotTo(path.join(DATA_DIR, `export-${Date.now()}.db`));

module.exports = { db, all, get, run, tx, backup, backupToTemp, DB_PATH, DATA_DIR, FILES_DIR, ID_DOCUMENTS_DIR };
