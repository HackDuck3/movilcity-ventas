'use strict';
// What the accountant asks for every quarter: documents issued with base and VAT, expenses by reason
// and second-hand purchases. Voided documents never count.
const { all } = require('../db');
const { getSetting } = require('../settings');
const { route, fail } = require('../http');
const { euros, pad, localDate } = require('../utils');

const BOM = '﻿';
const csvCell = (value) => (/[;"\n]/.test(String(value ?? '')) ? `"${String(value).replace(/"/g, '""')}"` : String(value ?? ''));
const csvNumber = (amount) => Number(amount).toFixed(2).replace('.', ',');
const toCsv = (header, rows) => BOM + [header, ...rows].map(cells => cells.map(csvCell).join(';')).join('\r\n');

function quarterRange(query) {
  const year = /^\d{4}$/.test(query.year || '') ? Number(query.year) : new Date().getFullYear();
  const quarter = [1, 2, 3, 4].includes(Number(query.quarter)) ? Number(query.quarter) : Math.floor(new Date().getMonth() / 3) + 1;
  const firstMonth = (quarter - 1) * 3 + 1;
  return {
    year, quarter,
    from: `${year}-${pad(firstMonth)}-01`,
    to: localDate(new Date(year, firstMonth + 2, 0)),
  };
}

// Prices include VAT, so the base is worked back from the total at the rate in settings.
function splitVat(totalCents, rate) {
  const base = Math.round(totalCents / (1 + rate / 100));
  return { base, vat: totalCents - base };
}

// A ticket later exchanged for a full invoice is left out: the invoice is the document that counts.
// If that ticket belongs to an earlier quarter it was already declared there, so then it is the
// invoice that is listed without adding to the totals.
function documentsIn({ from, to }) {
  const rate = Number(getSetting('invoice').vat_rate) || 0;
  return all(`SELECT i.*, replaced.date AS replaces_date, rectified.number AS rectifies_number
              FROM invoices i
              LEFT JOIN invoices replaced ON replaced.id = i.replaces_id
              LEFT JOIN invoices rectified ON rectified.id = i.rectifies_id
              WHERE i.voided = 0 AND i.date BETWEEN ? AND ?
                AND NOT EXISTS (SELECT 1 FROM invoices later
                                WHERE later.replaces_id = i.id AND later.voided = 0 AND later.date <= ?)
              ORDER BY i.kind, i.date, i.id`, from, to, to)
    .map(invoice => ({
      date: invoice.date, number: invoice.number, kind: invoice.kind,
      is_refund: !!invoice.rectifies_id, rectifies_number: invoice.rectifies_number || '',
      customer_name: invoice.customer_name, customer_nif: invoice.customer_nif,
      already_declared: !!invoice.replaces_date && invoice.replaces_date < from,
      total: invoice.total, ...splitVat(invoice.total, rate),
    }));
}

function sumOf(documents) {
  const counted = documents.filter(document => !document.already_declared);
  const sum = (field) => counted.reduce((total, document) => total + document[field], 0);
  return { count: counted.length, base: sum('base'), vat: sum('vat'), total: sum('total') };
}

const expensesIn = ({ from, to }) => all(`
  SELECT m.date, c.name AS category, c.expense_type, m.description, m.amount
  FROM movements m LEFT JOIN categories c ON c.id = m.category_id
  WHERE m.type = 'expense' AND m.deleted_at IS NULL AND m.date BETWEEN ? AND ? ORDER BY m.date, m.id`, from, to);

const purchasesIn = ({ from, to }) => all(`
  SELECT date, number, seller_name, seller_nif, brand, model, imei, price
  FROM purchases WHERE voided = 0 AND date BETWEEN ? AND ? ORDER BY date, id`, from, to);

const inEuros = (row, ...fields) => ({ ...row, ...Object.fromEntries(fields.map(field => [field, euros(row[field])])) });

route('GET', '/api/admin/quarter', 'admin', ({ query }) => {
  const range = quarterRange(query);
  const documents = documentsIn(range);
  const expenses = expensesIn(range);
  const purchases = purchasesIn(range);

  const byReason = new Map();
  for (const expense of expenses) {
    const key = expense.category || '—';
    const group = byReason.get(key) || { name: key, expense_type: expense.expense_type, count: 0, amount: 0 };
    group.count++;
    group.amount += expense.amount;
    byReason.set(key, group);
  }
  const summary = (list) => inEuros(sumOf(list), 'base', 'vat', 'total');

  return {
    ...range,
    vat_rate: Number(getSetting('invoice').vat_rate) || 0,
    documents: documents.map(document => inEuros(document, 'base', 'vat', 'total')),
    issued: {
      tickets: summary(documents.filter(document => document.kind === 'ticket')),
      invoices: summary(documents.filter(document => document.kind === 'factura')),
      all: summary(documents),
    },
    expenses: [...byReason.values()].sort((a, b) => b.amount - a.amount).map(group => inEuros(group, 'amount')),
    expenses_total: euros(expenses.reduce((total, expense) => total + expense.amount, 0)),
    purchases: { count: purchases.length, total: euros(purchases.reduce((total, purchase) => total + purchase.price, 0)) },
  };
});

const DOCUMENT_KINDS = { ticket: 'factura simplificada', factura: 'factura' };
const CSV_PARTS = {
  documentos: (range) => toCsv(
    ['fecha', 'numero', 'tipo', 'rectifica_a', 'cliente', 'nif', 'base', 'iva', 'total', 'nota'],
    documentsIn(range).map(document => [
      document.date, document.number, `${DOCUMENT_KINDS[document.kind]}${document.is_refund ? ' rectificativa' : ''}`,
      document.rectifies_number, document.customer_name, document.customer_nif,
      csvNumber(euros(document.base)), csvNumber(euros(document.vat)), csvNumber(euros(document.total)),
      document.already_declared ? 'sustituye a un ticket de un trimestre anterior: no suma' : '',
    ])),
  gastos: (range) => toCsv(
    ['fecha', 'motivo', 'tipo', 'descripcion', 'importe'],
    expensesIn(range).map(expense => [
      expense.date, expense.category, expense.expense_type === 'stock' ? 'mercancia' : 'operativo',
      expense.description, csvNumber(euros(expense.amount)),
    ])),
  compras: (range) => toCsv(
    ['fecha', 'contrato', 'vendedor', 'dni', 'marca', 'modelo', 'imei', 'precio'],
    purchasesIn(range).map(purchase => [
      purchase.date, purchase.number, purchase.seller_name, purchase.seller_nif,
      purchase.brand, purchase.model, purchase.imei, csvNumber(euros(purchase.price)),
    ])),
};

route('GET', '/api/admin/quarter/:part', 'admin', ({ params, query, res }) => {
  const part = params.part.replace(/\.csv$/, '');
  if (!CSV_PARTS[part]) fail(404, 'Listado desconocido');
  const range = quarterRange(query);
  res.sendRaw(200, CSV_PARTS[part](range), 'text/csv; charset=utf-8', `${part}_${range.year}_T${range.quarter}.csv`);
});
