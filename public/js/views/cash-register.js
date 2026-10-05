// Daily cash register: the worker's main screen.
import {
  api, state, esc, icon, money, chip, fmtTime, fmtDateLong, addDays, today, isAdmin, can, perms,
  toast, confirmDialog, modal, on, tryApi,
} from '../core.js';
import { mountMovementForm } from '../movement-form.js';

// Link to the ticket/invoice editor with the sale already filled in.
function documentEditorUrl(kind, saleId, categoryName, description, amount) {
  const section = kind === 'ticket' ? 'tickets' : 'facturas';
  const text = [categoryName, description].filter(Boolean).join(' ');
  return `#/${section}/nueva?venta=${saleId}&desc=${encodeURIComponent(text)}&precio=${amount}`;
}

function kpiCard(label, value, color, footer = '') {
  return `
    <div class="kpi">
      <div class="label"><span class="dot" style="background:${color}"></span>${esc(label)}</div>
      <div class="value ${value < 0 ? 'neg' : ''}">${money(value)}</div>
      ${footer ? `<div class="foot">${footer}</div>` : ''}
    </div>`;
}

// The server only sends the totals this user is allowed to see.
function kpisHtml(totals) {
  const cards = [];
  if (totals.sales !== undefined) {
    cards.push(kpiCard('Vendido', totals.sales, 'var(--series-1)', `${totals.sales_count} ${totals.sales_count === 1 ? 'venta' : 'ventas'}`));
  }
  if (totals.profit !== undefined) {
    const margin = totals.sales ? `margen ${Math.round((totals.profit / totals.sales) * 100)}%` : '';
    cards.push(kpiCard('Beneficio', totals.profit, 'var(--series-2)', margin));
  }
  if (totals.expenses !== undefined) cards.push(kpiCard('Gastos', totals.expenses, 'var(--expense)'));
  if (totals.balance !== undefined) cards.push(kpiCard('Balance de caja', totals.balance, 'var(--primary)', 'vendido − gastos'));
  if (totals.by_payment && totals.by_payment.length > 1) {
    const rows = totals.by_payment.map(payment => `
      <div class="row" style="justify-content:space-between;margin-top:4px">
        <span class="muted">${esc(payment.method)}</span><b class="num">${money(payment.amount)}</b>
      </div>`).join('');
    cards.push(`<div class="kpi"><div class="label">Por forma de pago</div>${rows}</div>`);
  }
  if (!cards.length) {
    cards.push(`<div class="kpi"><div class="label">Ventas de hoy</div><div class="value">${totals.sales_count}</div></div>`);
  }
  return cards.join('');
}

function documentButtons(sale) {
  if (sale.invoice_id) {
    return `<a class="btn btn-ghost btn-icon" href="#/facturas/${sale.invoice_id}" title="Ver ticket / factura" style="color:var(--primary)">${icon('eye')}</a>`;
  }
  const url = (kind) => documentEditorUrl(kind, sale.id, sale.category, sale.description, sale.amount);
  return `
    <a class="btn btn-ghost btn-icon" href="${url('ticket')}" title="Hacer ticket" style="opacity:.6">${icon('receipt')}</a>
    <a class="btn btn-ghost btn-icon" href="${url('factura')}" title="Hacer factura" style="opacity:.6">${icon('invoice')}</a>`;
}

function movementsTable(movements, isSale) {
  if (!movements.length) {
    return `<div class="empty">${isSale ? 'Todavía no hay ventas este día' : 'Sin gastos este día'}</div>`;
  }
  const showProfit = isSale && movements.some(movement => movement.profit !== undefined);
  const showDocuments = isSale && state.settings.modules.invoices && can('worker_create_invoices');

  const row = (movement) => `
    <tr>
      <td class="faint num">${fmtTime(movement.created_at)}</td>
      <td>
        ${chip(movement.category, movement.color)}
        ${movement.description ? `<div class="desc" title="${esc(movement.description)}">${esc(movement.description)}</div>` : ''}
      </td>
      <td class="r num"><b>${money(movement.amount)}</b></td>
      ${showProfit ? `<td class="r num">${money(movement.profit)}</td>` : ''}
      <td class="muted">${esc(movement.payment_method || '')}</td>
      ${isAdmin() ? `<td class="muted">${esc(movement.user || '')}</td>` : ''}
      <td><div class="row-actions">
        ${showDocuments ? documentButtons(movement) : ''}
        ${movement.can_edit ? `
          <button class="btn btn-ghost btn-icon" data-edit="${movement.id}" title="Editar">${icon('edit')}</button>
          <button class="btn btn-ghost btn-icon btn-danger" data-delete="${movement.id}" title="Borrar">${icon('trash')}</button>` : ''}
      </div></td>
    </tr>`;

  return `
    <table class="t">
      <thead><tr>
        <th>Hora</th>
        <th>${isSale ? 'Producto' : 'Motivo'}</th>
        <th class="r">${isSale ? 'Precio' : 'Importe'}</th>
        ${showProfit ? '<th class="r">Beneficio</th>' : ''}
        <th>Pago</th>
        ${isAdmin() ? '<th>Usuario</th>' : ''}
        <th></th>
      </tr></thead>
      <tbody>${movements.map(row).join('')}</tbody>
    </table>`;
}

