// Full list of movements (admin only): filter, fix, delete, restore and export.
import {
  api, state, esc, icon, money, chip, fmtDate, fmtTime, today, toast, confirmDialog, modal, debounce, on, tryApi,
} from '../core.js';
import { mountMovementForm } from '../movement-form.js';

const SERVER_ROW_LIMIT = 2000;

const options = (items) => items.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');

function typeCell(movement) {
  if (movement.type === 'sale') return '<span style="color:var(--sale);font-weight:600">Venta</span>';
  const stockNote = movement.expense_type === 'stock' ? ' <span class="faint">· mercancía</span>' : '';
  return `<span style="color:var(--expense);font-weight:600">Gasto</span>${stockNote}`;
}

function actionsCell(movement) {
  const invoiceLink = movement.invoice_id
    ? `<a class="btn btn-ghost btn-icon" href="#/facturas/${movement.invoice_id}" title="Ver factura">${icon('invoice')}</a>`
    : '';
  const buttons = movement.deleted_at
    ? `<button class="btn btn-ghost btn-sm" data-restore="${movement.id}">${icon('undo')} Recuperar</button>`
    : `<button class="btn btn-ghost btn-icon" data-edit="${movement.id}" title="Editar">${icon('edit')}</button>
       <button class="btn btn-ghost btn-icon btn-danger" data-delete="${movement.id}" title="Borrar">${icon('trash')}</button>`;
  return `<div class="row-actions">${invoiceLink}${buttons}</div>`;
}

function movementRow(movement) {
  const deletedNote = movement.deleted_at
    ? `<div class="faint" style="font-size:12px;text-decoration:none">borrado por ${esc(movement.deleted_by || '?')} · ${esc(movement.deleted_at.slice(0, 16))}</div>`
    : '';
  return `
    <tr class="${movement.deleted_at ? 'deleted' : ''}">
      <td class="num">${fmtDate(movement.date)} <span class="faint">${fmtTime(movement.created_at)}</span></td>
      <td>${typeCell(movement)}</td>
      <td>
        ${chip(movement.category, movement.color)}
        ${movement.description ? `<div class="desc" title="${esc(movement.description)}">${esc(movement.description)}</div>` : ''}
      </td>
      <td class="r num"><b>${money(movement.amount)}</b></td>
      <td class="r num">${movement.type === 'sale' ? money(movement.profit) : ''}</td>
      <td class="muted">${esc(movement.payment_method || '')}</td>
      <td class="muted">${esc(movement.user || '')}${deletedNote}</td>
      <td>${actionsCell(movement)}</td>
    </tr>`;
}

function movementsTable(movements) {
  if (!movements.length) return '<div class="empty">No hay movimientos con estos filtros</div>';
  const limitNote = movements.length >= SERVER_ROW_LIMIT
    ? `<div class="empty">Se muestran los ${SERVER_ROW_LIMIT} más recientes. Acota las fechas para ver más.</div>`
    : '';
  return `
    <table class="t">
      <thead><tr>
        <th>Fecha</th><th>Tipo</th><th>Categoría</th><th class="r">Importe</th><th class="r">Beneficio</th>
        <th>Pago</th><th>Usuario</th><th></th>
      </tr></thead>
      <tbody>${movements.map(movementRow).join('')}</tbody>
    </table>${limitNote}`;
}

function summaryHtml(movements) {
  const sales = movements.filter(movement => movement.type === 'sale');
  const expenses = movements.filter(movement => movement.type === 'expense');
  const sum = (list, field) => list.reduce((total, movement) => total + movement[field], 0);
  const card = (label, value) => `
    <div class="kpi"><div class="label">${label}</div><div class="value" style="font-size:20px">${money(value)}</div></div>`;
  return card(`Ventas (${sales.length})`, sum(sales, 'amount'))
    + card('Beneficio', sum(sales, 'profit'))
    + card(`Gastos (${expenses.length})`, sum(expenses, 'amount'));
}

