// Tickets (simplified invoices) and full invoices: two sections, each with its own number series.
import {
  api, state, esc, icon, money, fmtDate, today, toast, isAdmin, parseMoney, moneyInput,
  confirmDialog, modal, can, debounce, on, redrawOnResize, reloadView, tryApi,
} from '../core.js';
import { attachCustomerPicker } from '../customer-picker.js';
import { invoiceA4, ticket80, printDocument } from '../invoice.js';

// `kind` is the value stored in the database; `section` is the URL segment.
const KINDS = {
  ticket: { section: 'tickets', singular: 'Ticket', plural: 'Tickets', createLabel: 'Nuevo ticket' },
  factura: { section: 'facturas', singular: 'Factura', plural: 'Facturas', createLabel: 'Nueva factura' },
};

// Legal limits (VAT included) for a simplified invoice in Spain: general and retail.
const SIMPLIFIED_LIMIT = 400;
const SIMPLIFIED_RETAIL_LIMIT = 3000;

export const ticketsView = (root, params, sub) => documentsView(root, params, sub, 'ticket');
export const invoicesView = (root, params, sub) => documentsView(root, params, sub, 'factura');

function documentsView(root, params, sub, kind) {
  if (sub === 'nueva') return renderEditor(root, params, kind);
  if (sub) return renderDetail(root, Number(sub));
  return renderList(root, params, kind);
}

const invoiceConfig = () => state.settings.invoice;
const fileNameFor = (invoice) => `${KINDS[invoice.kind].singular}-${invoice.number}`;
const documentHtml = (invoice, format) => (format === 'ticket' ? ticket80(invoice, state.settings) : invoiceA4(invoice, state.settings));

// Tickets print on the thermal printer unless settings say A4; invoices are always A4.
function defaultFormat(kind) {
  return kind === 'ticket' && invoiceConfig().ticket_format !== 'a4' ? 'ticket' : 'a4';
}

function nextNumber(kind) {
  const config = invoiceConfig();
  return kind === 'ticket'
    ? `${config.ticket_prefix || ''}${config.ticket_next_number}`
    : `${config.prefix || ''}${config.next_number}`;
}

function missingShopDataNotice() {
  const { shop } = state.settings;
  const missing = [!shop.legal_name && 'nombre y apellidos del titular', !shop.nif && 'NIF'].filter(Boolean);
  if (!missing.length) return '';
  const advice = isAdmin() ? '<a href="#/ajustes?tab=tienda">Rellénalos en Ajustes → Tienda</a>.' : 'Avisa al administrador.';
  return `
    <div class="notice warn" style="margin-bottom:14px">
      ${icon('warn')} Faltan tus datos fiscales (${missing.join(' y ')}): no aparecerán en el PDF. ${advice}
    </div>`;
}

// ---- List
function statusText(invoice) {
  if (invoice.voided) return '<span class="neg">Anulado</span>';
  if (invoice.rectifies_number) return `Devolución de ${esc(invoice.rectifies_number)}`;
  if (invoice.replaced_by_number) return `Convertido en factura ${esc(invoice.replaced_by_number)}`;
  if (invoice.replaces_number) return `Sustituye al ticket ${esc(invoice.replaces_number)}`;
  return '';
}

function invoicesTable(invoices, kind) {
  if (!invoices.length) return `<div class="empty">Todavía no hay ${KINDS[kind].plural.toLowerCase()}</div>`;
  const showCustomer = kind === 'factura';
  const row = (invoice) => `
    <tr class="clickable ${invoice.voided ? 'deleted' : ''}" data-id="${invoice.id}">
      <td><b>${esc(invoice.number)}</b></td>
      <td class="num">${fmtDate(invoice.date)}</td>
      ${showCustomer ? `<td>${esc(invoice.customer_name || '—')}</td>` : ''}
      <td class="desc">${esc(invoice.items.map(item => item.description).join(', '))}</td>
      <td class="r num"><b>${money(invoice.total)}</b></td>
      <td class="muted">${esc(invoice.user_name || '')}</td>
      <td class="muted" style="text-decoration:none">${statusText(invoice)}</td>
    </tr>`;
  return `
    <table class="t">
      <thead><tr>
        <th>N.º</th><th>Fecha</th>${showCustomer ? '<th>Cliente</th>' : ''}<th>Concepto</th>
        <th class="r">Total</th><th>Emitido por</th><th>Estado</th>
      </tr></thead>
      <tbody>${invoices.map(row).join('')}</tbody>
    </table>`;
}

