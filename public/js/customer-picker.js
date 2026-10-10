// Suggests customers already on file while a name, NIF or phone is typed, and fills in the rest of their details.
import { state, esc, debounce, tryApi } from './core.js';

const MIN_QUERY_LENGTH = 2;
const SUGGESTIONS = 6;
const SEARCHABLE = ['name', 'nif', 'phone'];

// fieldNames maps a customer's field to the name of its input in the form:
// { name: 'customer_name', nif: 'customer_nif', phone: 'customer_phone', address: 'customer_address', … }
export function attachCustomerPicker(form, fieldNames) {
  if (!state.settings.modules.customers) return;
  const searchableInputs = SEARCHABLE.map(field => fieldNames[field]).filter(Boolean);
  const list = document.createElement('div');
  list.className = 'suggest hidden';
  let customers = [];
  let activeInput = null;

  const hide = () => list.classList.add('hidden');

  function show(input) {
    if (!customers.length) return hide();
    list.innerHTML = customers.map((customer, index) => `
      <button type="button" data-customer="${index}">
        <b>${esc(customer.name || customer.phone)}</b>
        <span>${esc([customer.nif, customer.name && customer.phone, customer.city].filter(Boolean).join(' · '))}</span>
      </button>`).join('');
    input.closest('label').append(list);
    list.classList.remove('hidden');
  }

  const search = debounce(async (input) => {
    const query = input.value.trim();
    if (query.length < MIN_QUERY_LENGTH) return hide();
    const found = await tryApi(`/customers?limit=${SUGGESTIONS}&q=${encodeURIComponent(query)}`);
    if (!found || input !== activeInput || input.value.trim() !== query) return;
    customers = found;
    show(input);
  }, 250);

  function fill(customer) {
    for (const [field, inputName] of Object.entries(fieldNames)) {
      const input = form.elements[inputName];
      if (input && customer[field]) input.value = customer[field];
    }
    hide();
    form.dispatchEvent(new Event('input', { bubbles: true }));
  }

  form.addEventListener('input', (event) => {
    if (!searchableInputs.includes(event.target.name)) return;
    activeInput = event.target;
    search(event.target);
  });
  form.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  form.addEventListener('focusout', () => setTimeout(() => { if (!list.contains(document.activeElement)) hide(); }, 150));
  // mousedown, not click: it fires before the input loses focus and the list closes.
  list.addEventListener('mousedown', (event) => {
    const button = event.target.closest('[data-customer]');
    if (!button) return;
    event.preventDefault();
    fill(customers[Number(button.dataset.customer)]);
  });
}
