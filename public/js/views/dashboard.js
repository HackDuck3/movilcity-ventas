// Owner dashboard (admin only): a summary for any period and a month-by-month view of a year.
import { esc, money, today, addDays, fmtDate, fmtMonth, fromIso, isoDate, on, redrawOnResize, tryApi } from '../core.js';
import { groupedBars, rankingBars } from '../charts.js';

const DAY_MS = 86400e3;
const MAX_DAYS_SHOWN_PER_DAY = 62; // longer periods are charted per month

const PRESETS = [
  ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', '7 días'], ['mes', 'Este mes'],
  ['mes-1', 'Mes pasado'], ['anio', 'Este año'], ['custom', 'Personalizado'],
];

const SALES_AND_PROFIT_LEGEND = `
  <div class="legend" style="margin:0">
    <span><i style="background:var(--series-1)"></i>Ventas</span>
    <span><i style="background:var(--series-2)"></i>Beneficio</span>
  </div>`;

const shortMonth = (month) => fromIso(`${month}-15`).toLocaleDateString('es-ES', { month: 'short' });
const lastDayOfMonth = (month) => isoDate(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0));
const monthUrl = (month) => `#/panel?p=custom&desde=${month}-01&hasta=${lastDayOfMonth(month)}`;
const roundCents = (amount) => Math.round(amount * 100) / 100;

function nextMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

function presetRange(preset) {
  const todayDate = today();
  const now = fromIso(todayDate);
  switch (preset) {
    case 'hoy': return [todayDate, todayDate];
    case 'ayer': return [addDays(todayDate, -1), addDays(todayDate, -1)];
    case '7d': return [addDays(todayDate, -6), todayDate];
    case 'mes-1': return [
      isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      isoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
    ];
    case 'anio': return [`${now.getFullYear()}-01-01`, todayDate];
    default: return [`${todayDate.slice(0, 8)}01`, todayDate];
  }
}

// "▲ 12% vs periodo anterior". With invert, going down is the good direction.
function changeBadge(current, previous, invert = false) {
  if (!previous) return '';
  const percent = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (!Number.isFinite(percent) || percent === 0) return '<span class="delta">= periodo anterior</span>';
  const isGood = invert ? percent < 0 : percent > 0;
  return `<span class="delta ${isGood ? 'up' : 'down'}">${percent > 0 ? '▲' : '▼'} ${Math.abs(percent)}%</span>
          <span class="faint">vs periodo anterior</span>`;
}

function heroKpi(label, value, color, footer = '') {
  return `
    <div class="kpi hero">
      <div class="label">${color ? `<span class="dot" style="background:${color}"></span>` : ''}${label}</div>
      <div class="value ${value < 0 ? 'neg' : ''}">${money(value)}</div>
      ${footer ? `<div class="foot">${footer}</div>` : ''}
    </div>`;
}

function smallKpi(label, text, footer = '', isNegative = false) {
  return `
    <div class="kpi">
      <div class="label">${label}</div>
      <div class="value ${isNegative ? 'neg' : ''}" style="font-size:20px">${text}</div>
      ${footer ? `<div class="foot">${footer}</div>` : ''}
    </div>`;
}

function chartCard(title) {
  return `
    <div class="card card-pad" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:6px"><h3 style="margin:0">${title}</h3><span class="spacer"></span>${SALES_AND_PROFIT_LEGEND}</div>
      <div data-chart></div>
      <div class="faint" style="font-size:12px;margin-top:4px" data-chart-hint></div>
    </div>`;
}

function drawSalesChart(element, { labels, titles, sales, profit, height, onClick }) {
  const draw = () => groupedBars(element, {
    labels, titles, height, onClick,
    series: [
      { name: 'Ventas', color: 'var(--series-1)', values: sales },
      { name: 'Beneficio', color: 'var(--series-2)', values: profit },
    ],
  });
  draw();
  redrawOnResize(element, draw);
}