async function renderList(root, params, kind) {
  const labels = KINDS[kind];
  const config = invoiceConfig();
  const subtitle = kind === 'ticket'
    ? `Facturas simplificadas para el cliente de mostrador · serie ${esc(config.ticket_prefix || '(sin prefijo)')}`
    : `Facturas completas con datos del cliente · serie ${esc(config.prefix || '(sin prefijo)')}`;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>${labels.plural}</h1><div class="sub">${subtitle}</div></div>
      <span class="spacer"></span>
      <a class="btn btn-primary" href="#/${labels.section}/nueva">${icon('plus')} ${labels.createLabel}</a>
    </div>
    ${missingShopDataNotice()}
    <div class="card card-pad" style="margin-bottom:14px">
      <input type="search" data-search placeholder="Buscar por número, cliente, producto o IMEI…" value="${esc(params.get('q') || '')}">
    </div>
    <div class="card"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>`;

  const search = root.querySelector('[data-search]');
  async function load() {
    const query = search.value.trim();
    const invoices = await tryApi(`/invoices?kind=${kind}${query ? `&q=${encodeURIComponent(query)}` : ''}`);
    if (invoices) root.querySelector('[data-list]').innerHTML = invoicesTable(invoices, kind);
  }

  search.addEventListener('input', debounce(load, 300));
  on(root, 'click', '[data-id]', (row) => { location.hash = `#/${labels.section}/${row.dataset.id}`; });
  await load();
}

