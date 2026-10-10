'use strict';
// Figures for the owner's dashboard. Deleted movements never count.
const { all, get } = require('../db');
const { route } = require('../http');
const { euros, pad, localDate, addDays, dateRange } = require('../utils');

const DAY_MS = 86400e3;

function totalsFor(from, to) {
  // Refunds are sales with a negative amount: they lower the totals but are not counted as sales.
  const sales = get(`SELECT COALESCE(SUM(amount > 0),0) AS count, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(profit),0) AS profit
                     FROM movements WHERE type='sale' AND deleted_at IS NULL AND date BETWEEN ? AND ?`, from, to);
  const expenses = get(`SELECT COALESCE(SUM(m.amount),0) AS total,
                               COALESCE(SUM(CASE WHEN c.expense_type='stock' THEN m.amount ELSE 0 END),0) AS stock,
                               COALESCE(SUM(CASE WHEN c.expense_type='stock' THEN 0 ELSE m.amount END),0) AS operating
                        FROM movements m LEFT JOIN categories c ON c.id = m.category_id
                        WHERE m.type='expense' AND m.deleted_at IS NULL AND m.date BETWEEN ? AND ?`, from, to);
  return {
    sales_count: sales.count,
    sales: euros(sales.amount),
    profit: euros(sales.profit),
    expenses: euros(expenses.total),
    expenses_stock: euros(expenses.stock),
    expenses_operating: euros(expenses.operating),
    // Stock purchases are already discounted in each sale's profit, so only running costs are subtracted.
    net: euros(sales.profit - expenses.operating),
    cash: euros(sales.amount - expenses.total),
    avg_ticket: sales.count ? euros(Math.round(sales.amount / sales.count)) : 0,
    margin: sales.amount ? Math.round((sales.profit / sales.amount) * 1000) / 10 : 0,
  };
}

const withEuros = (...fields) => (row) => ({ ...row, ...Object.fromEntries(fields.map(field => [field, euros(row[field])])) });

route('GET', '/api/admin/stats', 'admin', ({ query }) => {
  const { from, to } = dateRange(query);
  const days = Math.round((new Date(to) - new Date(from)) / DAY_MS) + 1;
  const previous = { from: addDays(from, -days), to: addDays(from, -1) };
  const SALES_IN_RANGE = "m.type='sale' AND m.deleted_at IS NULL AND m.date BETWEEN ? AND ?";

  const byDay = all(`SELECT date,
        COALESCE(SUM(CASE WHEN type='sale' THEN amount END),0) AS sales,
        COALESCE(SUM(CASE WHEN type='sale' THEN profit END),0) AS profit,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expenses,
        SUM(CASE WHEN type='sale' AND amount > 0 THEN 1 ELSE 0 END) AS n
      FROM movements WHERE deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`, from, to)
    .map(withEuros('sales', 'profit', 'expenses'));

  const byCategory = all(`SELECT c.id, c.name, c.color, COUNT(*) AS n, SUM(m.amount) AS amount, SUM(m.profit) AS profit
      FROM movements m JOIN categories c ON c.id = m.category_id
      WHERE ${SALES_IN_RANGE} GROUP BY c.id ORDER BY profit DESC`, from, to)
    .map(withEuros('amount', 'profit'));

  const expenseByCategory = all(`SELECT c.id, c.name, c.expense_type, COUNT(*) AS n, SUM(m.amount) AS amount
      FROM movements m JOIN categories c ON c.id = m.category_id
      WHERE m.type='expense' AND m.deleted_at IS NULL AND m.date BETWEEN ? AND ?
      GROUP BY c.id ORDER BY amount DESC`, from, to)
    .map(withEuros('amount'));

  const byUser = all(`SELECT u.id, u.name, COUNT(*) AS n, SUM(m.amount) AS amount, SUM(m.profit) AS profit
      FROM movements m JOIN users u ON u.id = m.user_id
      WHERE ${SALES_IN_RANGE} GROUP BY u.id ORDER BY amount DESC`, from, to)
    .map(withEuros('amount', 'profit'));

  const byPayment = all(`SELECT CASE WHEN m.payment_method = '' THEN '—' ELSE m.payment_method END AS method,
                                COUNT(*) AS n, SUM(m.amount) AS amount
      FROM movements m WHERE ${SALES_IN_RANGE} GROUP BY method ORDER BY amount DESC`, from, to)
    .map(withEuros('amount'));

  const deletedCount = get('SELECT COUNT(*) AS n FROM movements WHERE deleted_at IS NOT NULL AND date BETWEEN ? AND ?', from, to).n;

  return {
    from, to,
    totals: totalsFor(from, to),
    previous: { ...previous, totals: totalsFor(previous.from, previous.to) },
    byDay, byCategory, expenseByCategory, byUser, byPayment, deletedCount,
  };
});

route('GET', '/api/admin/year', 'admin', ({ query }) => {
  const year = /^\d{4}$/.test(query.year || '') ? query.year : String(new Date().getFullYear());
  const months = [];
  for (let month = 1; month <= 12; month++) {
    const from = `${year}-${pad(month)}-01`;
    const to = localDate(new Date(Number(year), month, 0));
    months.push({ month: `${year}-${pad(month)}`, ...totalsFor(from, to) });
  }
  return { year, months, totals: totalsFor(`${year}-01-01`, `${year}-12-31`) };
});