export async function dashboardView(root, params) {
  const tab = params.get('tab') === 'anual' ? 'anual' : 'resumen';
  root.innerHTML = `
    <div class="page-head"><div><h1>Panel del negocio</h1><div class="sub">Solo visible para administradores</div></div></div>
    <div class="tabs">
      <a href="#/panel" class="${tab === 'resumen' ? 'on' : ''}">Resumen</a>
      <a href="#/panel?tab=anual" class="${tab === 'anual' ? 'on' : ''}">Año completo</a>
    </div>
    <div data-body></div>`;
  const body = root.querySelector('[data-body]');
  return tab === 'anual' ? renderYear(body, params) : renderSummary(body, params);
}

// ---- Summary of a period
async function renderSummary(body, params) {
  const preset = params.get('p') || 'mes';
  const [from, to] = preset === 'custom'
    ? [params.get('desde') || today(), params.get('hasta') || today()]
    : presetRange(preset);

  body.innerHTML = `
    <div class="filters">
      <div class="seg" data-presets>
        ${PRESETS.map(([key, label]) => `<button data-preset="${key}" class="${key === preset ? 'on' : ''}">${label}</button>`).join('')}
      </div>
      <div class="row ${preset === 'custom' ? '' : 'hidden'}" data-custom-range>
        <input type="date" data-from value="${from}" style="width:auto"> –
        <input type="date" data-to value="${to}" style="width:auto">
      </div>
    </div>
    <div data-content><div class="empty">Cargando…</div></div>`;

  on(body, 'click', '[data-preset]', (button) => {
    if (button.dataset.preset !== 'custom') {
      location.hash = `#/panel?p=${button.dataset.preset}`;
      return;
    }
    body.querySelector('[data-custom-range]').classList.remove('hidden');
    body.querySelectorAll('[data-preset]').forEach(other => other.classList.toggle('on', other === button));
  });
  on(body, 'change', '[data-from], [data-to]', () => {
    const newFrom = body.querySelector('[data-from]').value;
    const newTo = body.querySelector('[data-to]').value;
    if (newFrom && newTo && newFrom <= newTo) location.hash = `#/panel?p=custom&desde=${newFrom}&hasta=${newTo}`;
  });

  const stats = await tryApi(`/admin/stats?from=${from}&to=${to}`);
  if (!stats) return;
  const content = body.querySelector('[data-content]');
  const dayCount = Math.round((fromIso(to) - fromIso(from)) / DAY_MS) + 1;
  const showsDays = dayCount <= MAX_DAYS_SHOWN_PER_DAY;

  content.innerHTML = summaryHtml(stats, from, to, dayCount);
  content.querySelector('[data-chart-hint]').textContent = showsDays ? 'Pulsa una barra para abrir la caja de ese día.' : '';

  const series = showsDays ? dailySeries(stats.byDay, from, to) : monthlySeries(stats.byDay, from, to);
  drawSalesChart(content.querySelector('[data-chart]'), {
    ...series,
    height: 250,
    onClick: showsDays ? (index) => { location.hash = `#/caja?fecha=${series.keys[index]}`; } : null,
  });

  rankingBars(content.querySelector('[data-top-products]'),
    stats.byCategory.map(c => ({ label: c.name, value: c.profit, extra: `${c.n} uds · ${money(c.amount)}` })),
    { color: 'var(--series-2)', max: 10 });
  rankingBars(content.querySelector('[data-expenses]'),
    stats.expenseByCategory.map(c => ({ label: c.name, value: c.amount, extra: c.expense_type === 'stock' ? 'mercancía' : 'operativo' })),
    { color: 'var(--expense)', max: 8 });
  rankingBars(content.querySelector('[data-payments]'),
    stats.byPayment.map(p => ({ label: p.method, value: p.amount, extra: `${p.n} ventas` })),
    { color: 'var(--series-1)' });

  content.querySelector('[data-workers]').innerHTML = workersTable(stats.byUser);
  const daysCard = content.querySelector('[data-days-card]');
  if (showsDays) {
    daysCard.querySelector('[data-days]').innerHTML = daysTable(stats);
    on(daysCard, 'click', '[data-day]', (row) => { location.hash = `#/caja?fecha=${row.dataset.day}`; });
  } else {
    daysCard.classList.add('hidden');
  }
}