export async function movementsView(root, params) {
  const todayDate = today();
  // The dashboard links here with these (Spanish) query parameters.
  const filters = {
    from: params.get('desde') || `${todayDate.slice(0, 8)}01`,
    to: params.get('hasta') || todayDate,
    type: params.get('tipo') || '',
    category_id: params.get('cat') || '',
    user_id: params.get('usuario') || '',
    q: params.get('q') || '',
    deleted: params.get('borrados') === '1',
  };
  const users = await api('/admin/users');
  const categoriesOf = (kind) => state.categories.filter(category => category.kind === kind);
  let movements = [];

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Movimientos</h1><div class="sub">Todas las ventas y gastos, con su historial</div></div>
      <span class="spacer"></span>
      <a class="btn" data-export>${icon('download')} Exportar CSV (Excel)</a>
    </div>
    <div class="card card-pad" style="margin-bottom:14px">
      <form class="filters" style="margin:0" data-filters>
        <label class="field">Desde<input type="date" name="from" value="${filters.from}"></label>
        <label class="field">Hasta<input type="date" name="to" value="${filters.to}"></label>
        <label class="field">Tipo
          <select name="type">
            <option value="">Todo</option><option value="sale">Ventas</option><option value="expense">Gastos</option>
          </select>
        </label>
        <label class="field">Categoría
          <select name="category_id">
            <option value="">Todas</option>
            <optgroup label="Ventas">${options(categoriesOf('sale'))}</optgroup>
            <optgroup label="Gastos">${options(categoriesOf('expense'))}</optgroup>
          </select>
        </label>
        <label class="field">Usuario
          <select name="user_id"><option value="">Todos</option>${options(users)}</select>
        </label>
        <label class="field" style="flex:1;min-width:180px">Buscar en descripción
          <input type="search" name="q" value="${esc(filters.q)}" placeholder="IMEI, modelo…">
        </label>
        <label class="check" style="padding-bottom:10px">
          <input type="checkbox" name="deleted" ${filters.deleted ? 'checked' : ''}><span>Ver borrados</span>
        </label>
      </form>
    </div>
    <div class="kpis" data-summary></div>
    <div class="card"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>`;

  const form = root.querySelector('[data-filters]');
  form.elements.type.value = filters.type;
  form.elements.category_id.value = filters.category_id;
  form.elements.user_id.value = filters.user_id;

  function readFilters() {
    filters.from = form.elements.from.value || filters.from;
    filters.to = form.elements.to.value || filters.to;
    filters.type = form.elements.type.value;
    filters.category_id = form.elements.category_id.value;
    filters.user_id = form.elements.user_id.value;
    filters.q = form.elements.q.value.trim();
    filters.deleted = form.elements.deleted.checked;
  }

  function queryString() {
    const query = new URLSearchParams({ from: filters.from, to: filters.to });
    for (const name of ['type', 'category_id', 'user_id', 'q']) {
      if (filters[name]) query.set(name, filters[name]);
    }
    if (filters.deleted) query.set('deleted', '1');
    return query.toString();
  }

  async function load() {
    root.querySelector('[data-export]').href = `/api/admin/export.csv?from=${filters.from}&to=${filters.to}`;
    const loaded = await tryApi(`/admin/movements?${queryString()}`);
    if (!loaded) return;
    movements = loaded;
    root.querySelector('[data-summary]').innerHTML = summaryHtml(movements);
    root.querySelector('[data-list]').innerHTML = movementsTable(movements);
  }

  function applyFilters() {
    readFilters();
    load();
  }

  function editMovement(id) {
    const movement = movements.find(candidate => candidate.id === id);
    const dialog = modal({ title: 'Editar movimiento', body: '<div data-slot></div>', wide: true });
    mountMovementForm(dialog.el.querySelector('[data-slot]'), {
      type: movement.type, movement,
      allowDate: true,
      modalMode: true,
      onSaved: () => { dialog.close(); load(); },
    });
  }

  async function deleteMovement(id) {
    const confirmed = await confirmDialog('¿Borrar este movimiento? Podrás recuperarlo desde "Ver borrados".', { okText: 'Borrar', danger: true });
    if (!confirmed) return;
    if (await tryApi(`/movements/${id}`, { method: 'DELETE' })) toast('Borrado');
    load();
  }

  async function restoreMovement(id) {
    if (await tryApi(`/admin/movements/${id}/restore`, { method: 'POST' })) toast('Recuperado', 'ok');
    load();
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', applyFilters);
  form.elements.q.addEventListener('input', debounce(applyFilters, 350));
  on(root, 'click', '[data-edit]', (button) => editMovement(Number(button.dataset.edit)));
  on(root, 'click', '[data-delete]', (button) => deleteMovement(Number(button.dataset.delete)));
  on(root, 'click', '[data-restore]', (button) => restoreMovement(Number(button.dataset.restore)));

  await load();
}
