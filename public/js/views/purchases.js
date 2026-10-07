// Used phones bought from private sellers: contract, optional stock entry and expense, and the photo of the seller's ID.
import {
  api, state, esc, icon, money, fmtDate, today, toast, isAdmin, parseMoney, confirmDialog, debounce, on, redrawOnResize, reloadView, tryApi,
} from '../core.js';
import { purchaseContract } from '../purchase-contract.js';
import { printDocument } from '../invoice.js';

const SECTION = '#/compras';
const ID_PHOTO_MAX_SIDE = 1600;

export function purchasesView(root, params, sub) {
  if (sub === 'nueva') return renderEditor(root);
  if (sub) return renderDetail(root, Number(sub));
  return renderList(root);
}

const deviceName = (purchase) => [purchase.brand, purchase.model].filter(Boolean).join(' ');
const printContract = (purchase) => printDocument(purchaseContract(purchase, state.settings), { format: 'a4', filename: `Compra-${purchase.number}` });

// Shrinks the photo in the browser before sending it: phone cameras produce far more detail than an ID needs.
function resizedJpeg(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, ID_PHOTO_MAX_SIDE / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(resolve, 'image/jpeg', 0.85);
      URL.revokeObjectURL(image.src);
    };
    image.onerror = () => reject(new Error('No se puede leer la imagen'));
    image.src = URL.createObjectURL(file);
  });
}

