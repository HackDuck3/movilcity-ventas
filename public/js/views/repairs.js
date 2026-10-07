// Repair receipts: the slip the customer keeps while the shop has their device.
import {
  api, state, esc, icon, money, fmtDate, toast, isAdmin, parseMoney, moneyInput, confirmDialog, modal, debounce, on, redrawOnResize, tryApi,
} from '../core.js';
import { repairReceipt, repairSheet } from '../repair-receipt.js';
import { printDocument } from '../invoice.js';

const SECTION = '#/reparaciones';
const FILTERS = [['pending', 'Pendientes'], ['forgotten', 'Olvidadas'], ['collected', 'Recogidas'], ['', 'Todas']];
const PATTERN_DOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function repairsView(root, params, sub) {
  if (sub === 'nueva') return renderEditor(root, null);
  if (sub && params.get('editar') === '1') return renderEditor(root, Number(sub));
  if (sub) return renderDetail(root, Number(sub));
  return renderList(root);
}

// 'a4' prints one landscape sheet with two copies; 'ticket' uses the thermal printer.
const defaultFormat = () => (state.settings.repairs.print_format === 'ticket' ? 'ticket' : 'a4');
const receiptHtml = (repair, format) => (format === 'ticket' ? repairReceipt(repair, state.settings) : repairSheet(repair, state.settings));

function printReceipt(repair, format) {
  printDocument(receiptHtml(repair, format), {
    format: format === 'ticket' ? 'ticket' : 'a4-landscape',
    filename: `Reparacion-${repair.number}`,
  });
}

const deviceName = (repair) => [repair.brand, repair.model].filter(Boolean).join(' ');
const workSummary = (repair) => [...repair.faults, repair.notes].filter(Boolean).join(', ');

function statusBadge(repair) {
  if (repair.voided) return '<span class="neg">Anulada</span>';
  return repair.status === 'collected'
    ? '<span class="status-badge done">Recogida</span>'
    : '<span class="status-badge">Pendiente</span>';
}

// Link that opens WhatsApp with the "ready to collect" message written. Empty when there is no usable phone.
function whatsappUrl(repair) {
  const digits = repair.customer_phone.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length < 9) return '';
  const number = digits.length === 9 ? `34${digits}` : digits; // 9 digits = Spanish number without prefix
  const values = {
    nombre: repair.customer_name.split(' ')[0],
    terminal: deviceName(repair),
    numero: repair.number,
    importe: repair.amount == null ? '' : money(repair.amount),
    tienda: state.settings.shop.name,
  };
  const message = state.settings.repairs.ready_message.replace(/\{(\w+)\}/g, (placeholder, key) => values[key] ?? placeholder);
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

// ---- List
function repairsTable(repairs) {
  if (!repairs.length) return '<div class="empty">No hay reparaciones con este filtro</div>';
  const row = (repair) => `
    <tr class="clickable ${repair.voided ? 'deleted' : ''}" data-id="${repair.id}">
      <td><b>${esc(repair.number)}</b></td>
      <td class="num">${fmtDate(repair.date)}</td>
      <td>${esc(repair.customer_name || '—')}<div class="desc">${esc(repair.customer_phone)}</div></td>
      <td>${esc(deviceName(repair))}<div class="desc">${esc(workSummary(repair))}</div></td>
      <td class="r num"><b>${repair.amount == null ? '—' : money(repair.amount)}</b></td>
      <td style="text-decoration:none">${statusBadge(repair)}</td>
    </tr>`;
  return `
    <table class="t">
      <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Terminal y reparación</th><th class="r">Importe</th><th>Estado</th></tr></thead>
      <tbody>${repairs.map(row).join('')}</tbody>
    </table>`;
}