function summaryHtml(stats, from, to, dayCount) {
  const { totals } = stats;
  const previous = stats.previous.totals;
  const period = from === to ? fmtDate(from) : `Del ${fmtDate(from)} al ${fmtDate(to)}`;
  const deletedNotice = stats.deletedCount ? `
    <div class="notice warn" style="margin-bottom:14px">
      Hay <b>${stats.deletedCount}</b> apunte(s) borrado(s) en este periodo.
      <a href="#/movimientos?desde=${from}&hasta=${to}&borrados=1">Revisar</a>
    </div>` : '';
  const netHint = 'Beneficio de ventas menos gastos operativos (la compra de mercancía ya está descontada en el beneficio de cada venta)';

  return `
    <div class="muted" style="margin:-4px 0 12px">${period} · ${dayCount} ${dayCount === 1 ? 'día' : 'días'}</div>
    ${deletedNotice}
    <div class="kpis">
      ${heroKpi('Ventas (ingresos)', totals.sales, 'var(--series-1)', changeBadge(totals.sales, previous.sales))}
      ${heroKpi('Beneficio de ventas', totals.profit, 'var(--series-2)', changeBadge(totals.profit, previous.profit))}
      ${heroKpi('Gastos', totals.expenses, 'var(--expense)', `Mercancía ${money(totals.expenses_stock)} · Operativos ${money(totals.expenses_operating)}`)}
      ${heroKpi('Beneficio neto', totals.net, 'var(--primary)', `<span title="${netHint}">beneficio − gastos operativos ⓘ</span>`)}
    </div>
    <div class="kpis">
      ${smallKpi('Flujo de caja', money(totals.cash), 'ventas − todos los gastos', totals.cash < 0)}
      ${smallKpi('Nº de ventas', totals.sales_count, changeBadge(totals.sales_count, previous.sales_count))}
      ${smallKpi('Ticket medio', money(totals.avg_ticket))}
      ${smallKpi('Margen medio', `${String(totals.margin).replace('.', ',')} %`)}
    </div>
    ${chartCard('Ventas y beneficio')}
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card card-pad"><h3>Productos que más beneficio dejan</h3><div data-top-products></div></div>
      <div class="card card-pad"><h3>Gastos por motivo</h3><div data-expenses></div></div>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h3>Por trabajador</h3></div><div class="table-wrap" data-workers></div></div>
      <div class="card card-pad"><h3>Formas de pago</h3><div data-payments></div></div>
    </div>
    <div class="card" data-days-card>
      <div class="card-head"><h3>Día a día</h3><span class="faint">pulsa un día para ver su caja</span></div>
      <div class="table-wrap" data-days></div>
    </div>`;
}

// One bar group per day, including days without movements.
function dailySeries(byDay, from, to) {
  const statsByDate = Object.fromEntries(byDay.map(day => [day.date, day]));
  const series = { keys: [], labels: [], titles: [], sales: [], profit: [] };
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = statsByDate[date] || {};
    series.keys.push(date);
    series.labels.push(date.slice(8));
    series.titles.push(fromIso(date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }));
    series.sales.push(day.sales || 0);
    series.profit.push(day.profit || 0);
  }
  return series;
}

function monthlySeries(byDay, from, to) {
  const totalsByMonth = {};
  for (const day of byDay) {
    const month = day.date.slice(0, 7);
    totalsByMonth[month] ??= { sales: 0, profit: 0 };
    totalsByMonth[month].sales += day.sales;
    totalsByMonth[month].profit += day.profit;
  }
  const series = { keys: [], labels: [], titles: [], sales: [], profit: [] };
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = nextMonth(month)) {
    series.keys.push(month);
    series.labels.push(shortMonth(month));
    series.titles.push(fmtMonth(month));
    series.sales.push(roundCents(totalsByMonth[month]?.sales || 0));
    series.profit.push(roundCents(totalsByMonth[month]?.profit || 0));
  }
  return series;
}

