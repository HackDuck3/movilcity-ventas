// Owner dashboard (admin only).
import { api, esc, money, today, addDays, fmtDate, fmtMonth, fromIso, isoDate, toast } from '../core.js';
import { groupedBars, hBars } from '../charts.js';

const PRESETS = [
  ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', '7 días'], ['mes', 'Este mes'], ['mes-1', 'Mes pasado'], ['anio', 'Este año'], ['custom', 'Personalizado'],
];

function rangeFor(p) {
  const t = today(); const d = fromIso(t);
  switch (p) {
    case 'hoy': return [t, t];
    case 'ayer': { const y = addDays(t, -1); return [y, y]; }
    case '7d': return [addDays(t, -6), t];
    case 'mes-1': { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); return [isoDate(a), isoDate(b)]; }
    case 'anio': return [`${d.getFullYear()}-01-01`, t];
    default: return [t.slice(0, 8) + '01', t];
  }
}

export async function dashboardView(root, params) {
  const tab = params.get('tab') || 'resumen';
  root.innerHTML = `
    <div class="page-head"><div><h1>Panel del negocio</h1><div class="sub">Solo visible para administradores</div></div></div>
    <div class="tabs">
      <a href="#/panel" class="${tab === 'resumen' ? 'on' : ''}">Resumen</a>
      <a href="#/panel?tab=anual" class="${tab === 'anual' ? 'on' : ''}">Año completo</a>
    </div>
    <div data-body></div>`;
  const body = root.querySelector('[data-body]');
  if (tab === 'anual') return yearView(body, params);
  return summaryView(body, params);
}

function delta(cur, prev, invert = false) {
  if (!prev) return '';
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (!Number.isFinite(pct) || pct === 0) return '<span class="delta">= periodo anterior</span>';
  const good = invert ? pct < 0 : pct > 0;
  return `<span class="delta ${good ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span> <span class="faint">vs periodo anterior</span>`;
}