// ---- Detail
async function renderDetail(root, id) {
  let invoice;
  try {
    invoice = await api(`/invoices/${id}`);
  } catch (error) {
    root.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    return;
  }
  const labels = KINDS[invoice.kind];
  const isTicket = invoice.kind === 'ticket';
  const canConvert = isTicket && !invoice.voided && !invoice.rectifies_id && !invoice.replaced_by_id && state.settings.modules.invoices;
  const unitsLeft = invoice.items.reduce((sum, item, index) => sum + item.qty - (invoice.refunded_qty[index] || 0), 0);
  const canRefund = can('worker_refund') && !invoice.voided && !invoice.rectifies_id && !invoice.replaced_by_id && unitsLeft > 0;
  let format = defaultFormat(invoice.kind);

  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="#/${labels.section}" title="Volver">${icon('left')}</a>
      <div>
        <h1>${invoice.rectifies_id ? 'Devolución' : labels.singular} ${esc(invoice.number)}</h1>
        <div class="sub">
          ${fmtDate(invoice.date)} · ${money(invoice.total)} · emitido por ${esc(invoice.user_name || '')}
          ${invoice.voided ? ' · <b class="neg">ANULADO</b>' : ''}
        </div>
      </div>
      <span class="spacer"></span>
      <div class="seg" data-formats>
        <button data-format="a4">A4</button>
        <button data-format="ticket">Ticket térmico</button>
      </div>
      <button class="btn btn-primary" data-print>${icon('print')} Imprimir / Guardar PDF</button>
      ${canConvert ? `
        <a class="btn" href="#/facturas/nueva?desde_ticket=${invoice.id}" title="El cliente pide factura con sus datos">
          ${icon('swap')} Convertir en factura
        </a>` : ''}
      ${canRefund ? `<button class="btn" data-refund>${icon('undo')} Devolución</button>` : ''}
      ${isAdmin() && !invoice.voided ? '<button class="btn btn-danger" data-void>Anular</button>' : ''}
    </div>
    ${invoice.rectifies_id ? `
      <div class="notice" style="margin-bottom:14px">
        Devolución de <a href="#/${KINDS[invoice.rectifies_kind].section}/${invoice.rectifies_id}">${KINDS[invoice.rectifies_kind].singular.toLowerCase()} ${esc(invoice.rectifies_number)}</a>.
      </div>` : ''}
    ${invoice.refunds.length ? `
      <div class="notice warn" style="margin-bottom:14px">
        ${icon('undo')} Tiene devoluciones: ${invoice.refunds.map(refund =>
          `<a href="#/${labels.section}/${refund.id}">${esc(refund.number)}</a> (${money(refund.total)})`).join(', ')}.
      </div>` : ''}
    ${invoice.replaced_by_id ? `
      <div class="notice" style="margin-bottom:14px">
        Este ticket se sustituyó por la <a href="#/facturas/${invoice.replaced_by_id}">factura ${esc(invoice.replaced_by_number)}</a>.
      </div>` : ''}
    <div class="notice" style="margin-bottom:14px">
      Para guardar en PDF: pulsa <b>Imprimir / Guardar PDF</b> y en "Destino" elige <b>Guardar como PDF</b>.
    </div>
    <div class="inv-preview-wrap" style="position:static"><div data-document></div></div>`;

  function renderDocument() {
    root.querySelectorAll('[data-format]').forEach(button => button.classList.toggle('on', button.dataset.format === format));
    root.querySelector('[data-document]').innerHTML = documentHtml(invoice, format);
  }

  async function voidInvoice() {
    const what = isTicket ? 'este ticket' : 'esta factura';
    const confirmed = await confirmDialog(
      `¿Anular ${what}? Seguirá guardado pero marcado como ANULADO (la numeración no se reutiliza). La venta en caja no se borra.`,
      { okText: 'Anular', danger: true });
    if (!confirmed) return;
    if (!(await tryApi(`/invoices/${id}/void`, { method: 'POST' }))) return;
    toast('Anulado');
    reloadView();
  }

  on(root, 'click', '[data-format]', (button) => {
    format = button.dataset.format;
    renderDocument();
  });
  on(root, 'click', '[data-print]', () => printDocument(documentHtml(invoice, format), { format, filename: fileNameFor(invoice) }));
  on(root, 'click', '[data-void]', voidInvoice);
  on(root, 'click', '[data-refund]', () => openRefundDialog(invoice));
  renderDocument();
}

// Picks what comes back and how the money is returned, then opens the refund document to print it.
async function openRefundDialog(invoice) {
  const { sales, modules } = state.settings;
  const sale = (await tryApi(`/invoices/${invoice.id}/sale`)) || { found: false };
  const saleCategories = state.categories.filter(category => category.kind === 'sale' && category.active);
  const asksPaymentMethod = modules.payment_methods && sales.ask_payment_method;
  const seesProfit = can('worker_see_daily_profit');
  // The discount of the original comes back in the same proportion.
  const paidShare = invoice.subtotal ? invoice.total / invoice.subtotal : 1;
  const lines = invoice.items
    .map((item, index) => ({ ...item, index, left: item.qty - (invoice.refunded_qty[index] || 0) }))
    .filter(line => line.left > 0);

  const lineRow = (line) => `
    <tr>
      <td>${esc(line.description)}${line.detail ? `<div class="desc">${esc(line.detail)}</div>` : ''}</td>
      <td class="r num">${money(line.price)}</td>
      <td class="r">
        <select data-line="${line.index}" data-price="${line.price}" style="width:auto">
          ${Array.from({ length: line.left + 1 }, (_, qty) => `<option value="${qty}" ${qty === line.left ? 'selected' : ''}>${qty}</option>`).join('')}
        </select>
      </td>
    </tr>`;

  modal({
    title: `Devolución de ${invoice.number}`,
    body: `
      <form data-refund-form class="settings-grid">
        <div class="wide table-wrap">
          <table class="t">
            <thead><tr><th>Producto</th><th class="r">Precio</th><th class="r">Unidades que devuelve</th></tr></thead>
            <tbody>${lines.map(lineRow).join('')}</tbody>
          </table>
        </div>
        <label class="field wide">Motivo <span class="hint">sale en el documento de devolución</span>
          <input type="text" name="reason" maxlength="300" placeholder="Defectuoso, no era el modelo, desistimiento…">
        </label>
        <div class="field wide">
          <div class="muted" style="font-weight:600">Importe a devolver</div>
          <div style="font-size:26px;font-weight:750" class="num" data-refund-total></div>
        </div>
        <label class="check wide">
          <input type="checkbox" name="register" checked>
          <span><b>Devolver el dinero y apuntarlo en la caja de hoy</b><span class="muted">Desmárcalo si se cambia por otro producto o se entrega un vale.</span></span>
        </label>
        <label class="field" data-register-field>Producto de la venta
          <select name="category">
            ${saleCategories.map(category => `<option value="${category.id}" ${category.id === sale.category_id ? 'selected' : ''}>${esc(category.name)}</option>`).join('')}
          </select>
        </label>
        ${asksPaymentMethod ? `
          <label class="field" data-register-field>Se devuelve por
            <select name="payment">${sales.payment_methods.map(method => `<option ${method === sale.payment_method ? 'selected' : ''}>${esc(method)}</option>`).join('')}</select>
          </label>` : ''}
        ${seesProfit ? `
          <label class="field" data-register-field>Beneficio que se pierde (€) <span class="hint">${sale.found ? 'calculado con la venta original' : 'no hay venta enlazada: escríbelo'}</span>
            <input class="money" name="profit" inputmode="decimal" placeholder="0,00">
          </label>` : ''}
      </form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('undo')} Hacer devolución</button>`,
    wide: true,
    onMount: (dialog, close) => {
      const form = dialog.querySelector('[data-refund-form]');
      const fields = form.elements;
      let profitTyped = false;

      const selected = () => [...form.querySelectorAll('[data-line]')].map(select => ({
        line: Number(select.dataset.line), qty: Number(select.value), price: Number(select.dataset.price),
      }));
      const refundTotal = () => Math.round(selected().reduce((sum, line) => sum + line.qty * line.price, 0) * paidShare * 100) / 100;

      function refresh() {
        const total = refundTotal();
        form.querySelector('[data-refund-total]').textContent = money(total);
        form.querySelectorAll('[data-register-field]').forEach(field => field.classList.toggle('hidden', !fields.register.checked));
        if (fields.profit && sale.found && !profitTyped && sale.amount) fields.profit.value = moneyInput(sale.profit * total / sale.amount);
      }
      fields.profit?.addEventListener('input', () => { profitTyped = true; });
      form.addEventListener('change', refresh);
      refresh();

      dialog.querySelector('[data-ok]').onclick = async () => {
        if (!(refundTotal() > 0)) return toast('Marca lo que se devuelve', 'err');
        const profit = fields.profit ? parseMoney(fields.profit.value) : NaN;
        const body = {
          items: selected().map(({ line, qty }) => ({ line, qty })),
          reason: fields.reason.value,
          register: fields.register.checked
            ? {
              category_id: Number(fields.category.value),
              payment_method: fields.payment ? fields.payment.value : '',
              profit: Number.isFinite(profit) ? profit : undefined,
            }
            : null,
        };
        const refund = await tryApi(`/invoices/${invoice.id}/refund`, { method: 'POST', body });
        if (!refund) return;
        state.settings.invoice.refund_next_number = Number(state.settings.invoice.refund_next_number) + 1;
        toast(`Devolución ${refund.number} hecha`, 'ok');
        close();
        location.hash = `#/${KINDS[invoice.kind].section}/${refund.id}`;
      };
    },
  });
}