export async function cashRegisterView(root, params) {
  const todayDate = today();
  // Admins can browse any day; workers only as far back as their permission allows.
  const historyDays = isAdmin() ? null : Number(perms().worker_history_days) || 0;
  const oldestDate = historyDays === null ? '' : addDays(todayDate, -historyDays);
  const canAddExpenses = can('worker_add_expenses');

  let date = params.get('fecha') || todayDate;
  let openFormType = null; // 'sale' | 'expense' | null
  let day = { sales: [], expenses: [] };

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Caja</h1><div class="sub" data-date-label></div></div>
      <span class="spacer"></span>
      <div class="row ${historyDays === 0 ? 'hidden' : ''}">
        <button class="btn btn-icon" data-previous-day title="Día anterior">${icon('left')}</button>
        <input type="date" data-date style="width:auto" max="${todayDate}" min="${oldestDate}">
        <button class="btn btn-icon" data-next-day title="Día siguiente">${icon('right')}</button>
        <button class="btn btn-sm" data-today>Hoy</button>
      </div>
    </div>
    <div class="kpis" data-kpis></div>
    <div class="big-actions">
      <button class="big-btn sale" data-open-form="sale">
        ${icon('plus')}<span>Añadir venta<small>Producto, precio y beneficio</small></span>
      </button>
      <button class="big-btn expense" data-open-form="expense" ${canAddExpenses ? '' : 'disabled title="No tienes permiso para registrar gastos"'}>
        ${icon('minus')}<span>Añadir gasto<small>Compras, proveedor, tienda…</small></span>
      </button>
    </div>
    <div data-form-slot></div>
    <div class="day-cols">
      <div class="card">
        <div class="card-head"><h3>Ventas</h3><span class="count" data-sales-count></span></div>
        <div class="table-wrap" data-sales></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Gastos</h3><span class="count" data-expenses-count></span></div>
        <div class="table-wrap" data-expenses></div>
      </div>
    </div>`;

  const find = (selector) => root.querySelector(selector);

  async function load() {
    find('[data-date]').value = date;
    find('[data-date-label]').textContent = fmtDateLong(date) + (date === todayDate ? ' · hoy' : '');
    find('[data-next-day]').disabled = date >= todayDate;
    find('[data-previous-day]').disabled = oldestDate !== '' && date <= oldestDate;

    const loaded = await tryApi(`/day?date=${date}`);
    if (!loaded) return;
    day = loaded;
    find('[data-kpis]').innerHTML = kpisHtml(day.totals);
    find('[data-sales]').innerHTML = movementsTable(day.sales, true);
    find('[data-expenses]').innerHTML = movementsTable(day.expenses, false);
    find('[data-sales-count]').textContent = `(${day.sales.length})`;
    find('[data-expenses-count]').textContent = `(${day.expenses.length})`;
  }

  function showDate(newDate) {
    date = newDate;
    load();
  }

  function openForm(type) {
    openFormType = type;
    root.querySelectorAll('[data-open-form]').forEach(button => button.classList.toggle('active', button.dataset.openForm === type));
    const slot = find('[data-form-slot]');
    if (!type) {
      slot.innerHTML = '';
      return;
    }
    mountMovementForm(slot, {
      type, date,
      allowDate: isAdmin(),
      onCancel: () => openForm(null),
      onSaved: async ({ id, documentKind, body, category }) => {
        await load();
        if (documentKind) location.hash = documentEditorUrl(documentKind, id, category.name, body.description, body.amount);
      },
    });
  }

  function editMovement(id) {
    const movement = [...day.sales, ...day.expenses].find(candidate => candidate.id === id);
    const dialog = modal({ title: 'Editar', body: '<div data-slot></div>', wide: true });
    mountMovementForm(dialog.el.querySelector('[data-slot]'), {
      type: movement.type, movement,
      allowDate: isAdmin(),
      modalMode: true,
      onSaved: async () => { dialog.close(); await load(); },
    });
  }

  async function deleteMovement(id) {
    const confirmed = await confirmDialog('¿Borrar este apunte? El administrador podrá ver que se ha borrado.', { okText: 'Borrar', danger: true });
    if (!confirmed) return;
    try {
      await api(`/movements/${id}`, { method: 'DELETE' });
      toast('Borrado');
      load();
    } catch (error) {
      toast(error.message, 'err');
    }
  }

  // V = sale (venta), G = expense (gasto). Ignored while typing or with a modal open.
  function onShortcut(event) {
    if (!document.body.contains(root)) {
      document.removeEventListener('keydown', onShortcut);
      return;
    }
    const isTyping = event.target.matches('input, textarea, select');
    if (isTyping || event.ctrlKey || event.metaKey || document.querySelector('.modal-back')) return;
    const key = event.key.toLowerCase();
    if (key === 'v') { event.preventDefault(); openForm('sale'); }
    if (key === 'g' && canAddExpenses) { event.preventDefault(); openForm('expense'); }
  }

  on(root, 'click', '[data-open-form]', (button) => openForm(openFormType === button.dataset.openForm ? null : button.dataset.openForm));
  on(root, 'click', '[data-edit]', (button) => editMovement(Number(button.dataset.edit)));
  on(root, 'click', '[data-delete]', (button) => deleteMovement(Number(button.dataset.delete)));
  on(root, 'click', '[data-previous-day]', () => showDate(addDays(date, -1)));
  on(root, 'click', '[data-next-day]', () => showDate(addDays(date, 1)));
  on(root, 'click', '[data-today]', () => showDate(todayDate));
  find('[data-date]').addEventListener('change', (event) => { if (event.target.value) showDate(event.target.value); });
  document.addEventListener('keydown', onShortcut);

  await load();
  if (['sale', 'expense'].includes(params.get('nuevo'))) openForm(params.get('nuevo'));
}