async function uploadIdDocument(purchaseId, file) {
  const photo = await resizedJpeg(file);
  const response = await fetch(`/api/purchases/${purchaseId}/id-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'X-Requested-With': 'app' },
    body: photo,
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'No se pudo guardar la foto del documento');
}

// ---- List
function purchasesTable(purchases) {
  if (!purchases.length) return '<div class="empty">Todavía no hay compras registradas</div>';
  const row = (purchase) => `
    <tr class="clickable ${purchase.voided ? 'deleted' : ''}" data-id="${purchase.id}">
      <td><b>${esc(purchase.number)}</b></td>
      <td class="num">${fmtDate(purchase.date)}</td>
      <td>${esc(purchase.seller_name)}<div class="desc">${esc(purchase.seller_nif)}</div></td>
      <td>${esc(deviceName(purchase))}<div class="desc">IMEI ${esc(purchase.imei)}</div></td>
      <td class="r num"><b>${money(purchase.price)}</b></td>
      <td class="muted" style="text-decoration:none">${purchase.voided ? '<span class="neg">Anulada</span>' : purchase.has_id_document ? '' : 'Sin foto del DNI'}</td>
    </tr>`;
  return `
    <table class="t">
      <thead><tr><th>N.º</th><th>Fecha</th><th>Vendedor</th><th>Móvil</th><th class="r">Precio</th><th></th></tr></thead>
      <tbody>${purchases.map(row).join('')}</tbody>
    </table>`;
}

async function renderList(root) {
  const year = today().slice(0, 4);
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Compras de segunda mano</h1><div class="sub">Móviles que la tienda compra a particulares, con su contrato</div></div>
      <span class="spacer"></span>
      ${isAdmin() ? `<a class="btn" href="/api/admin/purchases-register.csv?from=${year}-01-01&to=${today()}" title="Listado de este año para la gestoría o la policía">${icon('download')} Registro de compras (CSV)</a>` : ''}
      <a class="btn btn-primary" href="${SECTION}/nueva">${icon('plus')} Nueva compra</a>
    </div>
    <div class="card card-pad" style="margin-bottom:14px">
      <input type="search" data-search placeholder="Buscar por vendedor, DNI, modelo o IMEI…">
    </div>
    <div class="card"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>`;

  const search = root.querySelector('[data-search]');
  async function load() {
    const query = search.value.trim();
    const purchases = await tryApi(`/purchases${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    if (purchases) root.querySelector('[data-list]').innerHTML = purchasesTable(purchases);
  }
  search.addEventListener('input', debounce(load, 300));
  on(root, 'click', '[data-id]', (row) => { location.hash = `${SECTION}/${row.dataset.id}`; });
  await load();
}

// ---- Detail
async function renderDetail(root, id) {
  let purchase;
  try {
    purchase = await api(`/purchases/${id}`);
  } catch (error) {
    root.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    return;
  }
  const idDocumentUrl = `/api/admin/purchases/${id}/id-document`;

  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="${SECTION}" title="Volver">${icon('left')}</a>
      <div>
        <h1>Compra ${esc(purchase.number)}</h1>
        <div class="sub">
          ${fmtDate(purchase.date)} · ${esc(deviceName(purchase))} · ${money(purchase.price)} · registrada por ${esc(purchase.user_name || '')}
          ${purchase.voided ? ' · <b class="neg">ANULADA</b>' : ''}
        </div>
      </div>
      <span class="spacer"></span>
      <button class="btn btn-primary" data-print>${icon('print')} Imprimir contrato (2 copias)</button>
      ${purchase.has_id_document && isAdmin() ? `<a class="btn" href="${idDocumentUrl}" target="_blank" rel="noopener">${icon('eye')} Ver foto del DNI</a>` : ''}
      <label class="btn" style="cursor:pointer">
        ${icon('image')} ${purchase.has_id_document ? 'Cambiar foto del DNI' : 'Adjuntar foto del DNI'}
        <input type="file" accept="image/*" capture="environment" data-id-photo hidden>
      </label>
      ${isAdmin() && !purchase.voided ? '<button class="btn btn-danger" data-void>Anular</button>' : ''}
    </div>
    ${purchase.has_id_document ? '' : `
      <div class="notice warn" style="margin-bottom:14px">${icon('warn')} Falta la foto del documento de identidad del vendedor.</div>`}
    <div class="notice" style="margin-bottom:14px">
      ${purchase.device_id ? 'El móvil está en el <a href="#/stock">stock</a>. ' : ''}
      ${purchase.movement_id ? 'El pago está apuntado como gasto en caja. ' : ''}
      Salen dos hojas: una copia para el vendedor y otra para la tienda. Firmad las dos.
    </div>
    <div class="inv-preview-wrap" style="position:static"><div class="inv-preview-scale" data-preview></div></div>`;

  const preview = root.querySelector('[data-preview]');
  const previewFrame = root.querySelector('.inv-preview-wrap');
  function renderPreview() {
    preview.innerHTML = purchaseContract(purchase, state.settings);
    const page = preview.firstElementChild;
    const scale = Math.min(1, (previewFrame.clientWidth - 36) / page.offsetWidth);
    preview.style.transform = `scale(${scale})`;
    preview.style.width = `${page.offsetWidth}px`;
    preview.style.height = `${preview.scrollHeight * scale}px`;
  }
  renderPreview();
  redrawOnResize(previewFrame, renderPreview);

  on(root, 'click', '[data-print]', () => printContract(purchase));
  on(root, 'change', '[data-id-photo]', async (input) => {
    if (!input.files[0]) return;
    try {
      await uploadIdDocument(id, input.files[0]);
      toast('Foto del documento guardada', 'ok');
      reloadView();
    } catch (error) {
      toast(error.message, 'err');
    }
  });
  on(root, 'click', '[data-void]', async () => {
    const confirmed = await confirmDialog(
      '¿Anular esta compra? Seguirá en el registro marcada como ANULADA. El móvil del stock y el gasto de caja no se tocan: corrígelos a mano si hace falta.',
      { okText: 'Anular', danger: true });
    if (confirmed && await tryApi(`/purchases/${id}/void`, { method: 'POST' })) reloadView();
  });
}

// ---- New purchase
function renderEditor(root) {
  const { sales, modules } = state.settings;
  const config = state.settings.purchases;
  const expenseCategories = state.categories.filter(category => category.kind === 'expense' && category.active);
  const phonePurchases = expenseCategories.find(category => category.name.toLowerCase().startsWith('compra de m'));
  const textField = (name, label, hint = '', wide = false) => `
    <label class="field ${wide ? 'wide' : ''}">${label}${hint ? ` <span class="hint">${hint}</span>` : ''}
      <input type="text" name="${name}">
    </label>`;

  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="${SECTION}" title="Volver">${icon('left')}</a>
      <div><h1>Nueva compra de segunda mano</h1><div class="sub">N.º previsto: ${esc(`${config.prefix || ''}${config.next_number}`)}</div></div>
    </div>
    <form class="card card-pad" data-form autocomplete="off" style="max-width:900px;display:flex;flex-direction:column;gap:18px">
      <div>
        <h3>Vendedor</h3>
        <div class="settings-grid">
          ${textField('seller_name', 'Nombre y apellidos')}
          ${textField('seller_nif', 'DNI / NIE', 'compruébalo con el documento original')}
          ${textField('seller_address', 'Domicilio', '', true)}
          ${textField('seller_phone', 'Teléfono')}
          <label class="field">Foto del DNI <span class="hint">se guarda solo en tu servidor</span>
            <input type="file" accept="image/*" capture="environment" name="id_photo">
          </label>
        </div>
      </div>
      <div>
        <h3>Móvil</h3>
        <div class="settings-grid">
          ${textField('brand', 'Marca')}
          ${textField('model', 'Modelo')}
          ${textField('imei', 'IMEI', 'marca *#06# en el móvil para verlo')}
          ${textField('condition', 'Estado', 'golpes, batería, pantalla, accesorios que entrega…', true)}
        </div>
      </div>
      <div>
        <h3>Pago</h3>
        <div class="settings-grid">
          <label class="field">Precio pagado (€)<input class="money" name="price" inputmode="decimal" placeholder="0,00"></label>
          <label class="field">Forma de pago
            <select name="payment_method">${sales.payment_methods.map(method => `<option>${esc(method)}</option>`).join('')}</select>
          </label>
          ${modules.stock ? `
            <label class="check wide"><input type="checkbox" name="add_to_stock" checked>
              <span><b>Añadir el móvil al stock</b><span class="muted">Como segunda mano, con este precio como coste.</span></span>
            </label>` : ''}
          <label class="check wide"><input type="checkbox" name="register_expense" checked>
            <span><b>Apuntar el pago como gasto en la caja de hoy</b>
              <select name="expense_category" style="margin-top:6px">
                ${expenseCategories.map(category => `<option value="${category.id}" ${category === phonePurchases ? 'selected' : ''}>${esc(category.name)}</option>`).join('')}
              </select>
            </span>
          </label>
        </div>
      </div>
      <div class="row">
        <button class="btn btn-primary" type="submit">${icon('print')} Guardar e imprimir contrato</button>
        <button class="btn" type="button" data-save-only>Solo guardar</button>
      </div>
    </form>`;

  const form = root.querySelector('[data-form]');

  async function save({ print }) {
    const fields = form.elements;
    const price = parseMoney(fields.price.value);
    const body = {
      seller_name: fields.seller_name.value, seller_nif: fields.seller_nif.value,
      seller_address: fields.seller_address.value, seller_phone: fields.seller_phone.value,
      brand: fields.brand.value, model: fields.model.value, imei: fields.imei.value, condition: fields.condition.value,
      price: Number.isFinite(price) ? price : null,
      payment_method: fields.payment_method.value,
      add_to_stock: !!fields.add_to_stock?.checked,
      expense_category_id: fields.register_expense.checked ? Number(fields.expense_category.value) : undefined,
    };
    const created = await tryApi('/purchases', { method: 'POST', body });
    if (!created) return;
    config.next_number = Number(config.next_number) + 1;
    toast(`Compra ${created.number} guardada`, 'ok');

    // The purchase is already saved; a failed photo upload can be retried from its page.
    if (fields.id_photo.files[0]) {
      try { await uploadIdDocument(created.id, fields.id_photo.files[0]); } catch (error) { toast(error.message, 'err'); }
    }
    location.hash = `${SECTION}/${created.id}`;
    if (!print) return;
    const saved = await tryApi(`/purchases/${created.id}`);
    if (saved) setTimeout(() => printContract(saved), 300);
  }

  on(root, 'click', '[data-save-only]', () => save({ print: false }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save({ print: true });
  });
}