function workersTable(workers) {
  if (!workers.length) return '<div class="empty">Sin ventas</div>';
  const rows = workers.map(worker => `
    <tr>
      <td>${esc(worker.name)}</td>
      <td class="r num">${worker.n}</td>
      <td class="r num">${money(worker.amount)}</td>
      <td class="r num">${money(worker.profit)}</td>
    </tr>`).join('');
  return `
    <table class="t">
      <thead><tr><th>Trabajador</th><th class="r">Ventas</th><th class="r">Importe</th><th class="r">Beneficio</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function daysTable(stats) {
  if (!stats.byDay.length) return '<div class="empty">Sin movimientos en este periodo</div>';
  const { totals } = stats;
  const newestFirst = [...stats.byDay].sort((a, b) => b.date.localeCompare(a.date));
  const rows = newestFirst.map(day => {
    const balance = day.sales - day.expenses;
    return `
      <tr class="clickable" data-day="${day.date}">
        <td>${fromIso(day.date).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
        <td class="r num">${day.n}</td>
        <td class="r num">${money(day.sales)}</td>
        <td class="r num">${money(day.profit)}</td>
        <td class="r num">${money(day.expenses)}</td>
        <td class="r num ${balance < 0 ? 'neg' : ''}"><b>${money(balance)}</b></td>
      </tr>`;
  }).join('');
  return `
    <table class="t">
      <thead><tr>
        <th>Día</th><th class="r">Nº</th><th class="r">Ventas</th><th class="r">Beneficio</th><th class="r">Gastos</th><th class="r">Balance</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td>Total</td>
        <td class="r num">${totals.sales_count}</td>
        <td class="r num">${money(totals.sales)}</td>
        <td class="r num">${money(totals.profit)}</td>
        <td class="r num">${money(totals.expenses)}</td>
        <td class="r num">${money(totals.cash)}</td>
      </tr></tfoot>
    </table>`;
}

// ---- Whole year, month by month
async function renderYear(body, params) {
  const year = Number(params.get('anio')) || Number(today().slice(0, 4));
  const stats = await tryApi(`/admin/year?year=${year}`);
  if (!stats) return;
  const { totals, months } = stats;

  const amountCells = (row) => `
    <td class="r num">${row.sales_count}</td>
    <td class="r num">${money(row.sales)}</td>
    <td class="r num">${money(row.profit)}</td>
    <td class="r num">${money(row.expenses_stock)}</td>
    <td class="r num">${money(row.expenses_operating)}</td>
    <td class="r num ${row.net < 0 ? 'neg' : ''}"><b>${money(row.net)}</b></td>
    <td class="r num ${row.cash < 0 ? 'neg' : ''}">${money(row.cash)}</td>`;

  body.innerHTML = `
    <div class="filters">
      <div class="row">
        <a class="btn btn-sm" href="#/panel?tab=anual&anio=${year - 1}">← ${year - 1}</a>
        <b style="font-size:18px">${year}</b>
        <a class="btn btn-sm" href="#/panel?tab=anual&anio=${year + 1}">${year + 1} →</a>
      </div>
    </div>
    <div class="kpis">
      ${heroKpi(`Ventas ${year}`, totals.sales)}
      ${heroKpi('Beneficio de ventas', totals.profit)}
      ${heroKpi('Gastos', totals.expenses)}
      ${heroKpi('Beneficio neto', totals.net)}
    </div>
    ${chartCard('Mes a mes')}
    <div class="card"><div class="table-wrap">
      <table class="t">
        <thead><tr>
          <th>Mes</th><th class="r">Nº ventas</th><th class="r">Ventas</th><th class="r">Beneficio</th>
          <th class="r">Gastos mercancía</th><th class="r">Gastos operativos</th><th class="r">Beneficio neto</th><th class="r">Flujo de caja</th>
        </tr></thead>
        <tbody>
          ${months.map(month => `
            <tr class="clickable" data-month="${month.month}">
              <td style="text-transform:capitalize">${fmtMonth(month.month)}</td>${amountCells(month)}
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td>Total</td>${amountCells(totals)}</tr></tfoot>
      </table>
    </div></div>`;

  drawSalesChart(body.querySelector('[data-chart]'), {
    labels: months.map(month => shortMonth(month.month)),
    titles: months.map(month => fmtMonth(month.month)),
    sales: months.map(month => month.sales),
    profit: months.map(month => month.profit),
    height: 240,
    onClick: (index) => { location.hash = monthUrl(months[index].month); },
  });
  on(body, 'click', '[data-month]', (row) => { location.hash = monthUrl(row.dataset.month); });
}
