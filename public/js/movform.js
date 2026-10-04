// Formulario de venta / gasto (se usa en la Caja y al editar desde Movimientos)
import { api, state, esc, icon, toast, parseMoney, moneyInput, money, can, isAdmin, today } from './core.js';

/**
 * opts: { type: 'sale'|'expense', movement?: {...}, allowDate?: bool, date?: iso,
 *         onSaved(result), onCancel(), modalMode?: bool }
 */
export function mountMovementForm(container, opts) {
  const { type, movement } = opts;
  const isSale = type === 'sale';
  const cfg = state.settings.sales;
  const usePM = state.settings.modules.payment_methods && cfg.ask_payment_method;
  const cats = state.categories.filter(c => c.kind === type && (c.active || (movement && c.id === movement.category_id)));
  const profitMode = cfg.profit_input || 'both';
  const showInvoiceBtn = isSale && !movement && state.settings.modules.invoices && can('worker_create_invoices');
  let selected = movement ? movement.category_id : null;
  let pm = movement ? movement.payment_method : (cfg.payment_methods[0] || '');
  let lastEdited = 'profit';

  container.innerHTML = `
  <div class="entry ${type}">
    <div class="row" style="margin-bottom:10px">
      <h3 style="margin:0">${movement ? (isSale ? 'Editar venta' : 'Editar gasto') : (isSale ? 'Nueva venta' : 'Nuevo gasto')}</h3>
      <span class="spacer"></span>
      ${opts.modalMode ? '' : `<button class="btn btn-ghost btn-icon" data-cancel title="Cerrar (Esc)">${icon('x')}</button>`}
    </div>
    <input type="search" data-search placeholder="${isSale ? 'Buscar producto… (escribe y pulsa Enter)' : 'Buscar motivo de gasto…'}" autocomplete="off" style="margin-bottom:10px">
    <div class="cat-grid" data-cats></div>
    <form data-form autocomplete="off" novalidate>
      <div class="fields">
        <label class="field">${isSale ? 'Precio de venta' : 'Importe del gasto'} (€)
          <input class="money" name="amount" inputmode="decimal" placeholder="0,00" value="${movement ? moneyInput(movement.amount) : ''}">
        </label>
        ${isSale && profitMode !== 'profit' ? `<label class="field">Coste (€) <span class="hint">lo que te costó a ti</span>
          <input class="money" name="cost" inputmode="decimal" placeholder="0,00" value="${movement && movement.profit !== undefined ? moneyInput(movement.amount - movement.profit) : ''}">
        </label>` : ''}
        ${isSale && profitMode !== 'cost' ? `<label class="field">Beneficio (€) <span class="hint">lo que ganas</span>
          <input class="money" name="profit" inputmode="decimal" placeholder="0,00" value="${movement && movement.profit !== undefined ? moneyInput(movement.profit) : ''}">
        </label>` : ''}
        ${usePM ? `<label class="field ${isSale && profitMode === 'both' ? 'wide' : ''}">Forma de pago
          <div class="seg" data-pm>${cfg.payment_methods.map(p => `<button type="button" data-v="${esc(p)}" class="${p === pm ? 'on' : ''}">${esc(p)}</button>`).join('')}</div>
        </label>` : ''}
        ${opts.allowDate ? `<label class="field">Fecha <input type="date" name="date" value="${esc(movement ? movement.date : (opts.date || today()))}"></label>` : ''}
        <label class="field wide">Descripción <span class="hint">${isSale ? 'opcional: modelo, IMEI, cliente…' : 'ej.: 3 iPhone 13 al proveedor X'}</span>
          <input type="text" name="description" maxlength="300" value="${esc(movement ? movement.description : '')}">
        </label>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary" type="submit" data-save>${movement ? 'Guardar cambios' : (isSale ? 'Guardar venta' : 'Guardar gasto')} <span class="faint" style="color:#fff;opacity:.7;font-weight:500">↵</span></button>
        ${showInvoiceBtn ? `<button class="btn" type="button" data-save-doc="ticket">${icon('receipt')} Guardar y hacer ticket</button>
                            <button class="btn" type="button" data-save-doc="factura">${icon('invoice')} Guardar y hacer factura</button>` : ''}
        <span class="spacer"></span>
        <span class="muted" data-summary></span>
      </div>
    </form>
  </div>`;

  const $ = (s) => container.querySelector(s);
  const form = $('[data-form]');
  const search = $('[data-search]');
  const f = (n) => form.elements.namedItem(n);

  function renderCats() {
    const q = search.value.trim().toLowerCase();
    const list = q ? cats.filter(c => c.name.toLowerCase().includes(q)) : cats;
    $('[data-cats]').innerHTML = list.length ? list.map(c =>
      `<button type="button" class="cat-btn ${c.id === selected ? 'on' : ''}" data-id="${c.id}" style="--c:${esc(c.color)}">${esc(c.name)}</button>`).join('')
      : `<span class="faint">No hay coincidencias. ${isAdmin() ? 'Puedes crear la categoría en Ajustes.' : ''}</span>`;
  }

  function choose(id) {
    selected = id;
    const c = cats.find(x => x.id === id);
    if (c && !movement) {
      if (c.default_price != null && !f('amount').value) f('amount').value = moneyInput(c.default_price);
      if (isSale && c.default_profit != null) {
        if (f('profit') && !f('profit').value) f('profit').value = moneyInput(c.default_profit);
        sync('profit');
      }
    }
    renderCats(); updateSummary();
    f('amount').focus(); f('amount').select();
  }

  function sync(source) {
    if (!isSale) return;
    const price = parseMoney(f('amount').value);
    const costEl = f('cost'), profitEl = f('profit');
    if (source === 'cost' || source === 'profit') lastEdited = source;
    if (!Number.isFinite(price)) return;
    if (costEl && profitEl) {
      if (lastEdited === 'cost' && source !== 'profit') {
        const c = parseMoney(costEl.value); if (Number.isFinite(c)) profitEl.value = moneyInput(price - c);
      } else {
        const p = parseMoney(profitEl.value); if (Number.isFinite(p)) costEl.value = moneyInput(price - p);
      }
    }
  }

  function getProfit() {
    const price = parseMoney(f('amount').value);
    if (f('profit')) return parseMoney(f('profit').value);
    if (f('cost')) return price - parseMoney(f('cost').value);
    return NaN;
  }

  function updateSummary() {
    const c = cats.find(x => x.id === selected);
    const price = parseMoney(f('amount').value);
    const el = $('[data-summary]');
    if (!c) { el.textContent = isSale ? 'Elige un producto' : 'Elige un motivo'; return; }
    let txt = `${c.name}${Number.isFinite(price) ? ' · ' + money(price) : ''}`;
    const p = getProfit();
    if (isSale && Number.isFinite(p) && Number.isFinite(price) && price > 0) txt += ` · margen ${Math.round((p / price) * 100)}%`;
    el.textContent = txt;
  }

  async function save(docKind = null) {
    if (!selected) { toast(isSale ? 'Elige el producto vendido' : 'Elige el motivo del gasto', 'err'); search.focus(); return; }
    const amount = parseMoney(f('amount').value);
    if (!Number.isFinite(amount) || amount <= 0) { toast('Escribe un importe válido', 'err'); f('amount').focus(); return; }
    const body = {
      type, category_id: selected, amount, description: f('description').value, payment_method: usePM ? pm : '',
    };
    if (isSale) {
      const p = getProfit();
      if (!Number.isFinite(p)) { toast('Indica el beneficio o el coste', 'err'); (f('profit') || f('cost')).focus(); return; }
      if (p < 0 && !confirm('El beneficio es negativo (vendes por debajo del coste). ¿Guardar igualmente?')) return;
      body.profit = p;
    }
    if (f('date')) body.date = f('date').value;
    const btn = $('[data-save]'); btn.disabled = true;
    try {
      const r = movement
        ? await api(`/movements/${movement.id}`, { method: 'PUT', body })
        : await api('/movements', { method: 'POST', body });
      const c = cats.find(x => x.id === selected);
      toast(`${movement ? 'Guardado' : (isSale ? 'Venta guardada' : 'Gasto guardado')}: ${c.name} ${money(amount)}`, 'ok');
      const savedId = movement ? movement.id : r.id;
      if (!movement && !opts.modalMode) {
        // listo para la siguiente venta
        selected = null; form.reset(); search.value = ''; renderCats(); updateSummary(); search.focus();
      }
      opts.onSaved && opts.onSaved({ id: savedId, docKind, body, category: c });
    } catch (e) { toast(e.message, 'err'); }
    finally { btn.disabled = false; }
  }

  // eventos
  search.addEventListener('input', renderCats);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = container.querySelector('.cat-btn'); if (first) choose(Number(first.dataset.id));
    } else if (e.key === 'Escape' && !opts.modalMode) opts.onCancel && opts.onCancel();
  });
  $('[data-cats]').addEventListener('click', (e) => { const b = e.target.closest('.cat-btn'); if (b) choose(Number(b.dataset.id)); });
  form.addEventListener('input', (e) => { if (['amount', 'cost', 'profit'].includes(e.target.name)) sync(e.target.name); updateSummary(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); save(null); });
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !opts.modalMode) opts.onCancel && opts.onCancel(); });
  const pmEl = $('[data-pm]');
  if (pmEl) pmEl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    pm = b.dataset.v; pmEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  container.querySelectorAll('[data-save-doc]').forEach(b => b.addEventListener('click', () => save(b.dataset.saveDoc)));
  const cancel = $('[data-cancel]'); if (cancel) cancel.addEventListener('click', () => opts.onCancel && opts.onCancel());

  renderCats(); updateSummary();
  setTimeout(() => (movement ? f('amount') : search).focus(), 30);
  return { save };
}