// ---- Editor
const emptyItem = () => ({ description: '', detail: '', qty: 1, price: '', warranty: '' });

// A new document can start empty, from a sale already in the register (?venta=) or from a ticket (?desde_ticket=).
const CUSTOMER_INPUTS = {
  name: 'customer_name', nif: 'customer_nif', phone: 'customer_phone', address: 'customer_address',
  postcode: 'customer_postcode', city: 'customer_city', province: 'customer_province',
};

// Opened from a customer's page (?cliente=): their details, ready in the document's own fields.
async function customerDetails(params) {
  const customer = params.get('cliente') ? await tryApi(`/customers/${Number(params.get('cliente'))}`) : null;
  if (!customer) return {};
  return Object.fromEntries(Object.entries(CUSTOMER_INPUTS).map(([field, input]) => [input, customer[field] || '']));
}

async function initialDraft(params, kind) {
  const ticketId = kind === 'factura' ? Number(params.get('desde_ticket')) : 0;
  const sourceTicket = ticketId ? await tryApi(`/invoices/${ticketId}`) : null;
  if (sourceTicket) {
    return {
      sourceTicket,
      customer_name: sourceTicket.customer_name, customer_nif: sourceTicket.customer_nif,
      customer_address: sourceTicket.customer_address, customer_postcode: sourceTicket.customer_postcode,
      customer_city: sourceTicket.customer_city, customer_province: sourceTicket.customer_province,
      customer_phone: sourceTicket.customer_phone,
      items: sourceTicket.items.map(item => ({ ...item })),
      discount: sourceTicket.discount,
      notes: sourceTicket.notes,
      show_vat: sourceTicket.show_vat,
    };
  }
  // Other screens (cash register, repairs, stock) open the editor with the first line filled in.
  const firstItem = {
    ...emptyItem(),
    description: params.get('desc') || '',
    detail: params.get('detalle') || '',
    price: params.get('precio') ? Number(params.get('precio')) : '',
    warranty: params.get('garantia') || '',
    warrantyChosenByUser: !!params.get('garantia'),
  };
  return {
    sourceTicket: null,
    customer_name: '', customer_nif: '', customer_address: '', customer_postcode: '',
    customer_city: '', customer_province: '', customer_phone: '',
    ...(await customerDetails(params)),
    items: [firstItem],
    discount: 0,
    notes: '',
    show_vat: !!invoiceConfig().show_vat,
  };
}

