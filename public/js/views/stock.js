// Phone stock: add each phone with its cost, sell it with one click and let the app work out the profit.
import {
  state, esc, icon, money, fmtDate, today, toast, isAdmin, parseMoney, moneyInput, confirmDialog, modal, debounce, on, tryApi,
} from '../core.js';

const CONDITIONS = { new: 'Nuevo', used: 'Segunda mano' };
// Warranty proposed on the ticket for each condition; names must match Settings → Tickets y facturas.
const WARRANTY_BY_CONDITION = { new: 'Producto nuevo', used: 'Segunda mano / reacondicionado' };

const deviceName = (device) => [device.brand, device.model].filter(Boolean).join(' ');

function ticketUrl(device, movementId, price) {
  const query = new URLSearchParams({
    venta: movementId,
    desc: `Movil ${deviceName(device)}`,
    precio: price,
    garantia: WARRANTY_BY_CONDITION[device.condition],
  });
  if (device.imei) query.set('detalle', `IMEI ${device.imei}`);
  return `#/tickets/nueva?${query}`;
}

function devicesTable(devices, showSold) {
  if (!devices.length) {
    return `<div class="empty">${showSold ? 'Todavía no se ha vendido ningún móvil del stock' : 'No hay móviles en stock'}</div>`;
  }
  const showCost = devices.some(device => device.cost !== undefined);
  const actions = (device) => (showSold ? '' : `
    <div class="row-actions">
      <button class="btn btn-primary btn-sm" data-sell="${device.id}">Vender</button>
      ${isAdmin() ? `
        <button class="btn btn-ghost btn-icon" data-edit="${device.id}" title="Editar">${icon('edit')}</button>
        <button class="btn btn-ghost btn-icon btn-danger" data-delete="${device.id}" title="Borrar">${icon('trash')}</button>` : ''}
    </div>`);
  const row = (device) => `
    <tr>
      <td><b>${esc(deviceName(device))}</b>${device.notes ? `<div class="desc">${esc(device.notes)}</div>` : ''}</td>
      <td class="muted">${esc(device.imei || '—')}</td>
      <td>${CONDITIONS[device.condition]}</td>
      ${showCost ? `<td class="r num">${money(device.cost)}</td>` : ''}
      <td class="r num">${device.price == null ? '—' : money(device.price)}</td>
      <td class="num muted">${fmtDate(showSold ? device.sold_on : device.purchased_on)}</td>
      <td>${actions(device)}</td>
    </tr>`;
  return `
    <table class="t">
      <thead><tr>
        <th>Móvil</th><th>IMEI</th><th>Estado</th>${showCost ? '<th class="r">Coste</th>' : ''}
        <th class="r">Precio previsto</th><th>${showSold ? 'Vendido' : 'Comprado'}</th><th></th>
      </tr></thead>
      <tbody>${devices.map(row).join('')}</tbody>
    </table>`;
}

function summaryHtml(devices) {
  if (!devices.length || devices[0].cost === undefined) return '';
  const invested = devices.reduce((sum, device) => sum + device.cost, 0);
  return `<div class="muted" style="margin-bottom:10px">${devices.length} móvil(es) en stock · ${money(invested)} invertidos</div>`;
}

