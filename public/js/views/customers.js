// Customers: the list, and each customer's details with everything they have bought and had repaired.
import { api, state, esc, icon, money, fmtDate, toast, isAdmin, can, confirmDialog, debounce, on, reloadView, tryApi } from '../core.js';

const SECTION = '#/clientes';
const REPAIR_STAGES = { pending: 'En reparación', ready: 'Lista para recoger', collected: 'Recogida' };
const FIELDS = [
  ['name', 'Nombre y apellidos / Empresa'], ['phone', 'Teléfono'], ['nif', 'NIF / NIE / CIF'],
  ['address', 'Dirección (calle, número, piso)'], ['postcode', 'Código postal'], ['city', 'Población'], ['province', 'Provincia'],
];

export function customersView(root, params, sub) {
  if (sub === 'nuevo') return renderDetail(root, null);
  if (sub) return renderDetail(root, Number(sub));
  return renderList(root, params);
}

// ---- List
function customersTable(customers) {
  if (!customers.length) return '<div class="empty">No hay clientes que coincidan</div>';
  const row = (customer) => `
    <tr class="clickable" data-id="${customer.id}">
      <td><b>${esc(customer.name || '—')}</b></td>
      <td class="num">${esc(customer.phone)}</td>
      <td class="num">${esc(customer.nif)}</td>
      <td class="muted">${esc([customer.city, customer.province].filter(Boolean).join(', '))}</td>
    </tr>`;
  return `
    <table class="t">
      <thead><tr><th>Nombre</th><th>Teléfono</th><th>NIF</th><th>Población</th></tr></thead>
      <tbody>${customers.map(row).join('')}</tbody>
    </table>`;
}

async function renderList(root, params) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Clientes</h1><div class="sub">Se guardan solos al hacer una factura o una reparación con NIF o teléfono</div></div>
      <span class="spacer"></span>
      <a class="btn btn-primary" href="${SECTION}/nuevo">${icon('plus')} Nuevo cliente</a>
    </div>
    <div class="card card-pad" style="margin-bottom:14px">
      <input type="search" data-search placeholder="Buscar por nombre, teléfono o NIF…" value="${esc(params.get('q') || '')}">
    </div>
    <div class="card"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>`;

  const search = root.querySelector('[data-search]');
  async function load() {
    const customers = await tryApi(`/customers?q=${encodeURIComponent(search.value.trim())}`);
    if (customers) root.querySelector('[data-list]').innerHTML = customersTable(customers);
  }
  search.addEventListener('input', debounce(load, 300));
  on(root, 'click', '[data-id]', (row) => { location.hash = `${SECTION}/${row.dataset.id}`; });
  await load();
}

// ---- Detail (also the form for a new customer)
function historyCard(title, iconName, rows, emptyText) {
  return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><h3>${icon(iconName)} ${title}</h3><span class="count">(${rows.length})</span></div>
      ${rows.length ? `<div class="table-wrap"><table class="t"><tbody>${rows.join('')}</tbody></table></div>` : `<div class="empty">${emptyText}</div>`}
    </div>`;
}

function invoiceRow(invoice) {
  const section = invoice.kind === 'ticket' ? 'tickets' : 'facturas';
  const label = invoice.is_refund ? 'Devolución' : invoice.kind === 'ticket' ? 'Ticket' : 'Factura';
  return `
    <tr class="clickable ${invoice.voided ? 'deleted' : ''}" data-url="#/${section}/${invoice.id}">
      <td style="white-space:nowrap"><b>${label} ${esc(invoice.number)}</b></td>
      <td class="num muted">${fmtDate(invoice.date)}</td>
      <td class="desc">${esc(invoice.title)}</td>
      <td class="r num">${money(invoice.total)}</td>
    </tr>`;
}

function repairRow(repair) {
  return `
    <tr class="clickable ${repair.voided ? 'deleted' : ''}" data-url="#/reparaciones/${repair.id}">
      <td style="white-space:nowrap"><b>Reparación ${esc(repair.number)}</b></td>
      <td class="num muted">${fmtDate(repair.date)}</td>
      <td class="desc">${esc(repair.title)} · ${repair.voided ? 'Anulada' : REPAIR_STAGES[repair.stage]}</td>
      <td class="r num">${repair.amount == null ? '' : money(repair.amount)}</td>
    </tr>`;
}

async function renderDetail(root, id) {
  const customer = id ? await tryApi(`/customers/${id}`) : { invoices: [], repairs: [], notes: '' };
  if (!customer) return;
  const { modules } = state.settings;
  const spent = customer.invoices.filter(invoice => !invoice.voided).reduce((sum, invoice) => sum + invoice.total, 0);
  const field = ([name, label]) => `
    <label class="field">${label}<input type="text" name="${name}" value="${esc(customer[name] || '')}"></label>`;

  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="${SECTION}" title="Volver">${icon('left')}</a>
      <div>
        <h1>${id ? esc(customer.name || customer.phone) : 'Nuevo cliente'}</h1>
        ${id ? `<div class="sub">${customer.invoices.length} documento(s) · ${money(spent)} · ${customer.repairs.length} reparación(es)</div>` : ''}
      </div>
      <span class="spacer"></span>
      ${id && modules.invoices && can('worker_create_invoices') ? `
        <a class="btn" href="#/tickets/nueva?cliente=${id}">${icon('receipt')} Hacer ticket</a>
        <a class="btn" href="#/facturas/nueva?cliente=${id}">${icon('invoice')} Hacer factura</a>` : ''}
      ${id && modules.repairs && can('worker_create_repairs') ? `<a class="btn" href="#/reparaciones/nueva?cliente=${id}">${icon('wrench')} Nueva reparación</a>` : ''}
      ${id && isAdmin() ? '<button class="btn btn-danger" data-delete>Borrar</button>' : ''}
    </div>
    <form class="card card-pad" data-form autocomplete="off" style="margin-bottom:14px">
      <div class="settings-grid">
        ${FIELDS.map(field).join('')}
        <label class="field wide">Notas <span class="hint">solo las ve la tienda</span>
          <input type="text" name="notes" maxlength="500" value="${esc(customer.notes || '')}">
        </label>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn btn-primary" type="submit">${id ? 'Guardar cambios' : 'Guardar cliente'}</button></div>
    </form>
    ${id ? historyCard('Tickets y facturas', 'receipt', customer.invoices.map(invoiceRow), 'Todavía no tiene documentos')
      + historyCard('Reparaciones', 'wrench', customer.repairs.map(repairRow), 'Todavía no tiene reparaciones') : ''}`;

  const form = root.querySelector('[data-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      if (id) {
        await api(`/customers/${id}`, { method: 'PUT', body });
        toast('Cliente guardado', 'ok');
        reloadView();
      } else {
        const created = await api('/customers', { method: 'POST', body });
        toast('Cliente guardado', 'ok');
        location.hash = `${SECTION}/${created.id}`;
      }
    } catch (error) {
      toast(error.message, 'err');
    }
  });
  on(root, 'click', '[data-url]', (row) => { location.hash = row.dataset.url; });
  on(root, 'click', '[data-delete]', async () => {
    const confirmed = await confirmDialog('¿Borrar la ficha de este cliente? Sus tickets, facturas y reparaciones no se borran.', { okText: 'Borrar', danger: true });
    if (!confirmed || !(await tryApi(`/customers/${id}`, { method: 'DELETE' }))) return;
    toast('Cliente borrado');
    location.hash = SECTION;
  });
}