async function renderEditor(root, params, kind) {
  const labels = KINDS[kind];
  const config = invoiceConfig();
  const isFullInvoice = kind === 'factura';
  const format = defaultFormat(kind);
  const number = nextNumber(kind);
  const saleId = Number(params.get('venta')) || null;
  const saleCategories = state.categories.filter(category => category.kind === 'sale' && category.active);
  const asksPaymentMethod = state.settings.modules.payment_methods;

  const draft = await initialDraft(params, kind);
  const { sourceTicket } = draft;
  // The sale is recorded here only when it is not in the register already.
  const offersToRegisterSale = !sourceTicket && !saleId;

  // ---- warranties
  const warrantyNames = config.warranties.map(warranty => warranty.name);

  // The product whose name starts the description, preferring the longest match ("Funda y protector" over "Funda").
  function categoryMatching(description) {
    const text = (description || '').toLowerCase();
    return saleCategories
      .filter(category => text.startsWith(category.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0];
  }

  // Proposes the product's warranty until the user picks one by hand for that line.
  function suggestWarranty(item) {
    if (item.warrantyChosenByUser) return;
    const category = categoryMatching(item.description);
    if (category && warrantyNames.includes(category.warranty)) item.warranty = category.warranty;
  }
  if (!sourceTicket) draft.items.forEach(suggestWarranty);

  // ---- markup
  const required = isFullInvoice ? ' <span class="neg">*</span>' : '';
  const customerHint = isFullInvoice ? '(obligatorios en una factura completa)' : '(opcional)';
  const customerField = (name, label, isRequired, attributes = '') => `
    <label class="field"><span>${label}${isRequired ? required : ''}</span>
      <input type="text" name="${name}" value="${esc(draft[name] || '')}" ${attributes}>
    </label>`;

  const registerSaleBlock = `
    <div class="card card-pad" style="background:var(--surface-2)">
      <label class="check">
        <input type="checkbox" name="register" checked>
        <span><b>Registrar también como venta en la caja de hoy</b><span class="muted">Desmárcalo si ya apuntaste la venta.</span></span>
      </label>
      <div class="settings-grid" data-register-fields>
        <label class="field">Producto
          <select name="register_category">
            ${saleCategories.map(category => `<option value="${category.id}">${esc(category.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">Beneficio (€)<input class="money" name="register_profit" inputmode="decimal" placeholder="0,00"></label>
        ${asksPaymentMethod ? `
          <label class="field">Forma de pago
            <select name="register_payment">
              ${state.settings.sales.payment_methods.map(method => `<option>${esc(method)}</option>`).join('')}
            </select>
          </label>` : ''}
      </div>
    </div>`;

  let saleNotice = registerSaleBlock;
  if (sourceTicket) {
    saleNotice = `<div class="notice">La factura indicará que sustituye al ticket ${esc(sourceTicket.number)}. La venta ya está en caja, no se duplica.</div>`;
  } else if (saleId) {
    saleNotice = '<div class="notice">Se vinculará a la venta ya registrada en caja (no se duplica la venta).</div>';
  }

  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="#/${labels.section}" title="Volver">${icon('left')}</a>
      <div>
        <h1>${labels.createLabel}${sourceTicket ? ` <span class="faint" style="font-weight:500">a partir del ticket ${esc(sourceTicket.number)}</span>` : ''}</h1>
        <div class="sub">N.º previsto: ${esc(number)}</div>
      </div>
    </div>
    ${missingShopDataNotice()}
    <div class="inv-layout">
      <div class="card card-pad">
        <form data-form autocomplete="off" style="display:flex;flex-direction:column;gap:14px">
          ${isAdmin() ? `
            <div class="row">
              <span class="spacer"></span>
              <label class="row" style="gap:6px"><span class="muted">Fecha</span><input type="date" name="date" value="${today()}" style="width:auto"></label>
            </div>` : ''}
          <details ${isFullInvoice ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600">Datos del cliente <span class="faint">${customerHint}</span></summary>
            <div class="settings-grid" style="margin-top:10px">
              ${customerField('customer_name', 'Nombre y apellidos / Empresa', true)}
              ${customerField('customer_nif', 'NIF / NIE / CIF', true)}
              ${customerField('customer_address', 'Dirección (calle, número, piso)', true)}
              ${customerField('customer_postcode', 'Código postal', false, 'inputmode="numeric" maxlength="12"')}
              ${customerField('customer_city', 'Población', false)}
              ${customerField('customer_province', 'Provincia', false)}
              ${customerField('customer_phone', 'Teléfono', false, 'inputmode="tel"')}
            </div>
          </details>
          <div>
            <div class="row" style="margin-bottom:8px">
              <b>Líneas</b><span class="spacer"></span>
              <span class="faint" style="font-size:12px">La 2ª línea es para IMEI / nº de serie</span>
            </div>
            <div class="inv-lines" data-items></div>
            <button type="button" class="btn btn-sm" data-add-item>${icon('plus')} Añadir línea</button>
          </div>
          <div class="settings-grid">
            <label class="field">Descuento (€)
              <input class="money" name="discount" inputmode="decimal" placeholder="0,00" value="${draft.discount ? moneyInput(draft.discount) : ''}">
            </label>
            <div class="field" style="justify-content:flex-end">
              <div class="muted" style="font-weight:600">Total</div>
              <div style="font-size:26px;font-weight:750" class="num" data-total></div>
            </div>
            <label class="field wide">Notas <span class="hint">opcional; la garantía se elige en cada línea</span>
              <textarea name="notes" rows="2">${esc(draft.notes)}</textarea>
            </label>
            <label class="check wide">
              <input type="checkbox" name="show_vat" ${draft.show_vat ? 'checked' : ''}>
              <span><b>Desglosar IVA</b><span class="muted">Muestra base imponible e IVA (${esc(config.vat_rate)}%). El precio no cambia.</span></span>
            </label>
          </div>
          <div class="notice warn hidden" data-limit-warning></div>
          ${saleNotice}
          <div class="row">
            <button class="btn btn-primary" type="submit">${icon('print')} Guardar e imprimir</button>
            <button class="btn" type="button" data-save-only>Solo guardar</button>
          </div>
        </form>
      </div>
      <div class="inv-preview-wrap"><div class="inv-preview-scale" data-preview></div></div>
    </div>`;

  const form = root.querySelector('[data-form]');
  attachCustomerPicker(form, CUSTOMER_INPUTS);
  const itemsContainer = root.querySelector('[data-items]');
  const preview = root.querySelector('[data-preview]');
  const previewFrame = root.querySelector('.inv-preview-wrap');

  // ---- items
  function warrantyOptions(selected) {
    return ['', ...warrantyNames].map(name => `
      <option value="${esc(name)}" ${name === selected ? 'selected' : ''}>${name ? `Garantía: ${esc(name)}` : 'Sin garantía'}</option>`).join('');
  }

  function renderItems() {
    const isOnlyItem = draft.items.length === 1;
    itemsContainer.innerHTML = draft.items.map((item, index) => `
      <div class="line" data-index="${index}">
        <div class="stack">
          <input type="text" data-field="description" placeholder="Descripción del producto o servicio" value="${esc(item.description)}">
          <input type="text" data-field="detail" placeholder="IMEI / nº de serie / detalle (opcional)" value="${esc(item.detail || '')}">
          <select data-field="warranty" title="Garantía de esta línea">${warrantyOptions(item.warranty || '')}</select>
        </div>
        <input type="number" min="1" data-field="qty" value="${esc(item.qty)}" title="Cantidad">
        <input type="text" class="num" data-field="price" inputmode="decimal" placeholder="Precio"
               value="${esc(typeof item.price === 'number' ? moneyInput(item.price) : item.price)}" title="Precio unitario con IVA (€)">
        <button type="button" class="btn btn-ghost btn-icon" data-remove-item title="Quitar" ${isOnlyItem ? 'disabled' : ''}>${icon('trash')}</button>
      </div>`).join('');
  }

  const itemOf = (element) => draft.items[Number(element.closest('[data-index]').dataset.index)];

  // ---- current document
  // Typed amounts may use a comma ("12,50"); values coming from a ticket are already numbers.
  function toAmount(value) {
    const parsed = parseMoney(value);
    return Number.isFinite(parsed) ? parsed : Number(value) || 0;
  }

  function currentDocument() {
    const items = draft.items.map(item => ({ ...item, qty: Number(item.qty) || 1, price: toAmount(item.price) }));
    const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
    const discount = toAmount(form.elements.discount.value);
    return {
      kind, number, items, subtotal, discount,
      total: Math.max(0, subtotal - discount),
      date: form.elements.date ? form.elements.date.value : today(),
      customer_name: form.elements.customer_name.value,
      customer_nif: form.elements.customer_nif.value,
      customer_address: form.elements.customer_address.value,
      customer_postcode: form.elements.customer_postcode.value,
      customer_city: form.elements.customer_city.value,
      customer_province: form.elements.customer_province.value,
      customer_phone: form.elements.customer_phone.value,
      notes: form.elements.notes.value,
      show_vat: form.elements.show_vat.checked,
      replaces_number: sourceTicket?.number,
      replaces_date: sourceTicket?.date,
      created_at: new Date().toISOString().replace('T', ' '),
    };
  }

  function renderLimitWarning(total) {
    const warning = root.querySelector('[data-limit-warning]');
    const exceedsLimit = kind === 'ticket' && total > SIMPLIFIED_LIMIT;
    warning.classList.toggle('hidden', !exceedsLimit);
    if (!exceedsLimit) return;
    warning.innerHTML = total > SIMPLIFIED_RETAIL_LIMIT
      ? `Más de ${money(SIMPLIFIED_RETAIL_LIMIT)}: una factura simplificada no es válida para este importe. Haz una <a href="#/facturas/nueva">factura completa</a>.`
      : `Más de ${money(SIMPLIFIED_LIMIT)}: la factura simplificada solo es válida hasta ${money(SIMPLIFIED_RETAIL_LIMIT)} en ventas al por menor. Si el cliente necesita deducirse el IVA, haz una factura completa.`;
  }

  // The preview is the real document, scaled down to fit its column.
  function renderPreview() {
    const invoice = currentDocument();
    root.querySelector('[data-total]').textContent = money(invoice.total);
    renderLimitWarning(invoice.total);
    preview.innerHTML = documentHtml(invoice, format);
    const page = preview.firstElementChild;
    const scale = Math.min(1, (previewFrame.clientWidth - 36) / page.offsetWidth);
    preview.style.transform = `scale(${scale})`;
    preview.style.width = `${page.offsetWidth}px`;
    preview.style.height = `${page.offsetHeight * scale}px`;
  }

  // ---- saving
  function validate(invoice) {
    if (!invoice.items.some(item => item.description.trim())) {
      toast('Escribe al menos una línea', 'err');
      return false;
    }
    const hasCustomer = invoice.customer_name.trim() && invoice.customer_nif.trim() && invoice.customer_address.trim();
    if (isFullInvoice && !hasCustomer) {
      toast('Una factura completa necesita nombre, NIF y dirección del cliente', 'err');
      root.querySelector('details').open = true;
      form.elements.customer_name.focus();
      return false;
    }
    return true;
  }

  // How the document relates to the cash register. Returns null after telling the user what is missing.
  function saleLink() {
    if (sourceTicket) return { replaces_id: sourceTicket.id };
    if (saleId) return { movement_id: saleId };
    if (!form.elements.register.checked) return {};
    const profit = parseMoney(form.elements.register_profit.value);
    if (!Number.isFinite(profit)) {
      toast('Indica el beneficio de la venta (o desmarca "Registrar en caja")', 'err');
      form.elements.register_profit.focus();
      return null;
    }
    return {
      register: {
        profit,
        category_id: Number(form.elements.register_category.value),
        payment_method: form.elements.register_payment ? form.elements.register_payment.value : '',
      },
    };
  }

  function advanceLocalCounter() {
    const counter = kind === 'ticket' ? 'ticket_next_number' : 'next_number';
    config[counter] = Number(config[counter]) + 1;
  }

  async function save({ print }) {
    const invoice = currentDocument();
    if (!validate(invoice)) return;
    if (invoice.total <= 0 && !(await confirmDialog('El total es 0 €. ¿Guardar igualmente?'))) return;
    const link = saleLink();
    if (!link) return;

    const body = {
      kind, ...link,
      date: invoice.date,
      customer_name: invoice.customer_name, customer_nif: invoice.customer_nif,
      customer_address: invoice.customer_address, customer_postcode: invoice.customer_postcode,
      customer_city: invoice.customer_city, customer_province: invoice.customer_province,
      customer_phone: invoice.customer_phone,
      items: invoice.items.filter(item => item.description.trim()),
      discount: invoice.discount,
      notes: invoice.notes,
      show_vat: invoice.show_vat,
    };
    try {
      const created = await api('/invoices', { method: 'POST', body });
      toast(`${labels.singular} ${created.number} guardado`, 'ok');
      advanceLocalCounter();
      location.hash = `#/${labels.section}/${created.id}`;
      if (!print) return;
      const saved = await api(`/invoices/${created.id}`);
      setTimeout(() => printDocument(documentHtml(saved, format), { format, filename: fileNameFor(saved) }), 300);
    } catch (error) {
      toast(error.message, 'err');
    }
  }

  // ---- events
  on(itemsContainer, 'input', '[data-field]', (input) => {
    const item = itemOf(input);
    item[input.dataset.field] = input.value;
    if (input.dataset.field === 'warranty') item.warrantyChosenByUser = true;
    renderPreview();
  });
  // When a description is finished, propose the warranty and the register product that match it.
  on(itemsContainer, 'change', '[data-field="description"]', (input) => {
    const item = itemOf(input);
    suggestWarranty(item);
    input.closest('[data-index]').querySelector('[data-field="warranty"]').value = item.warranty || '';
    selectRegisterCategory();
    renderPreview();
  });
  on(itemsContainer, 'click', '[data-remove-item]', (button) => {
    draft.items.splice(Number(button.closest('[data-index]').dataset.index), 1);
    renderItems();
    renderPreview();
  });
  on(root, 'click', '[data-add-item]', () => {
    draft.items.push(emptyItem());
    renderItems();
    renderPreview();
  });
  on(root, 'click', '[data-save-only]', () => save({ print: false }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save({ print: true });
  });
  form.addEventListener('input', renderPreview);
  if (offersToRegisterSale) {
    form.elements.register.addEventListener('change', () => {
      root.querySelector('[data-register-fields]').classList.toggle('hidden', !form.elements.register.checked);
    });
  }

  function selectRegisterCategory() {
    if (!offersToRegisterSale) return;
    const category = categoryMatching(draft.items[0].description);
    if (category) form.elements.register_category.value = category.id;
  }

  renderItems();
  renderPreview();
  selectRegisterCategory();
  redrawOnResize(previewFrame, renderPreview);
}
