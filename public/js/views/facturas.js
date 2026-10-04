// Tickets (facturas simplificadas) y Facturas completas: dos secciones con su propia numeración.
import { api, state, esc, icon, money, fmtDate, today, toast, isAdmin, parseMoney, moneyInput, confirmDialog, debounce } from '../core.js';
import { invoiceA4, ticket80, printDocument } from '../invoice.js';

const META = {
  ticket: { section: 'tickets', one: 'ticket', One: 'Ticket', many: 'Tickets', nuevo: 'Nuevo ticket' },
  factura: { section: 'facturas', one: 'factura', One: 'Factura', many: 'Facturas', nuevo: 'Nueva factura' },
};
const LIMIT_SIMPLE = 400;      // límite general de la factura simplificada (IVA incluido)
const LIMIT_RETAIL = 3000;     // límite para ventas al por menor

export const ticketsView = (root, params, sub) => docsView(root, params, sub, 'ticket');
export const facturasView = (root, params, sub) => docsView(root, params, sub, 'factura');

function docsView(root, params, sub, kind) {
  if (sub === 'nueva') return editorView(root, params, kind);
  if (sub) return detailView(root, Number(sub));
  return listView(root, params, kind);
}

const fileName = (inv) => `${inv.kind === 'ticket' ? 'Ticket' : 'Factura'}-${inv.number}`;
const docHtml = (inv, fmt) => (fmt === 'ticket' ? ticket80(inv, state.settings) : invoiceA4(inv, state.settings));

function fiscalWarning() {
  const shop = state.settings.shop;
  const missing = [!shop.legal_name && 'nombre y apellidos del titular', !shop.nif && 'NIF'].filter(Boolean);
  if (!missing.length) return '';
  return `<div class="notice warn" style="margin-bottom:14px">${icon('warn')} Faltan tus datos fiscales (${missing.join(' y ')}): no aparecerán en el PDF.
    ${isAdmin() ? '<a href="#/ajustes?tab=tienda">Rellénalos en Ajustes → Tienda</a>.' : 'Avisa al administrador.'}</div>`;
}

// ------------------------------------------------------------------ listado
async function listView(root, params, kind) {
  const M = META[kind];
  root.innerHTML = `
    <div class="page-head"><div><h1>${M.many}</h1><div class="sub">${kind === 'ticket'
      ? 'Facturas simplificadas para el cliente de mostrador · serie ' + esc(state.settings.invoice.ticket_prefix || '(sin prefijo)')
      : 'Facturas completas con datos del cliente · serie ' + esc(state.settings.invoice.prefix || '(sin prefijo)')}</div></div>
      <span class="spacer"></span>
      <a class="btn btn-primary" href="#/${M.section}/nueva">${icon('plus')} ${M.nuevo}</a>
    </div>
    ${fiscalWarning()}
    <div class="card card-pad" style="margin-bottom:14px"><input type="search" data-q placeholder="Buscar por número, cliente, producto o IMEI…" value="${esc(params.get('q') || '')}"></div>
    <div class="card"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>`;
  const list = root.querySelector('[data-list]');
  async function load() {
    const q = root.querySelector('[data-q]').value.trim();
    let rows;
    try { rows = await api(`/invoices?kind=${kind}` + (q ? `&q=${encodeURIComponent(q)}` : '')); } catch (e) { toast(e.message, 'err'); return; }
    list.innerHTML = rows.length ? `<table class="t"><thead><tr><th>N.º</th><th>Fecha</th>${kind === 'factura' ? '<th>Cliente</th>' : ''}<th>Concepto</th><th class="r">Total</th><th>Emitido por</th><th>Estado</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="clickable ${r.voided ? 'deleted' : ''}" data-id="${r.id}">
        <td><b>${esc(r.number)}</b></td><td class="num">${fmtDate(r.date)}</td>
        ${kind === 'factura' ? `<td>${esc(r.customer_name || '—')}</td>` : ''}
        <td class="desc">${esc(r.items.map(i => i.description).join(', '))}</td>
        <td class="r num"><b>${money(r.total)}</b></td><td class="muted">${esc(r.user_name || '')}</td>
        <td class="muted" style="text-decoration:none">${r.voided ? '<span class="neg">Anulado</span>'
          : r.replaced_by_number ? `Convertido en factura ${esc(r.replaced_by_number)}`
          : r.replaces_number ? `Sustituye al ticket ${esc(r.replaces_number)}` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">Todavía no hay ${M.many.toLowerCase()}</div>`;
  }
  list.addEventListener('click', (e) => { const tr = e.target.closest('[data-id]'); if (tr) location.hash = `#/${M.section}/${tr.dataset.id}`; });
  root.querySelector('[data-q]').addEventListener('input', debounce(load, 300));
  await load();
}

