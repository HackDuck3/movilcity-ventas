// Sale / expense form, used in the cash register and when editing from Movements.
import { api, state, esc, icon, toast, parseMoney, moneyInput, money, can, isAdmin, today, on } from './core.js';

const TEXT = {
  sale: {
    newTitle: 'Nueva venta', editTitle: 'Editar venta', save: 'Guardar venta', saved: 'Venta guardada',
    amount: 'Precio de venta', search: 'Buscar producto… (escribe y pulsa Enter)',
    descriptionHint: 'opcional: modelo, IMEI, cliente…', choose: 'Elige un producto', missing: 'Elige el producto vendido',
  },
  expense: {
    newTitle: 'Nuevo gasto', editTitle: 'Editar gasto', save: 'Guardar gasto', saved: 'Gasto guardado',
    amount: 'Importe del gasto', search: 'Buscar motivo de gasto…',
    descriptionHint: 'ej.: 3 iPhone 13 al proveedor X', choose: 'Elige un motivo', missing: 'Elige el motivo del gasto',
  },
};

/**
 * options: {
 *   type: 'sale' | 'expense',
 *   movement,     existing movement when editing
 *   allowDate,    show the date field (admins)
 *   date,         initial date for a new movement
 *   modalMode,    the form lives inside a modal: no close button, no reset after saving
 *   onSaved({ id, documentKind, body, category }),
 *   onCancel(),
 * }
 */
