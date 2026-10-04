'use strict';
const { fail } = require('./http');

// Money travels through the API in euros and is stored in cents.
function cents(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : parseFloat(String(value).replace(/\s|€/g, '').replace(',', '.'));
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}
const euros = (amountInCents) => Math.round(Number(amountInCents || 0)) / 100;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

const str = (value, maxLength = 500) => String(value ?? '').trim().slice(0, maxLength);
const isColor = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

// Reads ?from=&to= and defaults to the current month so far.
function dateRange(query) {
  const today = localDate();
  const from = isDate(query.from) ? query.from : `${today.slice(0, 8)}01`;
  const to = isDate(query.to) ? query.to : today;
  if (from > to) fail(400, 'Rango de fechas no válido');
  return { from, to };
}

module.exports = { cents, euros, pad, localDate, addDays, isDate, str, isColor, dateRange };