async function summaryView(body, params) {
  let preset = params.get('p') || 'mes';
  let [from, to] = preset === 'custom' ? [params.get('desde') || today(), params.get('hasta') || today()] : rangeFor(preset);

  body.innerHTML = `
    <div class="filters">
      <div class="seg" data-presets>${PRESETS.map(([k, l]) => `<button data-p="${k}" class="${k === preset ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="row ${preset === 'custom' ? '' : 'hidden'}" data-custom>
        <input type="date" data-from value="${from}" style="width:auto"> – <input type="date" data-to value="${to}" style="width:auto">
      </div>
    </div>
    <div data-content><div class="empty">Cargando…</div></div>`;

  const go = (p, f, t) => {
    const q = new URLSearchParams({ p }); if (p === 'custom') { q.set('desde', f); q.set('hasta', t); }
    location.hash = '#/panel?' + q.toString();
  };
  body.querySelector('[data-presets]').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p === 'custom') { body.querySelector('[data-custom]').classList.remove('hidden'); body.querySelectorAll('[data-p]').forEach(x => x.classList.toggle('on', x === b)); return; }
    go(b.dataset.p);
  });
  body.querySelectorAll('[data-from],[data-to]').forEach(i => i.addEventListener('change', () => {
    const f = body.querySelector('[data-from]').value, t = body.querySelector('[data-to]').value;
    if (f && t && f <= t) go('custom', f, t);
  }));

  let d;
  try { d = await api(`/admin/stats?from=${from}&to=${to}`); } catch (e) { toast(e.message, 'err'); return; }
  const T = d.totals, P = d.previous.totals;
  const content = body.querySelector('[data-content]');
  const nDays = Math.round((fromIso(to) - fromIso(from)) / 86400e3) + 1;

  content.innerHTML = `
    <div class="muted" style="margin:-4px 0 12px">${from === to ? fmtDate(from) : `Del ${fmtDate(from)} al ${fmtDate(to)}`} · ${nDays} ${nDays === 1 ? 'día' : 'días'}</div>
    ${d.deletedCount ? `<div class="notice warn" style="margin-bottom:14px">Hay <b>${d.deletedCount}</b> apunte(s) borrado(s) en este periodo. <a href="#/movimientos?desde=${from}&hasta=${to}&borrados=1">Revisar</a></div>` : ''}
    <div class="kpis">
      <div class="kpi hero"><div class="label"><span class="dot" style="background:var(--series-1)"></span>Ventas (ingresos)</div><div class="value">${money(T.sales)}</div><div class="foot">${delta(T.sales, P.sales)}</div></div>
      <div class="kpi hero"><div class="label"><span class="dot" style="background:var(--series-2)"></span>Beneficio de ventas</div><div class="value">${money(T.profit)}</div><div class="foot">${delta(T.profit, P.profit)}</div></div>
      <div class="kpi hero"><div class="label"><span class="dot" style="background:var(--expense)"></span>Gastos</div><div class="value">${money(T.expenses)}</div>
        <div class="foot">Mercancía ${money(T.expenses_stock)} · Operativos ${money(T.expenses_operating)}</div></div>
      <div class="kpi hero"><div class="label"><span class="dot" style="background:var(--primary)"></span>Beneficio neto</div><div class="value ${T.net < 0 ? 'neg' : ''}">${money(T.net)}</div>
        <div class="foot" title="Beneficio de ventas menos gastos operativos (la compra de mercancía ya está descontada en el beneficio de cada venta)">beneficio − gastos operativos ⓘ</div></div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="label">Flujo de caja</div><div class="value ${T.cash < 0 ? 'neg' : ''}" style="font-size:20px">${money(T.cash)}</div><div class="foot">ventas − todos los gastos</div></div>
      <div class="kpi"><div class="label">Nº de ventas</div><div class="value" style="font-size:20px">${T.sales_count}</div><div class="foot">${delta(T.sales_count, P.sales_count)}</div></div>
      <div class="kpi"><div class="label">Ticket medio</div><div class="value" style="font-size:20px">${money(T.avg_ticket)}</div></div>
      <div class="kpi"><div class="label">Margen medio</div><div class="value" style="font-size:20px">${String(T.margin).replace('.', ',')} %</div></div>
    </div>

    <div class="card card-pad" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:6px"><h3 style="margin:0">Ventas y beneficio</h3><span class="spacer"></span>
        <div class="legend" style="margin:0"><span><i style="background:var(--series-1)"></i>Ventas</span><span><i style="background:var(--series-2)"></i>Beneficio</span></div></div>
      <div data-chart></div>
      <div class="faint" style="font-size:12px;margin-top:4px" data-chart-hint></div>
    </div>

    <div class="grid-2" style="margin-bottom:16px">
      <div class="card card-pad"><h3>Productos que más beneficio dejan</h3><div data-cats></div></div>
      <div class="card card-pad"><h3>Gastos por motivo</h3><div data-exp></div></div>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h3>Por trabajador</h3></div><div class="table-wrap" data-users></div></div>
      <div class="card card-pad"><h3>Formas de pago</h3><div data-pay></div></div>
    </div>
    <div class="card" data-days-card><div class="card-head"><h3>Día a día</h3><span class="faint">pulsa un día para ver su caja</span></div><div class="table-wrap" data-days></div></div>
  `;

  // ---- chart: per day (up to 62 days) or per month
  const byDayMap = Object.fromEntries(d.byDay.map(r => [r.date, r]));
  let labels = [], titles = [], sales = [], profit = [], keys = [];
  if (nDays <= 62) {
    for (let x = from; x <= to; x = addDays(x, 1)) {
      const r = byDayMap[x] || {}; keys.push(x);
      labels.push(x.slice(8)); titles.push(fromIso(x).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }));
      sales.push(r.sales || 0); profit.push(r.profit || 0);
    }
    content.querySelector('[data-chart-hint]').textContent = 'Pulsa una barra para abrir la caja de ese día.';
  } else {
    const months = {};
    d.byDay.forEach(r => { const k = r.date.slice(0, 7); months[k] = months[k] || { sales: 0, profit: 0 }; months[k].sales += r.sales; months[k].profit += r.profit; });
    for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
      keys.push(m); labels.push(fromIso(m + '-15').toLocaleDateString('es-ES', { month: 'short' })); titles.push(fmtMonth(m));
      sales.push(Math.round((months[m]?.sales || 0) * 100) / 100); profit.push(Math.round((months[m]?.profit || 0) * 100) / 100);
      const [y, mm] = m.split('-').map(Number); m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
    }
  }
  const chartEl = content.querySelector('[data-chart]');
  const drawChart = () => groupedBars(chartEl, {
    labels, titles, height: 250,
    series: [{ name: 'Ventas', color: 'var(--series-1)', values: sales }, { name: 'Beneficio', color: 'var(--series-2)', values: profit }],
    onClick: nDays <= 62 ? (i) => { location.hash = `#/caja?fecha=${keys[i]}`; } : null,
  });
  drawChart();
  const ro = new ResizeObserver(() => { if (document.body.contains(chartEl)) drawChart(); else ro.disconnect(); });
  ro.observe(chartEl);

  hBars(content.querySelector('[data-cats]'), d.byCategory.map(c => ({ label: c.name, value: c.profit, extra: `${c.n} uds · ${money(c.amount)}` })), { color: 'var(--series-2)', max: 10 });
  hBars(content.querySelector('[data-exp]'), d.expenseByCategory.map(c => ({ label: c.name, value: c.amount, extra: c.expense_type === 'stock' ? 'mercancía' : 'operativo' })), { color: 'var(--expense)', max: 8 });
  hBars(content.querySelector('[data-pay]'), d.byPayment.map(p => ({ label: p.method, value: p.amount, extra: `${p.n} ventas` })), { color: 'var(--series-1)' });

  content.querySelector('[data-users]').innerHTML = d.byUser.length ? `<table class="t"><thead><tr><th>Trabajador</th><th class="r">Ventas</th><th class="r">Importe</th><th class="r">Beneficio</th></tr></thead>
    <tbody>${d.byUser.map(u => `<tr><td>${esc(u.name)}</td><td class="r num">${u.n}</td><td class="r num">${money(u.amount)}</td><td class="r num">${money(u.profit)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Sin ventas</div>';

  // ---- day-by-day table
  if (nDays > 62) { content.querySelector('[data-days-card]').classList.add('hidden'); return; }
  const rows = [];
  for (let x = to; x >= from; x = addDays(x, -1)) {
    const r = byDayMap[x]; if (!r) continue;
    rows.push(`<tr class="clickable" data-day="${x}"><td>${fromIso(x).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
      <td class="r num">${r.n}</td><td class="r num">${money(r.sales)}</td><td class="r num">${money(r.profit)}</td><td class="r num">${money(r.expenses)}</td>
      <td class="r num ${r.sales - r.expenses < 0 ? 'neg' : ''}"><b>${money(r.sales - r.expenses)}</b></td></tr>`);
  }
  content.querySelector('[data-days]').innerHTML = rows.length ? `<table class="t"><thead><tr><th>Día</th><th class="r">Nº</th><th class="r">Ventas</th><th class="r">Beneficio</th><th class="r">Gastos</th><th class="r">Balance</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot><tr><td>Total</td><td class="r num">${T.sales_count}</td><td class="r num">${money(T.sales)}</td><td class="r num">${money(T.profit)}</td><td class="r num">${money(T.expenses)}</td><td class="r num">${money(T.cash)}</td></tr></tfoot></table>`
    : '<div class="empty">Sin movimientos en este periodo</div>';
  content.querySelector('[data-days]').addEventListener('click', (e) => { const tr = e.target.closest('[data-day]'); if (tr) location.hash = `#/caja?fecha=${tr.dataset.day}`; });
}