export async function stockView(root) {
  let showSold = false;
  let devices = [];

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Stock de móviles</h1><div class="sub">Al vender un móvil, el beneficio y el IMEI se rellenan solos</div></div>
      <span class="spacer"></span>
      ${isAdmin() ? `<button class="btn btn-primary" data-add>${icon('plus')} Añadir móvil</button>` : ''}
    </div>
    <div class="card card-pad" style="margin-bottom:14px">
      <div class="row" style="gap:10px">
        <div class="seg">
          <button data-show="stock">En stock</button>
          <button data-show="sold">Vendidos</button>
        </div>
        <input type="search" data-search placeholder="Buscar por marca, modelo o IMEI…" style="flex:1;min-width:200px">
      </div>
    </div>
    <div data-summary></div>
    <div class="card"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>`;

  const search = root.querySelector('[data-search]');
  const findDevice = (id) => devices.find(device => device.id === Number(id));

  async function load() {
    root.querySelector('[data-show="stock"]').classList.toggle('on', !showSold);
    root.querySelector('[data-show="sold"]').classList.toggle('on', showSold);
    const query = new URLSearchParams();
    if (showSold) query.set('sold', '1');
    if (search.value.trim()) query.set('q', search.value.trim());
    const loaded = await tryApi(`/stock?${query}`);
    if (!loaded) return;
    devices = loaded;
    root.querySelector('[data-summary]').innerHTML = showSold ? '' : summaryHtml(devices);
    root.querySelector('[data-list]').innerHTML = devicesTable(devices, showSold);
  }

  // `device` is null when adding.
  function openDeviceDialog(device) {
    const value = (field) => esc(device?.[field] ?? '');
    const amount = (field) => (device?.[field] == null ? '' : moneyInput(device[field]));
    modal({
      title: device ? `Editar ${deviceName(device)}` : 'Añadir móvil al stock',
      body: `
        <form data-device-form class="settings-grid">
          <label class="field">Marca<input type="text" name="brand" value="${value('brand')}"></label>
          <label class="field">Modelo<input type="text" name="model" value="${value('model')}" placeholder="ej. Galaxy A16 128 GB"></label>
          <label class="field">IMEI<input type="text" name="imei" value="${value('imei')}" inputmode="numeric"></label>
          <label class="field">Estado
            <select name="condition">
              ${Object.entries(CONDITIONS).map(([key, label]) => `<option value="${key}" ${device?.condition === key ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label class="field">Coste (€) <span class="hint">lo que te costó a ti</span>
            <input class="money" name="cost" inputmode="decimal" placeholder="0,00" value="${amount('cost')}">
          </label>
          <label class="field">Precio previsto (€) <span class="hint">opcional</span>
            <input class="money" name="price" inputmode="decimal" placeholder="0,00" value="${amount('price')}">
          </label>
          <label class="field">Fecha de compra<input type="date" name="purchased_on" value="${value('purchased_on') || today()}"></label>
          <label class="field">Notas <span class="hint">color, proveedor, desperfectos…</span><input type="text" name="notes" value="${value('notes')}"></label>
        </form>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>`,
      wide: true,
      onMount: (dialog, close) => {
        dialog.querySelector('[data-ok]').onclick = async () => {
          const fields = dialog.querySelector('[data-device-form]').elements;
          const cost = parseMoney(fields.cost.value);
          const price = parseMoney(fields.price.value);
          const body = {
            brand: fields.brand.value, model: fields.model.value, imei: fields.imei.value,
            condition: fields.condition.value, notes: fields.notes.value, purchased_on: fields.purchased_on.value,
            cost: Number.isFinite(cost) ? cost : null,
            price: Number.isFinite(price) ? price : null,
          };
          const saved = device
            ? await tryApi(`/admin/stock/${device.id}`, { method: 'PUT', body })
            : await tryApi('/admin/stock', { method: 'POST', body });
          if (!saved) return;
          toast('Móvil guardado', 'ok');
          close();
          load();
        };
      },
    });
  }

  function openSellDialog(device) {
    const { sales, modules } = state.settings;
    const saleCategories = state.categories.filter(category => category.kind === 'sale' && category.active);
    const phoneCategory = saleCategories.find(category => category.name.toLowerCase().startsWith('movil'));
    const asksPaymentMethod = modules.payment_methods && sales.ask_payment_method;
    const canMakeTicket = modules.invoices;
    const showsProfit = device.cost !== undefined;

    modal({
      title: `Vender ${deviceName(device)}`,
      body: `
        <form data-sell-form class="settings-grid">
          <label class="field">Precio de venta (€)
            <input class="money" name="price" inputmode="decimal" placeholder="0,00" value="${device.price == null ? '' : moneyInput(device.price)}">
          </label>
          <div class="field">${showsProfit ? `Beneficio<div style="font-size:22px;font-weight:700" class="num" data-profit></div>` : ''}</div>
          <label class="field">Producto
            <select name="category">
              ${saleCategories.map(category => `<option value="${category.id}" ${category === phoneCategory ? 'selected' : ''}>${esc(category.name)}</option>`).join('')}
            </select>
          </label>
          ${asksPaymentMethod ? `
            <label class="field">Forma de pago
              <select name="payment">${sales.payment_methods.map(method => `<option>${esc(method)}</option>`).join('')}</select>
            </label>` : ''}
        </form>`,
      foot: `
        <button class="btn" data-close>Cancelar</button>
        <button class="btn" data-sell-only>Vender</button>
        ${canMakeTicket ? `<button class="btn btn-primary" data-sell-and-ticket>${icon('receipt')} Vender y hacer ticket</button>` : ''}`,
      onMount: (dialog, close) => {
        const fields = dialog.querySelector('[data-sell-form]').elements;
        const renderProfit = () => {
          if (!showsProfit) return;
          const price = parseMoney(fields.price.value);
          const profit = Number.isFinite(price) ? price - device.cost : NaN;
          const label = dialog.querySelector('[data-profit]');
          label.textContent = Number.isFinite(profit) ? money(profit) : '—';
          label.classList.toggle('neg', profit < 0);
        };

        async function sell({ makeTicket }) {
          const price = parseMoney(fields.price.value);
          if (!Number.isFinite(price) || price <= 0) return toast('Indica el precio de venta', 'err');
          const sold = await tryApi(`/stock/${device.id}/sell`, {
            method: 'POST',
            body: { price, category_id: Number(fields.category.value), payment_method: fields.payment ? fields.payment.value : '' },
          });
          if (!sold) return;
          toast(`Vendido: ${deviceName(device)} ${money(price)}`, 'ok');
          close();
          if (makeTicket) location.hash = ticketUrl(device, sold.movement_id, price);
          else load();
        }

        fields.price.addEventListener('input', renderProfit);
        dialog.querySelector('[data-sell-only]').onclick = () => sell({ makeTicket: false });
        const ticketButton = dialog.querySelector('[data-sell-and-ticket]');
        if (ticketButton) ticketButton.onclick = () => sell({ makeTicket: true });
        renderProfit();
      },
    });
  }

  async function deleteDevice(device) {
    const confirmed = await confirmDialog(`¿Borrar "${deviceName(device)}" del stock? Úsalo solo si lo añadiste por error.`, { okText: 'Borrar', danger: true });
    if (!confirmed) return;
    if (await tryApi(`/admin/stock/${device.id}`, { method: 'DELETE' })) toast('Borrado');
    load();
  }

  on(root, 'click', '[data-show]', (button) => {
    showSold = button.dataset.show === 'sold';
    load();
  });
  on(root, 'click', '[data-add]', () => openDeviceDialog(null));
  on(root, 'click', '[data-edit]', (button) => openDeviceDialog(findDevice(button.dataset.edit)));
  on(root, 'click', '[data-sell]', (button) => openSellDialog(findDevice(button.dataset.sell)));
  on(root, 'click', '[data-delete]', (button) => deleteDevice(findDevice(button.dataset.delete)));
  search.addEventListener('input', debounce(load, 300));

  await load();
}