export function mountMovementForm(container, options) {
  const { type, movement, modalMode } = options;
  const isSale = type === 'sale';
  const isEditing = !!movement;
  const text = TEXT[type];
  const salesConfig = state.settings.sales;
  const asksPaymentMethod = state.settings.modules.payment_methods && salesConfig.ask_payment_method;
  // 'both' shows cost and profit (each fills in the other), 'profit' or 'cost' shows only that one.
  const profitInput = salesConfig.profit_input || 'both';
  const showCost = isSale && profitInput !== 'profit';
  const showProfit = isSale && profitInput !== 'cost';
  const canMakeDocument = isSale && !isEditing && state.settings.modules.invoices && can('worker_create_invoices');
  const categories = state.categories.filter(category =>
    category.kind === type && (category.active || (isEditing && category.id === movement.category_id)));

  let selectedCategoryId = isEditing ? movement.category_id : null;
  let paymentMethod = isEditing ? movement.payment_method : salesConfig.payment_methods[0] || '';
  let lastEditedField = 'profit';

  const initial = {
    amount: isEditing ? moneyInput(movement.amount) : '',
    cost: isEditing && movement.profit !== undefined ? moneyInput(movement.amount - movement.profit) : '',
    profit: isEditing && movement.profit !== undefined ? moneyInput(movement.profit) : '',
    date: isEditing ? movement.date : options.date || today(),
    description: isEditing ? movement.description : '',
  };

  const moneyField = (name, label, hint, value) => `
    <label class="field">${label} (€)${hint ? ` <span class="hint">${hint}</span>` : ''}
      <input class="money" name="${name}" inputmode="decimal" placeholder="0,00" value="${value}">
    </label>`;

  const paymentButtons = salesConfig.payment_methods.map(method =>
    `<button type="button" data-method="${esc(method)}" class="${method === paymentMethod ? 'on' : ''}">${esc(method)}</button>`).join('');

  container.innerHTML = `
    <div class="entry ${type}">
      <div class="row" style="margin-bottom:10px">
        <h3 style="margin:0">${isEditing ? text.editTitle : text.newTitle}</h3>
        <span class="spacer"></span>
        ${modalMode ? '' : `<button class="btn btn-ghost btn-icon" data-cancel title="Cerrar (Esc)">${icon('x')}</button>`}
      </div>
      <input type="search" data-search placeholder="${text.search}" autocomplete="off" style="margin-bottom:10px">
      <div class="cat-grid" data-categories></div>
      <form data-form autocomplete="off" novalidate>
        <div class="fields">
          ${moneyField('amount', text.amount, '', initial.amount)}
          ${showCost ? moneyField('cost', 'Coste', 'lo que te costó a ti', initial.cost) : ''}
          ${showProfit ? moneyField('profit', 'Beneficio', 'lo que ganas', initial.profit) : ''}
          ${asksPaymentMethod ? `
            <label class="field ${showCost && showProfit ? 'wide' : ''}">Forma de pago
              <div class="seg" data-payment-methods>${paymentButtons}</div>
            </label>` : ''}
          ${options.allowDate ? `<label class="field">Fecha <input type="date" name="date" value="${esc(initial.date)}"></label>` : ''}
          <label class="field wide">Descripción <span class="hint">${text.descriptionHint}</span>
            <input type="text" name="description" maxlength="300" value="${esc(initial.description)}">
          </label>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-primary" type="submit" data-save>
            ${isEditing ? 'Guardar cambios' : text.save} <span style="opacity:.7;font-weight:500">↵</span>
          </button>
          ${canMakeDocument ? `
            <button class="btn" type="button" data-save-and-make="ticket">${icon('receipt')} Guardar y hacer ticket</button>
            <button class="btn" type="button" data-save-and-make="factura">${icon('invoice')} Guardar y hacer factura</button>` : ''}
          <span class="spacer"></span>
          <span class="muted" data-summary></span>
        </div>
      </form>
    </div>`;

  const form = container.querySelector('[data-form]');
  const search = container.querySelector('[data-search]');
  const categoryGrid = container.querySelector('[data-categories]');
  const field = (name) => form.elements.namedItem(name);
  const readMoney = (name) => (field(name) ? parseMoney(field(name).value) : NaN);
  const selectedCategory = () => categories.find(category => category.id === selectedCategoryId);

  function renderCategories() {
    const query = search.value.trim().toLowerCase();
    const matches = query ? categories.filter(category => category.name.toLowerCase().includes(query)) : categories;
    if (!matches.length) {
      categoryGrid.innerHTML = `<span class="faint">No hay coincidencias. ${isAdmin() ? 'Puedes crear la categoría en Ajustes.' : ''}</span>`;
      return;
    }
    categoryGrid.innerHTML = matches.map(category => `
      <button type="button" class="cat-btn ${category.id === selectedCategoryId ? 'on' : ''}"
              data-category="${category.id}" style="--c:${esc(category.color)}">${esc(category.name)}</button>`).join('');
  }

  function selectCategory(id) {
    selectedCategoryId = id;
    const category = selectedCategory();
    if (category && !isEditing) fillSuggestedValues(category);
    renderCategories();
    renderSummary();
    field('amount').focus();
    field('amount').select();
  }

  function fillSuggestedValues(category) {
    if (category.default_price != null && !field('amount').value) field('amount').value = moneyInput(category.default_price);
    if (!isSale || category.default_profit == null) return;
    if (field('profit') && !field('profit').value) field('profit').value = moneyInput(category.default_profit);
    syncCostAndProfit('profit');
  }

  // With both fields visible, editing one recalculates the other from the price.
  function syncCostAndProfit(editedField) {
    if (editedField === 'cost' || editedField === 'profit') lastEditedField = editedField;
    const price = readMoney('amount');
    if (!showCost || !showProfit || !Number.isFinite(price)) return;
    const [source, target] = lastEditedField === 'cost' ? ['cost', 'profit'] : ['profit', 'cost'];
    const value = readMoney(source);
    if (Number.isFinite(value)) field(target).value = moneyInput(price - value);
  }

  function currentProfit() {
    if (showProfit) return readMoney('profit');
    return readMoney('amount') - readMoney('cost');
  }

  function renderSummary() {
    const summary = container.querySelector('[data-summary]');
    const category = selectedCategory();
    if (!category) {
      summary.textContent = text.choose;
      return;
    }
    const price = readMoney('amount');
    const profit = isSale ? currentProfit() : NaN;
    const parts = [category.name];
    if (Number.isFinite(price)) parts.push(money(price));
    if (Number.isFinite(profit) && price > 0) parts.push(`margen ${Math.round((profit / price) * 100)}%`);
    summary.textContent = parts.join(' · ');
  }

  // Returns the request body, or null after telling the user what is missing.
  function readForm() {
    if (!selectedCategoryId) {
      toast(text.missing, 'err');
      search.focus();
      return null;
    }
    const amount = readMoney('amount');
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Escribe un importe válido', 'err');
      field('amount').focus();
      return null;
    }
    const body = {
      type, amount,
      category_id: selectedCategoryId,
      description: field('description').value,
      payment_method: asksPaymentMethod ? paymentMethod : '',
    };
    if (field('date')) body.date = field('date').value;
    if (!isSale) return body;

    const profit = currentProfit();
    if (!Number.isFinite(profit)) {
      toast('Indica el beneficio o el coste', 'err');
      (field('profit') || field('cost')).focus();
      return null;
    }
    if (profit < 0 && !confirm('El beneficio es negativo (vendes por debajo del coste). ¿Guardar igualmente?')) return null;
    return { ...body, profit };
  }

  function resetForNextEntry() {
    selectedCategoryId = null;
    form.reset();
    search.value = '';
    renderCategories();
    renderSummary();
    search.focus();
  }

  // documentKind: 'ticket' | 'factura' when the user also wants a document for this sale.
  async function save(documentKind = null) {
    const body = readForm();
    if (!body) return;
    const saveButton = container.querySelector('[data-save]');
    saveButton.disabled = true;
    try {
      const result = isEditing
        ? await api(`/movements/${movement.id}`, { method: 'PUT', body })
        : await api('/movements', { method: 'POST', body });
      const category = selectedCategory();
      toast(`${isEditing ? 'Guardado' : text.saved}: ${category.name} ${money(body.amount)}`, 'ok');
      if (!isEditing && !modalMode) resetForNextEntry();
      options.onSaved?.({ id: isEditing ? movement.id : result.id, documentKind, body, category });
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      saveButton.disabled = false;
    }
  }

  const cancel = () => { if (!modalMode) options.onCancel?.(); };

  search.addEventListener('input', renderCategories);
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const firstMatch = categoryGrid.querySelector('.cat-btn');
    if (firstMatch) selectCategory(Number(firstMatch.dataset.category));
  });
  container.addEventListener('keydown', (event) => { if (event.key === 'Escape') cancel(); });
  on(container, 'click', '[data-cancel]', cancel);
  on(container, 'click', '.cat-btn', (button) => selectCategory(Number(button.dataset.category)));
  on(container, 'click', '[data-save-and-make]', (button) => save(button.dataset.saveAndMake));
  on(container, 'click', '[data-method]', (button) => {
    paymentMethod = button.dataset.method;
    container.querySelectorAll('[data-method]').forEach(other => other.classList.toggle('on', other === button));
  });
  form.addEventListener('input', (event) => {
    if (['amount', 'cost', 'profit'].includes(event.target.name)) syncCostAndProfit(event.target.name);
    renderSummary();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });

  renderCategories();
  renderSummary();
  setTimeout(() => (isEditing ? field('amount') : search).focus(), 30);
}