async function yearView(body, params) {
  const year = params.get('anio') || today().slice(0, 4);
  let d;
  try { d = await api(`/admin/year?year=${year}`); } catch (e) { toast(e.message, 'err'); return; }
  const T = d.totals;
  body.innerHTML = `
    <div class="filters">
      <div class="row"><a class="btn btn-sm" href="#/panel?tab=anual&anio=${Number(year) - 1}">← ${Number(year) - 1}</a>
      <b style="font-size:18px">${year}</b>
      <a class="btn btn-sm" href="#/panel?tab=anual&anio=${Number(year) + 1}">${Number(year) + 1} →</a></div>
    </div>
    <div class="kpis">
      <div class="kpi hero"><div class="label">Ventas ${year}</div><div class="value">${money(T.sales)}</div></div>
      <div class="kpi hero"><div class="label">Beneficio de ventas</div><div class="value">${money(T.profit)}</div></div>
      <div class="kpi hero"><div class="label">Gastos</div><div class="value">${money(T.expenses)}</div></div>
      <div class="kpi hero"><div class="label">Beneficio neto</div><div class="value ${T.net < 0 ? 'neg' : ''}">${money(T.net)}</div></div>
    </div>
    <div class="card card-pad" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:6px"><h3 style="margin:0">Mes a mes</h3><span class="spacer"></span>
        <div class="legend" style="margin:0"><span><i style="background:var(--series-1)"></i>Ventas</span><span><i style="background:var(--series-2)"></i>Beneficio</span></div></div>
      <div data-chart></div>
    </div>
    <div class="card"><div class="table-wrap"><table class="t">
      <thead><tr><th>Mes</th><th class="r">Nº ventas</th><th class="r">Ventas</th><th class="r">Beneficio</th><th class="r">Gastos mercancía</th><th class="r">Gastos operativos</th><th class="r">Beneficio neto</th><th class="r">Flujo de caja</th></tr></thead>
      <tbody>${d.months.map(m => `<tr class="clickable" data-m="${m.month}">
        <td style="text-transform:capitalize">${fmtMonth(m.month)}</td><td class="r num">${m.sales_count}</td><td class="r num">${money(m.sales)}</td>
        <td class="r num">${money(m.profit)}</td><td class="r num">${money(m.expenses_stock)}</td><td class="r num">${money(m.expenses_operating)}</td>
        <td class="r num ${m.net < 0 ? 'neg' : ''}"><b>${money(m.net)}</b></td><td class="r num ${m.cash < 0 ? 'neg' : ''}">${money(m.cash)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="r num">${T.sales_count}</td><td class="r num">${money(T.sales)}</td><td class="r num">${money(T.profit)}</td>
        <td class="r num">${money(T.expenses_stock)}</td><td class="r num">${money(T.expenses_operating)}</td><td class="r num">${money(T.net)}</td><td class="r num">${money(T.cash)}</td></tr></tfoot>
    </table></div></div>`;
  const chartEl = body.querySelector('[data-chart]');
  const draw = () => groupedBars(chartEl, {
    labels: d.months.map(m => fromIso(m.month + '-15').toLocaleDateString('es-ES', { month: 'short' })),
    titles: d.months.map(m => fmtMonth(m.month)), height: 240,
    series: [{ name: 'Ventas', color: 'var(--series-1)', values: d.months.map(m => m.sales) }, { name: 'Beneficio', color: 'var(--series-2)', values: d.months.map(m => m.profit) }],
    onClick: (i) => { const m = d.months[i].month; const last = isoDate(new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0)); location.hash = `#/panel?p=custom&desde=${m}-01&hasta=${last}`; },
  });
  draw();
  const ro = new ResizeObserver(() => { if (document.body.contains(chartEl)) draw(); else ro.disconnect(); });
  ro.observe(chartEl);
  body.querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-m]'); if (!tr) return;
    const m = tr.dataset.m; const last = isoDate(new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0));
    location.hash = `#/panel?p=custom&desde=${m}-01&hasta=${last}`;
  });
}
