// Caja del día: pantalla principal del trabajador.
import { api, state, esc, icon, money, chip, fmtTime, fmtDateLong, addDays, today, isAdmin, can, perms, toast, confirmDialog, modal } from '../core.js';
import { mountMovementForm } from '../movform.js';

export async function cajaView(root, params) {
  const t = today();
  let date = params.get('fecha') || t;
  const histDays = isAdmin() ? 99999 : Number(perms().worker_history_days) || 0;
  const minDate = addDays(t, -histDays);
  let openForm = params.get('nuevo') || null; // 'sale' | 'expense'

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Caja</h1><div class="sub" data-date-label></div></div>
      <span class="spacer"></span>
      <div class="row" data-date-nav>
        <button class="btn btn-icon" data-prev title="Día anterior">${icon('left')}</button>
        <input type="date" data-date style="width:auto" max="${t}" min="${histDays < 99999 ? minDate : ''}">
        <button class="btn btn-icon" data-next title="Día siguiente">${icon('right')}</button>
        <button class="btn btn-sm" data-today>Hoy</button>
      </div>
    </div>
    <div class="kpis" data-kpis></div>
    <div class="big-actions">
      <button class="big-btn sale" data-open="sale">${icon('plus')}<span>Añadir venta<small>Producto, precio y beneficio</small></span></button>
      <button class="big-btn expense" data-open="expense" ${can('worker_add_expenses') ? '' : 'disabled title="No tienes permiso para registrar gastos"'}>${icon('minus')}<span>Añadir gasto<small>Compras, proveedor, tienda…</small></span></button>
    </div>
    <div data-form-slot></div>
    <div class="day-cols">
      <div class="card"><div class="card-head"><h3>Ventas</h3><span class="count" data-sales-count></span></div><div class="table-wrap" data-sales></div></div>
      <div class="card"><div class="card-head"><h3>Gastos</h3><span class="count" data-exp-count></span></div><div class="table-wrap" data-expenses></div></div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  if (histDays === 0) $('[data-date-nav]').classList.add('hidden');

  function setOpen(type) {
    openForm = type;
    root.querySelectorAll('[data-open]').forEach(b => b.classList.toggle('active', b.dataset.open === type));
    const slot = $('[data-form-slot]');
    if (!type) { slot.innerHTML = ''; return; }
    mountMovementForm(slot, {
      type, allowDate: isAdmin(), date,
      onCancel: () => setOpen(null),
      onSaved: async ({ id, docKind, body, category }) => {
        await load();
        if (docKind) {
          location.hash = `#/${docKind === 'ticket' ? 'tickets' : 'facturas'}/nueva?venta=${id}&desc=${encodeURIComponent(category.name + (body.description ? ' ' + body.description : ''))}&precio=${body.amount}`;
        }
      },
    });
  }

  root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => setOpen(openForm === b.dataset.open ? null : b.dataset.open)));

  function kpi(label, value, color, foot = '') {
    return `<div class="kpi"><div class="label"><span class="dot" style="background:${color}"></span>${esc(label)}</div>
      <div class="value ${value < 0 ? 'neg' : ''}">${money(value)}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  }

  function docButtons(m) {
    if (m.invoice_id) return `<a class="btn btn-ghost btn-icon" href="#/facturas/${m.invoice_id}" title="Ver ticket / factura" style="color:var(--primary)">${icon('eye')}</a>`;
    const q = `venta=${m.id}&desc=${encodeURIComponent(m.category + (m.description ? ' ' + m.description : ''))}&precio=${m.amount}`;
    return `<a class="btn btn-ghost btn-icon" href="#/tickets/nueva?${q}" title="Hacer ticket" style="opacity:.6">${icon('receipt')}</a>
            <a class="btn btn-ghost btn-icon" href="#/facturas/nueva?${q}" title="Hacer factura" style="opacity:.6">${icon('invoice')}</a>`;
  }

  function rowsHtml(list, isSale) {
    if (!list.length) return `<div class="empty">${isSale ? 'Todavía no hay ventas este día' : 'Sin gastos este día'}</div>`;
    const showProfit = isSale && list.some(m => m.profit !== undefined);
    return `<table class="t"><thead><tr>
        <th>Hora</th><th>${isSale ? 'Producto' : 'Motivo'}</th><th class="r">${isSale ? 'Precio' : 'Importe'}</th>
        ${showProfit ? '<th class="r">Beneficio</th>' : ''}<th>Pago</th>${isAdmin() ? '<th>Usuario</th>' : ''}<th></th>
      </tr></thead><tbody>${list.map(m => `
        <tr>
          <td class="faint num">${fmtTime(m.created_at)}</td>
          <td>${chip(m.category, m.color)}${m.description ? `<div class="desc" title="${esc(m.description)}">${esc(m.description)}</div>` : ''}</td>
          <td class="r num"><b>${money(m.amount)}</b></td>
          ${showProfit ? `<td class="r num">${money(m.profit)}</td>` : ''}
          <td class="muted">${esc(m.payment_method || '')}</td>
          ${isAdmin() ? `<td class="muted">${esc(m.user || '')}</td>` : ''}
          <td><div class="row-actions">
            ${isSale && state.settings.modules.invoices && can('worker_create_invoices') ? docButtons(m) : ''}
            ${m.can_edit ? `<button class="btn btn-ghost btn-icon" data-edit="${m.id}" title="Editar">${icon('edit')}</button>
                            <button class="btn btn-ghost btn-icon btn-danger" data-del="${m.id}" title="Borrar">${icon('trash')}</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody></table>`;
  }

  let data;
  async function load() {
    $('[data-date]').value = date;
    $('[data-date-label]').textContent = fmtDateLong(date) + (date === t ? ' · hoy' : '');
    $('[data-next]').disabled = date >= t;
    $('[data-prev]').disabled = date <= minDate;
    try { data = await api(`/day?date=${date}`); }
    catch (e) { toast(e.message, 'err'); return; }
    const k = data.totals; let html = '';
    if (k.sales !== undefined) html += kpi('Vendido', k.sales, 'var(--series-1)', `${k.sales_count} ${k.sales_count === 1 ? 'venta' : 'ventas'}`);
    if (k.profit !== undefined) html += kpi('Beneficio', k.profit, 'var(--series-2)', k.sales ? `margen ${Math.round((k.profit / k.sales) * 100)}%` : '');
    if (k.expenses !== undefined) html += kpi('Gastos', k.expenses, 'var(--expense)');
    if (k.balance !== undefined) html += kpi('Balance de caja', k.balance, 'var(--primary)', 'vendido − gastos');
    if (k.by_payment && k.by_payment.length > 1) {
      html += `<div class="kpi"><div class="label">Por forma de pago</div>${k.by_payment.map(p =>
        `<div class="row" style="justify-content:space-between;margin-top:4px"><span class="muted">${esc(p.method)}</span><b class="num">${money(p.amount)}</b></div>`).join('')}</div>`;
    }
    if (!html) html = `<div class="kpi"><div class="label">Ventas de hoy</div><div class="value">${k.sales_count}</div></div>`;
    $('[data-kpis]').innerHTML = html;
    $('[data-sales]').innerHTML = rowsHtml(data.sales, true);
    $('[data-expenses]').innerHTML = rowsHtml(data.expenses, false);
    $('[data-sales-count]').textContent = `(${data.sales.length})`;
    $('[data-exp-count]').textContent = `(${data.expenses.length})`;
  }

  root.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) {
      const id = Number(ed.dataset.edit);
      const mv = [...data.sales, ...data.expenses].find(m => m.id === id);
      const m = modal({ title: 'Editar', body: '<div data-slot></div>', wide: true });
      mountMovementForm(m.el.querySelector('[data-slot]'), {
        type: mv.type, movement: mv, allowDate: isAdmin(), modalMode: true,
        onSaved: async () => { m.close(); await load(); },
      });
    }
    if (del) {
      const id = Number(del.dataset.del);
      if (!(await confirmDialog('¿Borrar este apunte? El administrador podrá ver que se ha borrado.', { okText: 'Borrar', danger: true }))) return;
      try { await api(`/movements/${id}`, { method: 'DELETE' }); toast('Borrado'); load(); }
      catch (err) { toast(err.message, 'err'); }
    }
  });

  $('[data-date]').addEventListener('change', (e) => { if (e.target.value) { date = e.target.value; load(); } });
  $('[data-prev]').addEventListener('click', () => { date = addDays(date, -1); load(); });
  $('[data-next]').addEventListener('click', () => { date = addDays(date, 1); load(); });
  $('[data-today]').addEventListener('click', () => { date = t; load(); });

  // atajos de teclado: V = venta, G = gasto
  const onKey = (e) => {
    if (!document.body.contains(root)) return document.removeEventListener('keydown', onKey);
    if (e.target.matches('input, textarea, select') || e.ctrlKey || e.metaKey || document.querySelector('.modal-back')) return;
    if (e.key === 'v' || e.key === 'V') { e.preventDefault(); setOpen('sale'); }
    if ((e.key === 'g' || e.key === 'G') && can('worker_add_expenses')) { e.preventDefault(); setOpen('expense'); }
  };
  document.addEventListener('keydown', onKey);

  await load();
  if (openForm) setOpen(openForm);
}
