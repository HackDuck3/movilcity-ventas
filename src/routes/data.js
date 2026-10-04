'use strict';
// CSV export/import and database download. CSV uses ';' and decimal commas so Spanish Excel opens it directly.
const fs = require('node:fs');
const { all, get, run, tx, backupToTemp } = require('../db');
const { route, fail } = require('../http');
const { cents, euros, pad, localDate, str, dateRange } = require('../utils');
const { MOVEMENT_SELECT } = require('./movements');

const BOM = '﻿';
const EXPORT_COLUMNS = ['fecha', 'hora', 'tipo', 'categoria', 'descripcion', 'importe', 'beneficio', 'metodo_pago', 'usuario', 'tipo_gasto'];

// Header names accepted on import for each field.
const IMPORT_COLUMNS = {
  date: ['fecha', 'date'],
  type: ['tipo', 'type'],
  category: ['categoria', 'categoría', 'producto', 'motivo'],
  description: ['descripcion', 'descripción', 'concepto'],
  amount: ['importe', 'precio', 'amount', 'gasto'],
  profit: ['beneficio', 'ganancia', 'profit'],
  paymentMethod: ['metodo_pago', 'método', 'metodo', 'pago'],
  expenseType: ['tipo_gasto'],
};

function csvCell(value) {
  const text = String(value ?? '');
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const csvNumber = (amount) => Number(amount).toFixed(2).replace('.', ',');

route('GET', '/api/admin/export.csv', 'admin', ({ query, res }) => {
  const { from, to } = dateRange(query);
  const rows = all(`${MOVEMENT_SELECT} WHERE m.deleted_at IS NULL AND m.date BETWEEN ? AND ? ORDER BY m.date, m.created_at`, from, to);
  const lines = rows.map(row => {
    const isSale = row.type === 'sale';
    return [
      row.date, String(row.created_at).slice(11, 16), isSale ? 'venta' : 'gasto', row.category_name, row.description,
      csvNumber(euros(row.amount)), isSale ? csvNumber(euros(row.profit)) : '', row.payment_method, row.user_name,
      isSale ? '' : (row.expense_type === 'stock' ? 'mercancia' : 'operativo'),
    ].map(csvCell).join(';');
  });
  res.sendRaw(200, BOM + [EXPORT_COLUMNS.join(';'), ...lines].join('\r\n'), 'text/csv; charset=utf-8', `movimientos_${from}_${to}.csv`);
});

// Accepts ';' or ',' as separator (whichever the header line uses more) and quoted cells.
function parseCsv(text) {
  const header = text.split('\n')[0];
  const count = (char) => header.split(char).length - 1;
  const separator = count(';') >= count(',') ? ';' : ',';

  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (insideQuotes) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else insideQuotes = false;
    } else if (char === '"') insideQuotes = true;
    else if (char === separator) endCell();
    else if (char === '\n') endRow();
    else if (char !== '\r') cell += char;
  }
  if (cell || row.length) endRow();
  return rows.filter(cells => cells.some(value => value.trim()));
}

// Accepts 2026-09-01 and 01/09/2026 (or 1/9/26).
function toIsoDate(value) {
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const spanish = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!spanish) return null;
  const [, day, month, year] = spanish;
  return `${year.length === 2 ? `20${year}` : year}-${pad(month)}-${pad(day)}`;
}

function findOrCreateCategory(type, name, expenseTypeCell) {
  const existing = get('SELECT id FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE', type, name);
  if (existing) return existing.id;
  const expenseType = type === 'expense' ? (/merc|stock/i.test(expenseTypeCell) ? 'stock' : 'operating') : null;
  return run('INSERT INTO categories (kind, name, color, expense_type, sort) VALUES (?,?,?,?,999)', type, name, '#64748b', expenseType).id;
}

route('POST', '/api/admin/import', 'admin', ({ body, user }) => {
  const rows = parseCsv(String(body.csv || '').replace(/^\uFEFF/, ''));
  if (rows.length < 2) fail(400, 'El CSV está vacío');

  const header = rows[0].map(name => name.trim().toLowerCase());
  const columnIndex = Object.fromEntries(
    Object.entries(IMPORT_COLUMNS).map(([field, names]) => [field, header.findIndex(name => names.includes(name))]));
  if (columnIndex.date < 0 || columnIndex.category < 0 || columnIndex.amount < 0) {
    fail(400, 'El CSV necesita al menos las columnas: fecha, categoria, importe');
  }
  const cell = (cells, field) => (columnIndex[field] >= 0 ? String(cells[columnIndex[field]] ?? '') : '');

  let imported = 0;
  const errors = [];
  tx(() => {
    rows.slice(1).forEach((cells, index) => {
      const date = toIsoDate(cell(cells, 'date'));
      const amount = cents(cell(cells, 'amount'));
      const categoryName = cell(cells, 'category').trim();
      if (!date || !amount || !categoryName) {
        errors.push(`Fila ${index + 2}: datos incompletos`);
        return;
      }
      const type = /gasto|expense/i.test(cell(cells, 'type')) ? 'expense' : 'sale';
      const categoryId = findOrCreateCategory(type, categoryName, cell(cells, 'expenseType'));
      const profit = type === 'sale' ? cents(cell(cells, 'profit')) || 0 : 0;
      run(`INSERT INTO movements (type, date, category_id, description, amount, profit, payment_method, user_id) VALUES (?,?,?,?,?,?,?,?)`,
        type, date, categoryId, str(cell(cells, 'description'), 300), amount, profit, str(cell(cells, 'paymentMethod'), 40), user.id);
      imported++;
    });
  });
  return { ok: true, imported, errors: errors.slice(0, 50) };
});

route('GET', '/api/admin/backup', 'admin', ({ res }) => {
  const file = backupToTemp();
  const content = fs.readFileSync(file);
  fs.unlinkSync(file);
  res.sendRaw(200, content, 'application/octet-stream', `ventas-backup-${localDate()}.db`);
});