async function renderList(root) {
  let status = 'pending';
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Reparaciones</h1><div class="sub">Resguardos de los móviles que deja el cliente</div></div>
      <span class="spacer"></span>
      <a class="btn btn-primary" href="${SECTION}/nueva">${icon('plus')} Nueva reparación</a>
    </div>
    <div class="card card-pad" style="margin-bottom:14px">
      <div class="row" style="gap:10px">
        <div class="seg">${FILTERS.map(([value, label]) => `<button data-status="${value}">${label}</button>`).join('')}</div>
        <input type="search" data-search placeholder="Buscar por número, cliente, teléfono, modelo o IMEI…" style="flex:1;min-width:200px">
      </div>
    </div>
    <div data-forgotten-notice></div>
    <div class="card"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>`;

  const search = root.querySelector('[data-search]');

  async function renderForgottenNotice() {
    const summary = await tryApi('/repairs/summary');
    if (!summary || !summary.forgotten) return;
    const days = state.settings.repairs.reminder_days;
    root.querySelector('[data-forgotten-notice]').innerHTML = `
      <div class="notice warn" style="margin-bottom:14px">
        ${icon('warn')} <b>${summary.forgotten}</b> reparación(es) llevan más de ${esc(days)} días sin recoger.
        <a href="#" data-status="forgotten">Ver y avisar a los clientes</a>
      </div>`;
  }

  async function load() {
    root.querySelectorAll('[data-status]').forEach(button => button.classList.toggle('on', button.dataset.status === status));
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (search.value.trim()) query.set('q', search.value.trim());
    const repairs = await tryApi(`/repairs?${query}`);
    if (repairs) root.querySelector('[data-list]').innerHTML = repairsTable(repairs);
  }

  on(root, 'click', '[data-status]', (button, event) => {
    event.preventDefault();
    status = button.dataset.status;
    load();
  });
  on(root, 'click', '[data-id]', (row) => { location.hash = `${SECTION}/${row.dataset.id}`; });
  search.addEventListener('input', debounce(load, 300));
  await load();
  renderForgottenNotice();
}

// ---- Detail
async function renderDetail(root, id) {
  let repair;
  try {
    repair = await api(`/repairs/${id}`);
  } catch (error) {
    root.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    return;
  }
  const isCollected = repair.status === 'collected';
  const canMakeTicket = state.settings.modules.invoices && !repair.voided;
  // Opens the ticket editor with the repair as its first line; its warranty is proposed from the product name.
  const ticketUrl = `#/tickets/nueva?desc=${encodeURIComponent(`Reparacion ${deviceName(repair)}`)}${repair.amount == null ? '' : `&precio=${repair.amount}`}`;

  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="${SECTION}" title="Volver">${icon('left')}</a>
      <div>
        <h1>Reparación ${esc(repair.number)}</h1>
        <div class="sub">${fmtDate(repair.date)} · ${esc(deviceName(repair))} · recibido por ${esc(repair.user_name || '')} · ${statusBadge(repair)}</div>
      </div>
      <span class="spacer"></span>
      <div class="seg">
        <button data-format="a4">A4 (2 copias)</button>
        <button data-format="ticket">Ticket térmico</button>
      </div>
      <button class="btn btn-primary" data-print>${icon('print')} Imprimir resguardo</button>
      ${!repair.voided && !isCollected && whatsappUrl(repair) ? `
        <a class="btn" href="${esc(whatsappUrl(repair))}" target="_blank" rel="noopener" title="Abre WhatsApp con el mensaje ya escrito">
          ${icon('message')} Avisar por WhatsApp
        </a>` : ''}
      ${repair.voided ? '' : `
        <button class="btn" data-toggle-collected>${icon(isCollected ? 'undo' : 'check')} ${isCollected ? 'Marcar como pendiente' : 'Marcar como recogida'}</button>
        <a class="btn" href="${SECTION}/${repair.id}?editar=1">${icon('edit')} Editar</a>`}
      ${canMakeTicket ? `<a class="btn" href="${ticketUrl}">${icon('receipt')} Hacer ticket</a>` : ''}
      ${isAdmin() && !repair.voided ? '<button class="btn btn-danger" data-void>Anular</button>' : ''}
    </div>
    <div class="notice" style="margin-bottom:14px" data-print-hint></div>
    <div class="inv-preview-wrap" style="position:static"><div class="inv-preview-scale" data-preview></div></div>`;

  let format = defaultFormat();
  const preview = root.querySelector('[data-preview]');
  const previewFrame = root.querySelector('.inv-preview-wrap');

  // The preview is the real document, scaled down when it is wider than the screen.
  function renderPreview() {
    root.querySelectorAll('[data-format]').forEach(button => button.classList.toggle('on', button.dataset.format === format));
    root.querySelector('[data-print-hint]').innerHTML = format === 'ticket'
      ? 'Imprime <b>dos copias</b>: una firmada por el cliente para la tienda y otra para el cliente.'
      : 'Sale <b>un folio apaisado con dos copias</b>: córtalo por la línea de puntos. En la ventana de impresión elige la impresora de folios y orientación <b>horizontal</b>.';
    preview.innerHTML = receiptHtml(repair, format);
    const page = preview.firstElementChild;
    const scale = Math.min(1, (previewFrame.clientWidth - 36) / page.offsetWidth);
    preview.style.transform = `scale(${scale})`;
    preview.style.width = `${page.offsetWidth}px`;
    preview.style.height = `${page.offsetHeight * scale}px`;
    preview.style.margin = scale === 1 ? '0 auto' : '';
  }
  renderPreview();
  redrawOnResize(previewFrame, renderPreview);

  on(root, 'click', '[data-format]', (button) => {
    format = button.dataset.format;
    renderPreview();
  });
  on(root, 'click', '[data-print]', () => printReceipt(repair, format));
  async function setStatus(status, register) {
    const saved = await tryApi(`/repairs/${id}/status`, { method: 'POST', body: { status, register } });
    if (saved) renderDetail(root, id);
    return !!saved;
  }

  on(root, 'click', '[data-toggle-collected]', () => {
    if (isCollected) return setStatus('pending');
    // A repair is charged in the register only once, even if it is reopened later.
    if (repair.movement_id) return setStatus('collected');
    openCollectDialog(repair, setStatus);
  });
  on(root, 'click', '[data-void]', async () => {
    const confirmed = await confirmDialog('¿Anular esta reparación? Seguirá guardada pero marcada como ANULADA.', { okText: 'Anular', danger: true });
    if (confirmed && await tryApi(`/repairs/${id}/void`, { method: 'POST' })) renderDetail(root, id);
  });
}

// Asks how the repair is paid so the sale goes into the cash register in the same step.
function openCollectDialog(repair, setStatus) {
  const { sales, modules } = state.settings;
  const saleCategories = state.categories.filter(category => category.kind === 'sale' && category.active);
  const repairCategory = saleCategories.find(category => category.name.toLowerCase().startsWith('reparaci'));
  const asksPaymentMethod = modules.payment_methods && sales.ask_payment_method;

  modal({
    title: `Entregar reparación ${repair.number}`,
    body: `
      <form data-collect-form class="settings-grid">
        <label class="check wide">
          <input type="checkbox" name="register" checked>
          <span><b>Cobrar ahora y registrar la venta en caja</b><span class="muted">Desmárcalo si ya estaba cobrada o apuntada.</span></span>
        </label>
        <label class="field">Importe cobrado (€)
          <input class="money" name="amount" inputmode="decimal" placeholder="0,00" value="${repair.amount == null ? '' : moneyInput(repair.amount)}">
        </label>
        <label class="field">Beneficio (€) <span class="hint">importe menos el coste de las piezas</span>
          <input class="money" name="profit" inputmode="decimal" placeholder="0,00">
        </label>
        <label class="field">Producto
          <select name="category">
            ${saleCategories.map(category => `<option value="${category.id}" ${category === repairCategory ? 'selected' : ''}>${esc(category.name)}</option>`).join('')}
          </select>
        </label>
        ${asksPaymentMethod ? `
          <label class="field">Forma de pago
            <select name="payment">${sales.payment_methods.map(method => `<option>${esc(method)}</option>`).join('')}</select>
          </label>` : ''}
      </form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Marcar como recogida</button>`,
    onMount: (dialog, close) => {
      dialog.querySelector('[data-ok]').onclick = async () => {
        const fields = dialog.querySelector('[data-collect-form]').elements;
        if (!fields.register.checked) {
          if (await setStatus('collected')) close();
          return;
        }
        const amount = parseMoney(fields.amount.value);
        const profit = parseMoney(fields.profit.value);
        if (!Number.isFinite(amount) || amount <= 0) return toast('Indica el importe cobrado', 'err');
        if (!Number.isFinite(profit)) return toast('Indica el beneficio (o desmarca "Cobrar ahora")', 'err');
        const register = {
          amount, profit,
          category_id: Number(fields.category.value),
          payment_method: fields.payment ? fields.payment.value : '',
        };
        if (await setStatus('collected', register)) {
          toast('Reparación entregada y cobrada en caja', 'ok');
          close();
        }
      };
    },
  });
}

// ---- Editor (new or existing)
async function renderEditor(root, id) {
  const existing = id ? await tryApi(`/repairs/${id}`) : null;
  if (id && !existing) return;
  const config = state.settings.repairs;
  const repair = existing || {
    customer_name: '', customer_nif: '', customer_phone: '', brand: '', model: '', imei: '', carrier: '',
    unlock_code: '', pattern: '', faults: [], notes: '', condition: '', amount: null,
  };
  let pattern = repair.pattern ? repair.pattern.split('-').map(Number) : [];
  // Keeps faults saved on this repair even if they were later removed from settings.
  const faultNames = [...new Set([...config.faults, ...repair.faults])];

  const textField = (name, label, hint = '') => `
    <label class="field">${label}${hint ? ` <span class="hint">${hint}</span>` : ''}
      <input type="text" name="${name}" value="${esc(repair[name])}">
    </label>`;

  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="${existing ? `${SECTION}/${id}` : SECTION}" title="Volver">${icon('left')}</a>
      <div>
        <h1>${existing ? `Editar reparación ${esc(existing.number)}` : 'Nueva reparación'}</h1>
        ${existing ? '' : `<div class="sub">N.º previsto: ${esc(`${config.prefix || ''}${config.next_number}`)}</div>`}
      </div>
    </div>
    <form class="card card-pad" data-form autocomplete="off" style="max-width:900px;display:flex;flex-direction:column;gap:18px">
      <div>
        <h3>Cliente</h3>
        <div class="settings-grid">
          ${textField('customer_name', 'Nombre y apellidos')}
          ${textField('customer_phone', 'Teléfono')}
          ${textField('customer_nif', 'NIF', 'para recoger el terminal si pierde el resguardo')}
        </div>
      </div>
      <div>
        <h3>Terminal</h3>
        <div class="settings-grid">
          ${textField('brand', 'Marca')}
          ${textField('model', 'Modelo')}
          ${textField('imei', 'IMEI')}
          ${textField('carrier', 'Compañía telefónica')}
          ${textField('unlock_code', 'Código de desbloqueo')}
          <div class="field">Patrón de desbloqueo <span class="hint">pulsa los puntos en orden</span>
            <div class="row" style="gap:14px;align-items:flex-start">
              <div class="pattern-pad" data-pattern-pad></div>
              <button type="button" class="btn btn-sm" data-clear-pattern>Borrar</button>
            </div>
          </div>
          <label class="field wide">Estado del móvil <span class="hint">golpes, arañazos, lo que ya no funciona…</span>
            <input type="text" name="condition" value="${esc(repair.condition)}">
          </label>
        </div>
      </div>
      <div>
        <h3>Reparación</h3>
        <div class="fault-grid">
          ${faultNames.map(name => `
            <label><input type="checkbox" name="fault" value="${esc(name)}" ${repair.faults.includes(name) ? 'checked' : ''}>${esc(name)}</label>`).join('')}
        </div>
        <div class="settings-grid" style="margin-top:14px">
          <label class="field wide">Otros <span class="hint">ej.: deja la SIM en la tienda</span>
            <input type="text" name="notes" value="${esc(repair.notes)}">
          </label>
          <label class="field">Importe (€) <span class="hint">déjalo vacío si aún no hay presupuesto</span>
            <input class="money" name="amount" inputmode="decimal" placeholder="0,00" value="${repair.amount == null ? '' : moneyInput(repair.amount)}">
          </label>
        </div>
      </div>
      <div class="row">
        <button class="btn btn-primary" type="submit">${icon('print')} ${existing ? 'Guardar' : 'Guardar e imprimir'}</button>
        ${existing ? '' : '<button class="btn" type="button" data-save-only>Solo guardar</button>'}
      </div>
    </form>`;

  const form = root.querySelector('[data-form]');

  function renderPatternPad() {
    root.querySelector('[data-pattern-pad]').innerHTML = PATTERN_DOTS.map(dot => {
      const step = pattern.indexOf(dot) + 1;
      return `<button type="button" data-dot="${dot}" class="${step ? 'used' : ''}">${step || ''}</button>`;
    }).join('');
  }

  function readForm() {
    const amount = parseMoney(form.elements.amount.value);
    const text = (name) => form.elements[name].value;
    return {
      customer_name: text('customer_name'), customer_nif: text('customer_nif'), customer_phone: text('customer_phone'),
      brand: text('brand'), model: text('model'), imei: text('imei'), carrier: text('carrier'),
      unlock_code: text('unlock_code'), condition: text('condition'), notes: text('notes'),
      pattern: pattern.join('-'),
      faults: [...form.querySelectorAll('[name=fault]:checked')].map(checkbox => checkbox.value),
      amount: Number.isFinite(amount) ? amount : null,
    };
  }

  async function save({ print }) {
    const body = readForm();
    try {
      if (existing) {
        await api(`/repairs/${id}`, { method: 'PUT', body });
        toast('Reparación guardada', 'ok');
        location.hash = `${SECTION}/${id}`;
        return;
      }
      const created = await api('/repairs', { method: 'POST', body });
      toast(`Reparación ${created.number} guardada`, 'ok');
      config.next_number = Number(config.next_number) + 1;
      location.hash = `${SECTION}/${created.id}`;
      if (!print) return;
      const saved = await api(`/repairs/${created.id}`);
      setTimeout(() => printReceipt(saved, defaultFormat()), 300);
    } catch (error) {
      toast(error.message, 'err');
    }
  }

  on(root, 'click', '[data-dot]', (button) => {
    const dot = Number(button.dataset.dot);
    if (!pattern.includes(dot)) pattern.push(dot);
    renderPatternPad();
  });
  on(root, 'click', '[data-clear-pattern]', () => {
    pattern = [];
    renderPatternPad();
  });
  on(root, 'click', '[data-save-only]', () => save({ print: false }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save({ print: true });
  });

  renderPatternPad();
}
