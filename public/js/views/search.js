// One search box for tickets, invoices, repairs, stock and (for admins) movements.
import { api, esc, icon, money, fmtDate, debounce, tryApi } from '../core.js';

const MIN_QUERY_LENGTH = 2;
const REPAIR_STAGES = { pending: 'En reparación', ready: 'Lista para recoger', collected: 'Recogida' };

// How each group of results is titled and where each result links to.
const SECTIONS = [
  {
    key: 'repairs', title: 'Reparaciones', icon: 'wrench',
    url: (repair) => `#/reparaciones/${repair.id}`,
    label: (repair) => `Reparación ${repair.number}`,
    note: (repair) => (repair.voided ? 'Anulada' : REPAIR_STAGES[repair.stage]),
  },
  {
    key: 'invoices', title: 'Tickets y facturas', icon: 'receipt',
    url: (invoice) => `#/${invoice.kind === 'ticket' ? 'tickets' : 'facturas'}/${invoice.id}`,
    label: (invoice) => `${invoice.kind === 'ticket' ? 'Ticket' : 'Factura'} ${invoice.number}`,
    note: (invoice) => (invoice.voided ? 'Anulado' : ''),
  },
  {
    key: 'stock', title: 'Stock de móviles', icon: 'phone',
    url: () => '#/stock',
    label: (device) => (device.sold ? 'Vendido' : 'En stock'),
    note: () => '',
  },
  {
    key: 'purchases', title: 'Compras de segunda mano', icon: 'swap',
    url: (purchase) => `#/compras/${purchase.id}`,
    label: (purchase) => `Compra ${purchase.number}`,
    note: (purchase) => (purchase.voided ? 'Anulada' : ''),
  },
  {
    key: 'movements', title: 'Ventas y gastos', icon: 'list',
    url: (movement) => (movement.invoice_id ? `#/facturas/${movement.invoice_id}` : `#/caja?fecha=${movement.date}`),
    label: (movement) => (movement.type === 'sale' ? 'Venta' : 'Gasto'),
    note: () => '',
  },
];

function sectionHtml(section, results) {
  if (!results.length) return '';
  const row = (result) => `
    <tr class="clickable" data-url="${esc(section.url(result))}">
      <td style="white-space:nowrap"><b>${esc(section.label(result))}</b></td>
      <td class="num muted">${result.date ? fmtDate(result.date) : ''}</td>
      <td>${esc(result.title || '—')}${result.customer ? `<div class="desc">${esc(result.customer)}</div>` : ''}</td>
      <td class="muted">${esc(section.note(result))}</td>
      <td class="r num">${result.amount == null ? '' : money(result.amount)}</td>
    </tr>`;
  return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><h3>${icon(section.icon)} ${section.title}</h3><span class="count">(${results.length})</span></div>
      <div class="table-wrap"><table class="t"><tbody>${results.map(row).join('')}</tbody></table></div>
    </div>`;
}

// ---- Verification codes
const CODE_LENGTH = 12;
const lettersAndDigits = (text) => text.replace(/[^0-9a-z]/gi, '');
const couldBeCode = (query) => lettersAndDigits(query).length === CODE_LENGTH;
// Typed with its dashes it is clearly meant as a code, so a miss deserves a warning and not just "nothing found".
const isWrittenAsCode = (query) => /^\w{4}[-\s]\w{4}[-\s]\w{4}$/.test(query);

function verifiedHtml(document) {
  const kind = document.kind === 'ticket' ? 'Ticket' : 'Factura';
  const url = `#/${document.kind === 'ticket' ? 'tickets' : 'facturas'}/${document.id}`;
  return `
    <div class="card card-pad verification-result ok" style="margin-bottom:14px">
      <h3>${icon('check')} Código auténtico: ${kind} ${esc(document.number)}${document.voided ? ' <span class="neg">(ANULADO)</span>' : ''}</h3>
      <p class="muted" style="margin:4px 0 10px">Compara estos datos con el papel. Si no coinciden, el papel ha sido modificado.</p>
      <div class="settings-grid">
        <div><span class="muted">Fecha</span><br><b>${fmtDate(document.date)}</b></div>
        <div><span class="muted">Total</span><br><b>${money(document.total)}</b></div>
        <div><span class="muted">Cliente</span><br><b>${esc(document.customer_name || '—')}${document.customer_nif ? ` · ${esc(document.customer_nif)}` : ''}</b></div>
        <div><span class="muted">Concepto</span><br><b>${esc(document.items.join(', '))}</b></div>
      </div>
      ${document.can_open ? `<a class="btn" href="${url}" style="margin-top:12px">${icon('eye')} Abrir el documento y comparar el dibujo</a>` : ''}
    </div>`;
}

const NOT_VERIFIED_HTML = `
  <div class="card card-pad verification-result bad" style="margin-bottom:14px">
    <h3>${icon('warn')} Este código no corresponde a ningún documento de la tienda</h3>
    <p class="muted" style="margin:4px 0 0">Revisa que esté bien escrito. Si lo está, el documento no lo ha emitido esta tienda.</p>
  </div>`;

async function verificationHtml(query) {
  if (!couldBeCode(query)) return '';
  try {
    return verifiedHtml(await api(`/verify/${encodeURIComponent(lettersAndDigits(query))}`));
  } catch {
    return isWrittenAsCode(query) ? NOT_VERIFIED_HTML : '';
  }
}

export async function searchView(root, params) {
  root.innerHTML = `
    <div class="page-head"><div><h1>Buscar</h1><div class="sub">Tickets, facturas, reparaciones, stock y movimientos en un solo sitio. También comprueba códigos de verificación.</div></div></div>
    <div class="card card-pad" style="margin-bottom:14px">
      <input type="search" data-search placeholder="Nombre, teléfono, IMEI, modelo, número o código de verificación…" value="${esc(params.get('q') || '')}">
    </div>
    <div data-results></div>`;

  const input = root.querySelector('[data-search]');
  const resultsContainer = root.querySelector('[data-results]');

  async function search() {
    const query = input.value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      resultsContainer.innerHTML = '<div class="empty">Escribe al menos 2 letras o números</div>';
      return;
    }
    const [found, verification] = await Promise.all([tryApi(`/search?q=${encodeURIComponent(query)}`), verificationHtml(query)]);
    if (!found || input.value.trim() !== query) return; // a newer search is already on its way
    const html = verification + SECTIONS.map(section => sectionHtml(section, found[section.key] || [])).join('');
    resultsContainer.innerHTML = html || '<div class="empty">No se ha encontrado nada</div>';
  }

  input.addEventListener('input', debounce(search, 300));
  resultsContainer.addEventListener('click', (event) => {
    const row = event.target.closest('[data-url]');
    if (row) location.hash = row.dataset.url;
  });
  setTimeout(() => input.focus(), 30);
  await search();
}