// ------------------------------------------------------------------ detalle
async function detailView(root, id) {
  let inv;
  try { inv = await api(`/invoices/${id}`); } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const M = META[inv.kind];
  let fmt = inv.kind === 'ticket' ? (state.settings.invoice.ticket_format === 'a4' ? 'a4' : 'ticket') : 'a4';
  const canConvert = inv.kind === 'ticket' && !inv.voided && !inv.replaced_by_id && state.settings.modules.invoices;
  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="#/${M.section}" title="Volver">${icon('left')}</a>
      <div><h1>${M.One} ${esc(inv.number)}</h1><div class="sub">${fmtDate(inv.date)} · ${money(inv.total)} · emitido por ${esc(inv.user_name || '')}${inv.voided ? ' · <b class="neg">ANULADO</b>' : ''}</div></div>
      <span class="spacer"></span>
      <div class="seg" data-fmt><button data-v="a4">A4</button><button data-v="ticket">Ticket 80 mm</button></div>
      <button class="btn btn-primary" data-print>${icon('print')} Imprimir / Guardar PDF</button>
      ${canConvert ? `<a class="btn" href="#/facturas/nueva?desde_ticket=${inv.id}" title="El cliente pide factura con sus datos">${icon('swap')} Convertir en factura</a>` : ''}
      ${isAdmin() && !inv.voided ? `<button class="btn btn-danger" data-void>Anular</button>` : ''}
    </div>
    ${inv.replaced_by_id ? `<div class="notice" style="margin-bottom:14px">Este ticket se sustituyó por la <a href="#/facturas/${inv.replaced_by_id}">factura ${esc(inv.replaced_by_number)}</a>.</div>` : ''}
    <div class="notice" style="margin-bottom:14px">Para guardar en PDF: pulsa <b>Imprimir / Guardar PDF</b> y en "Destino" elige <b>Guardar como PDF</b>.</div>
    <div class="inv-preview-wrap" style="position:static"><div data-doc></div></div>`;
  const draw = () => {
    root.querySelectorAll('[data-fmt] button').forEach(b => b.classList.toggle('on', b.dataset.v === fmt));
    root.querySelector('[data-doc]').innerHTML = docHtml(inv, fmt);
  };
  draw();
  root.querySelector('[data-fmt]').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fmt = b.dataset.v; draw(); } });
  root.querySelector('[data-print]').addEventListener('click', () => printDocument(docHtml(inv, fmt), { format: fmt, filename: fileName(inv) }));
  const v = root.querySelector('[data-void]');
  if (v) v.addEventListener('click', async () => {
    if (!(await confirmDialog(`¿Anular ${inv.kind === 'ticket' ? 'este ticket' : 'esta factura'}? Seguirá guardado pero marcado como ANULADO (la numeración no se reutiliza). La venta en caja no se borra.`, { okText: 'Anular', danger: true }))) return;
    await api(`/invoices/${id}/void`, { method: 'POST' }); toast('Anulado'); detailView(root, id);
  });
}

// ------------------------------------------------------------------ editor
async function editorView(root, params, kind) {
  const s = state.settings, cfg = s.invoice, M = META[kind];
  const fromSale = params.get('venta');
  let fromTicket = null;
  if (kind === 'factura' && params.get('desde_ticket')) {
    try { fromTicket = await api(`/invoices/${Number(params.get('desde_ticket'))}`); } catch (e) { toast(e.message, 'err'); }
  }
  const draft = {
    kind, date: today(),
    customer_name: fromTicket?.customer_name || '', customer_nif: fromTicket?.customer_nif || '',
    customer_address: fromTicket?.customer_address || '', customer_phone: fromTicket?.customer_phone || '',
    items: fromTicket ? fromTicket.items.map(i => ({ ...i }))
      : [{ description: params.get('desc') || '', detail: '', qty: 1, price: params.get('precio') ? Number(params.get('precio')) : '', warranty: '' }],
    discount: fromTicket ? fromTicket.discount : 0,
    notes: fromTicket ? fromTicket.notes : '',
    show_vat: fromTicket ? fromTicket.show_vat : !!cfg.show_vat,
    replaces_number: fromTicket?.number, replaces_date: fromTicket?.date,
  };
  const nextNumber = kind === 'ticket' ? `${cfg.ticket_prefix || ''}${cfg.ticket_next_number}` : `${cfg.prefix || ''}${cfg.next_number}`;
  const saleCats = state.categories.filter(c => c.kind === 'sale' && c.active);
  const warrantyOptions = (selected) => ['', ...cfg.warranties.map(w => w.name)]
    .map(name => `<option value="${esc(name)}" ${name === selected ? 'selected' : ''}>${name ? 'Garantía: ' + esc(name) : 'Sin garantía'}</option>`).join('');
  const categoryFor = (description) => {
    const d = (description || '').toLowerCase();
    return saleCats.filter(c => d.startsWith(c.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  };
  const suggestWarranty = (item) => {
    if (item.warrantyChosen) return;
    const category = categoryFor(item.description);
    if (category && cfg.warranties.some(w => w.name === category.warranty)) item.warranty = category.warranty;
  };
  if (!fromTicket) draft.items.forEach(suggestWarranty);
  const req = kind === 'factura' ? ' <span class="neg">*</span>' : '';

  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="#/${M.section}" title="Volver">${icon('left')}</a>
      <div><h1>${M.nuevo}${fromTicket ? ` <span class="faint" style="font-weight:500">a partir del ticket ${esc(fromTicket.number)}</span>` : ''}</h1>
        <div class="sub">N.º previsto: ${esc(nextNumber)}</div></div>
    </div>
    ${fiscalWarning()}
    <div class="inv-layout">
      <div class="card card-pad">
        <form data-form autocomplete="off" style="display:flex;flex-direction:column;gap:14px">
          ${isAdmin() ? `<div class="row"><span class="spacer"></span><label class="row" style="gap:6px"><span class="muted">Fecha</span><input type="date" name="date" value="${draft.date}" style="width:auto"></label></div>` : ''}
          <details ${kind === 'factura' ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600">Datos del cliente ${kind === 'factura' ? '<span class="faint">(obligatorios en una factura completa)</span>' : '<span class="faint">(opcional)</span>'}</summary>
            <div class="settings-grid" style="margin-top:10px">
              <label class="field">Nombre y apellidos / Empresa${req}<input type="text" name="customer_name" value="${esc(draft.customer_name)}"></label>
              <label class="field">NIF / NIE / CIF${req}<input type="text" name="customer_nif" value="${esc(draft.customer_nif)}"></label>
              <label class="field">Dirección completa${req}<input type="text" name="customer_address" value="${esc(draft.customer_address)}"></label>
              <label class="field">Teléfono<input type="text" name="customer_phone" value="${esc(draft.customer_phone)}"></label>
            </div>
          </details>
          <div>
            <div class="row" style="margin-bottom:8px"><b>Líneas</b><span class="spacer"></span><span class="faint" style="font-size:12px">La 2ª línea es para IMEI / nº de serie</span></div>
            <div class="inv-lines" data-lines></div>
            <button type="button" class="btn btn-sm" data-add-line>${icon('plus')} Añadir línea</button>
          </div>
          <div class="settings-grid">
            <label class="field">Descuento (€)<input class="money" name="discount" inputmode="decimal" placeholder="0,00" value="${draft.discount ? moneyInput(draft.discount) : ''}"></label>
            <div class="field" style="justify-content:flex-end"><div class="muted" style="font-weight:600">Total</div><div style="font-size:26px;font-weight:750" class="num" data-total></div></div>
            <label class="field wide">Notas <span class="hint">opcional; la garantía se elige en cada línea</span><textarea name="notes" rows="2">${esc(draft.notes)}</textarea></label>
            <label class="check wide"><input type="checkbox" name="show_vat" ${draft.show_vat ? 'checked' : ''}><span><b>Desglosar IVA</b><span class="muted">Muestra base imponible e IVA (${esc(cfg.vat_rate)}%). Desactivado: solo el total con "IVA incluido". El precio no cambia.</span></span></label>
          </div>
          <div class="notice warn hidden" data-limit></div>
          ${fromTicket ? `<div class="notice">La factura indicará que sustituye al ticket ${esc(fromTicket.number)}. La venta ya está en caja, no se duplica.</div>`
            : fromSale ? `<div class="notice">Se vinculará a la venta ya registrada en caja (no se duplica la venta).</div>` : `
          <div class="card card-pad" style="background:var(--surface-2)">
            <label class="check"><input type="checkbox" name="register" checked><span><b>Registrar también como venta en la caja de hoy</b><span class="muted">Desmárcalo si ya apuntaste la venta.</span></span></label>
            <div class="settings-grid" data-register>
              <label class="field">Producto<select name="reg_category">${saleCats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
              <label class="field">Beneficio (€)<input class="money" name="reg_profit" inputmode="decimal" placeholder="0,00"></label>
              ${s.modules.payment_methods ? `<label class="field">Forma de pago<select name="reg_pm">${s.sales.payment_methods.map(p => `<option>${esc(p)}</option>`).join('')}</select></label>` : ''}
            </div>
          </div>`}
          <div class="row">
            <button class="btn btn-primary" type="submit">${icon('print')} Guardar e imprimir</button>
            <button class="btn" type="button" data-save-only>Solo guardar</button>
          </div>
        </form>
      </div>
      <div class="inv-preview-wrap"><div class="inv-preview-scale" data-preview></div></div>
    </div>`;

  const form = root.querySelector('[data-form]');
  const linesEl = root.querySelector('[data-lines]');
  const preview = root.querySelector('[data-preview]');
  const wrap = root.querySelector('.inv-preview-wrap');
  const fmt = kind === 'ticket' ? (cfg.ticket_format === 'a4' ? 'a4' : 'ticket') : 'a4';

  function drawLines() {
    linesEl.innerHTML = draft.items.map((it, i) => `
      <div class="line" data-i="${i}">
        <div class="stack">
          <input type="text" data-k="description" placeholder="Descripción (ej. Samsung Galaxy A16 128gb)" value="${esc(it.description)}">
          <input type="text" data-k="detail" placeholder="IMEI / nº de serie / detalle (opcional)" value="${esc(it.detail || '')}">
          <select data-k="warranty" title="Garantía de esta línea">${warrantyOptions(it.warranty || '')}</select>
        </div>
        <input type="number" min="1" data-k="qty" value="${esc(it.qty)}" title="Cantidad">
        <input type="text" class="num" data-k="price" inputmode="decimal" placeholder="Precio" value="${esc(it.price === '' ? '' : moneyInput(it.price))}" title="Precio unitario con IVA (€)">
        <button type="button" class="btn btn-ghost btn-icon" data-rm="${i}" title="Quitar" ${draft.items.length === 1 ? 'disabled' : ''}>${icon('trash')}</button>
      </div>`).join('');
  }
  const num = (v) => { const n = parseMoney(v); return Number.isFinite(n) ? n : (Number(v) || 0); };
  function current() {
    const items = draft.items.map(i => ({ ...i, qty: Number(i.qty) || 1, price: num(i.price) }));
    const subtotal = items.reduce((a, i) => a + i.qty * i.price, 0);
    const discount = num(form.elements.discount.value);
    const prefixNum = nextNumber;
    return {
      ...draft, number: prefixNum, items, subtotal, discount, total: Math.max(0, subtotal - discount),
      date: form.elements.date ? form.elements.date.value : draft.date,
      customer_name: form.elements.customer_name.value, customer_nif: form.elements.customer_nif.value,
      customer_address: form.elements.customer_address.value, customer_phone: form.elements.customer_phone.value,
      notes: form.elements.notes.value, show_vat: form.elements.show_vat.checked, created_at: new Date().toISOString().replace('T', ' '),
    };
  }
  function drawPreview() {
    const inv = current();
    root.querySelector('[data-total]').textContent = money(inv.total);
    const lim = root.querySelector('[data-limit]');
    if (kind === 'ticket' && inv.total > LIMIT_SIMPLE) {
      lim.classList.remove('hidden');
      lim.innerHTML = inv.total > LIMIT_RETAIL
        ? `Más de ${money(LIMIT_RETAIL)}: una factura simplificada no es válida para este importe. Haz una <a href="#/facturas/nueva">factura completa</a>.`
        : `Más de ${money(LIMIT_SIMPLE)}: la factura simplificada solo es válida hasta ${money(LIMIT_RETAIL)} en ventas al por menor. Si el cliente necesita deducirse el IVA, haz una factura completa.`;
    } else lim.classList.add('hidden');
    preview.innerHTML = docHtml(inv, fmt);
    const doc = preview.firstElementChild;
    const scale = Math.min(1, (wrap.clientWidth - 36) / doc.offsetWidth);
    preview.style.transform = `scale(${scale})`;
    preview.style.height = doc.offsetHeight * scale + 'px';
    preview.style.width = doc.offsetWidth + 'px';
  }

  linesEl.addEventListener('input', (e) => {
    const line = e.target.closest('[data-i]'); if (!line) return;
    const item = draft.items[Number(line.dataset.i)];
    item[e.target.dataset.k] = e.target.value;
    if (e.target.dataset.k === 'warranty') item.warrantyChosen = true;
    drawPreview();
  });
  linesEl.addEventListener('change', (e) => {
    const line = e.target.closest('[data-i]'); if (!line || e.target.dataset.k !== 'description') return;
    const item = draft.items[Number(line.dataset.i)];
    suggestWarranty(item);
    line.querySelector('[data-k=warranty]').value = item.warranty || '';
    drawPreview();
  });
  linesEl.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]'); if (!rm) return;
    draft.items.splice(Number(rm.dataset.rm), 1); drawLines(); drawPreview();
  });
  root.querySelector('[data-add-line]').addEventListener('click', () => { draft.items.push({ description: '', detail: '', qty: 1, price: '', warranty: '' }); drawLines(); drawPreview(); });
  form.addEventListener('input', drawPreview);
  const reg = form.elements.register;
  if (reg) reg.addEventListener('change', () => root.querySelector('[data-register]').classList.toggle('hidden', !reg.checked));
  if (form.elements.reg_category) linesEl.addEventListener('change', () => {
    const match = categoryFor(draft.items[0].description);
    if (match) form.elements.reg_category.value = match.id;
  });

  async function save(andPrint) {
    const inv = current();
    if (!inv.items.some(i => i.description.trim())) { toast('Escribe al menos una línea', 'err'); return; }
    if (kind === 'factura' && (!inv.customer_name.trim() || !inv.customer_nif.trim() || !inv.customer_address.trim())) {
      toast('Una factura completa necesita nombre, NIF y dirección del cliente', 'err');
      root.querySelector('details').open = true; form.elements.customer_name.focus(); return;
    }
    if (inv.total <= 0 && !(await confirmDialog('El total es 0 €. ¿Guardar igualmente?'))) return;
    const body = { ...inv, items: inv.items.filter(i => i.description.trim()) };
    delete body.number; delete body.replaces_number; delete body.replaces_date;
    if (fromTicket) body.replaces_id = fromTicket.id;
    else if (fromSale) body.movement_id = Number(fromSale);
    else if (reg && reg.checked) {
      const p = parseMoney(form.elements.reg_profit.value);
      if (!Number.isFinite(p)) { toast('Indica el beneficio de la venta (o desmarca "Registrar en caja")', 'err'); form.elements.reg_profit.focus(); return; }
      body.register = { category_id: Number(form.elements.reg_category.value), profit: p, payment_method: form.elements.reg_pm ? form.elements.reg_pm.value : '' };
    }
    try {
      const r = await api('/invoices', { method: 'POST', body });
      toast(`${M.One} ${r.number} guardado`, 'ok');
      if (kind === 'ticket') state.settings.invoice.ticket_next_number = Number(cfg.ticket_next_number) + 1;
      else state.settings.invoice.next_number = Number(cfg.next_number) + 1;
      location.hash = `#/${M.section}/${r.id}`;
      if (andPrint) {
        const saved = await api(`/invoices/${r.id}`);
        setTimeout(() => printDocument(docHtml(saved, fmt), { format: fmt, filename: fileName(saved) }), 300);
      }
    } catch (e) { toast(e.message, 'err'); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); save(true); });
  root.querySelector('[data-save-only]').addEventListener('click', () => save(false));

  drawLines(); drawPreview();
  const ro = new ResizeObserver(() => { if (document.body.contains(wrap)) drawPreview(); else ro.disconnect(); });
  ro.observe(wrap);
  linesEl.dispatchEvent(new Event('change'));
}
