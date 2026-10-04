// Full list of movements (admin only): filter, fix, delete, restore and export.
import { api, state, esc, icon, money, chip, fmtDate, fmtTime, today, toast, confirmDialog, modal, debounce } from '../core.js';
import { mountMovementForm } from '../movement-form.js';

export async function movementsView(root, params) {
  const t = today();
  const f = {
    from: params.get('desde') || t.slice(0, 8) + '01', to: params.get('hasta') || t,
    type: params.get('tipo') || '', category_id: params.get('cat') || '', user_id: params.get('usuario') || '',
    q: params.get('q') || '', deleted: params.get('borrados') === '1',
  };
  const users = await api('/admin/users');

  root.innerHTML = `
    <div class="page-head"><div><h1>Movimientos</h1><div class="sub">Todas las ventas y gastos, con su historial</div></div>
      <span class="spacer"></span>
      <a class="btn" data-export>${icon('download')} Exportar CSV (Excel)</a>
    </div>
    <div class="card card-pad" style="margin-bottom:14px">
      <div class="filters" style="margin:0">
        <label class="field">Desde<input type="date" name="from" value="${f.from}"></label>
        <label class="field">Hasta<input type="date" name="to" value="${f.to}"></label>
        <label class="field">Tipo<select name="type"><option value="">Todo</option><option value="sale">Ventas</option><option value="expense">Gastos</option></select></label>
        <label class="field">Categoría<select name="category_id"><option value="">Todas</option>
          <optgroup label="Ventas">${state.categories.filter(c => c.kind === 'sale').map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</optgroup>
          <optgroup label="Gastos">${state.categories.filter(c => c.kind === 'expense').map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</optgroup>
        </select></label>
        <label class="field">Usuario<select name="user_id"><option value="">Todos</option>${users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1;min-width:180px">Buscar en descripción<input type="search" name="q" value="${esc(f.q)}" placeholder="IMEI, modelo…"></label>
        <label class="check" style="padding-bottom:10px"><input type="checkbox" name="deleted" ${f.deleted ? 'checked' : ''}><span>Ver borrados</span></label>
      </div>
    </div>
    <div class="kpis" data-sum></div>
    <div class="card"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>`;

  const $ = (s) => root.querySelector(s);
  const filt = root.querySelector('.filters');
  filt.querySelector('[name=type]').value = f.type;
  filt.querySelector('[name=category_id]').value = f.category_id;
  filt.querySelector('[name=user_id]').value = f.user_id;

  let rows = [];
  function qs() {
    const q = new URLSearchParams({ from: f.from, to: f.to });
    if (f.type) q.set('type', f.type); if (f.category_id) q.set('category_id', f.category_id);
    if (f.user_id) q.set('user_id', f.user_id); if (f.q) q.set('q', f.q); if (f.deleted) q.set('deleted', '1');
    return q.toString();
  }
  async function load() {
    $('[data-export]').href = `/api/admin/export.csv?from=${f.from}&to=${f.to}`;
    try { rows = await api('/admin/movements?' + qs()); } catch (e) { toast(e.message, 'err'); return; }
    const sales = rows.filter(r => r.type === 'sale'), exps = rows.filter(r => r.type === 'expense');
    const sum = (a, k) => a.reduce((x, r) => x + r[k], 0);
    $('[data-sum]').innerHTML = `
      <div class="kpi"><div class="label">Ventas (${sales.length})</div><div class="value" style="font-size:20px">${money(sum(sales, 'amount'))}</div></div>
      <div class="kpi"><div class="label">Beneficio</div><div class="value" style="font-size:20px">${money(sum(sales, 'profit'))}</div></div>
      <div class="kpi"><div class="label">Gastos (${exps.length})</div><div class="value" style="font-size:20px">${money(sum(exps, 'amount'))}</div></div>`;
    $('[data-list]').innerHTML = rows.length ? `<table class="t"><thead><tr>
        <th>Fecha</th><th>Tipo</th><th>Categoría</th><th class="r">Importe</th><th class="r">Beneficio</th><th>Pago</th><th>Usuario</th><th></th>
      </tr></thead><tbody>${rows.map(r => `
        <tr class="${r.deleted_at ? 'deleted' : ''}">
          <td class="num">${fmtDate(r.date)} <span class="faint">${fmtTime(r.created_at)}</span></td>
          <td>${r.type === 'sale' ? '<span style="color:var(--sale);font-weight:600">Venta</span>' : `<span style="color:var(--expense);font-weight:600">Gasto</span>${r.expense_type === 'stock' ? ' <span class="faint">· mercancía</span>' : ''}`}</td>
          <td>${chip(r.category, r.color)}${r.description ? `<div class="desc" title="${esc(r.description)}">${esc(r.description)}</div>` : ''}</td>
          <td class="r num"><b>${money(r.amount)}</b></td>
          <td class="r num">${r.type === 'sale' ? money(r.profit) : ''}</td>
          <td class="muted">${esc(r.payment_method || '')}</td>
          <td class="muted">${esc(r.user || '')}${r.deleted_at ? `<div class="faint" style="font-size:12px;text-decoration:none">borrado por ${esc(r.deleted_by || '?')} · ${esc(r.deleted_at.slice(0, 16))}</div>` : ''}</td>
          <td><div class="row-actions">
            ${r.invoice_id ? `<a class="btn btn-ghost btn-icon" href="#/facturas/${r.invoice_id}" title="Ver factura">${icon('invoice')}</a>` : ''}
            ${r.deleted_at ? `<button class="btn btn-ghost btn-sm" data-restore="${r.id}">${icon('undo')} Recuperar</button>` : `
              <button class="btn btn-ghost btn-icon" data-edit="${r.id}" title="Editar">${icon('edit')}</button>
              <button class="btn btn-ghost btn-icon btn-danger" data-del="${r.id}" title="Borrar">${icon('trash')}</button>`}
          </div></td>
        </tr>`).join('')}</tbody></table>
        ${rows.length >= 2000 ? '<div class="empty">Se muestran los 2000 más recientes. Acota las fechas para ver más.</div>' : ''}`
      : '<div class="empty">No hay movimientos con estos filtros</div>';
  }

  const onFilter = () => {
    f.from = filt.querySelector('[name=from]').value || f.from; f.to = filt.querySelector('[name=to]').value || f.to;
    f.type = filt.querySelector('[name=type]').value; f.category_id = filt.querySelector('[name=category_id]').value;
    f.user_id = filt.querySelector('[name=user_id]').value; f.q = filt.querySelector('[name=q]').value.trim();
    f.deleted = filt.querySelector('[name=deleted]').checked;
    load();
  };
  filt.addEventListener('change', onFilter);
  filt.querySelector('[name=q]').addEventListener('input', debounce(onFilter, 350));

  root.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]'), res = e.target.closest('[data-restore]');
    if (ed) {
      const mv = rows.find(r => r.id === Number(ed.dataset.edit));
      const m = modal({ title: 'Editar movimiento', body: '<div data-slot></div>', wide: true });
      mountMovementForm(m.el.querySelector('[data-slot]'), { type: mv.type, movement: mv, allowDate: true, modalMode: true, onSaved: () => { m.close(); load(); } });
    }
    if (del) {
      if (!(await confirmDialog('¿Borrar este movimiento? Podrás recuperarlo desde "Ver borrados".', { okText: 'Borrar', danger: true }))) return;
      try { await api(`/movements/${del.dataset.del}`, { method: 'DELETE' }); toast('Borrado'); load(); } catch (err) { toast(err.message, 'err'); }
    }
    if (res) {
      try { await api(`/admin/movements/${res.dataset.restore}/restore`, { method: 'POST' }); toast('Recuperado', 'ok'); load(); } catch (err) { toast(err.message, 'err'); }
    }
  });

  await load();
}
