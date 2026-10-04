// Plantillas de factura (A4) y ticket (80 mm) + impresión / guardar como PDF.
import { esc, money, fmtDate, fmtTime } from './core.js';

function shopLines(shop) {
  return [shop.legal_name, shop.nif ? `NIF: ${shop.nif}` : '', shop.address1, shop.address2, shop.phone, shop.email]
    .filter(Boolean).map(esc).join('<br>');
}
const replacesText = (inv) => inv.replaces_number
  ? `Esta factura sustituye a la factura simplificada nº ${inv.replaces_number}${inv.replaces_date ? ' de ' + fmtDate(inv.replaces_date) : ''}.` : '';

function vatBreakdown(total, cfg) {
  if (!cfg.show_vat) return null;
  const rate = Number(cfg.vat_rate) || 0;
  const base = Math.round((total / (1 + rate / 100)) * 100) / 100;
  return { rate, base, vat: Math.round((total - base) * 100) / 100 };
}

export function invoiceA4(inv, settings) {
  const { shop, invoice: cfg } = settings;
  const title = inv.kind === 'ticket' ? (cfg.ticket_title || 'Ticket') : (cfg.title || 'Factura');
  const rows = [];
  for (const it of inv.items) {
    const qty = Number(it.qty) || 1, price = Number(it.price) || 0;
    rows.push(`<tr><td>${esc(it.description)}</td><td class="r">${qty}</td><td class="r unit">${money(price)}</td><td class="r tot">${money(qty * price)}</td></tr>`);
    if (it.detail) rows.push(`<tr><td class="detail" colspan="4">${esc(it.detail)}</td></tr>`);
  }
  const minRows = Math.max(Number(cfg.min_rows) || 0, 0) + 2;
  while (rows.length < minRows) rows.push('<tr><td colspan="4">&nbsp;</td></tr>');
  const vat = vatBreakdown(inv.total, cfg);
  const customer = [inv.customer_name, inv.customer_nif ? `NIF: ${inv.customer_nif}` : '', inv.customer_address, inv.customer_phone]
    .filter(Boolean).map(esc).join('<br>');
  const warranty = [replacesText(inv), inv.notes].filter(Boolean).map(esc).join('\n');

  return `<div class="invoice-doc">
    ${inv.voided ? '<div class="void-stamp">ANULADA</div>' : ''}
    ${shop.logo ? `<img class="shop-logo" src="${shop.logo}" alt="">` : ''}
    <h2 class="shop-name" style="color:${esc(cfg.color_shop)}">${esc(shop.name)}</h2>
    <div class="shop-lines">${shopLines(shop)}</div>
    <div class="doc-title" style="color:${esc(cfg.color_title)}">${esc(title)}</div>
    <div class="doc-date" style="color:${esc(cfg.color_accent)}">${fmtDate(inv.date)}</div>
    <div class="meta">
      <div>${customer ? `<h4>Cliente</h4>${customer}` : ''}</div>
      <div><h4>N.º de ${inv.kind === 'ticket' ? 'ticket' : 'factura'}</h4>${esc(inv.number || '—')}</div>
    </div>
    <table class="lines">
      <thead style="color:${esc(cfg.color_title)}"><tr>
        <th>Descripción</th><th class="r" style="width:90px">Cantidad</th><th class="r" style="width:130px">Precio unitario</th><th class="r" style="width:110px">Precio total</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <div class="bottom">
      <div class="warranty">${warranty}</div>
      <div class="sums">
        <div class="tr"><span>Subtotal</span><b class="num">${money(inv.subtotal)}</b></div>
        <div class="tr"><span style="color:${esc(cfg.color_title)}">Descuento</span><b class="num">${money(inv.discount)}</b></div>
        ${vat ? `<div class="tr"><span>Base imponible</span><b class="num">${money(vat.base)}</b></div>
                 <div class="tr"><span>IVA (${vat.rate}%) incluido</span><b class="num">${money(vat.vat)}</b></div>` : ''}
        <div class="total num" style="color:${esc(cfg.color_accent)}">${money(inv.total)}</div>
      </div>
    </div>
    ${cfg.footer ? `<div class="footer-text">${esc(cfg.footer)}</div>` : ''}
  </div>`;
}

export function ticket80(inv, settings) {
  const { shop, invoice: cfg } = settings;
  const vat = vatBreakdown(inv.total, cfg);
  const items = inv.items.map(it => {
    const qty = Number(it.qty) || 1, price = Number(it.price) || 0;
    return `<div>${esc(it.description)}</div>
      ${it.detail ? `<div style="font-size:11px">${esc(it.detail)}</div>` : ''}
      <div class="tl"><span>${qty} x ${money(price)}</span><span>${money(qty * price)}</span></div>`;
  }).join('');
  return `<div class="ticket-doc">
    ${shop.logo ? `<img class="logo" src="${shop.logo}" alt="">` : ''}
    <div class="c"><h2>${esc(shop.name)}</h2>${shopLines(shop)}</div>
    <hr>
    <div class="tl"><b>${esc(inv.kind === 'ticket' ? (cfg.ticket_title || 'Ticket') : (cfg.title || 'Factura'))} ${esc(inv.number || '')}</b><span>${fmtDate(inv.date)} ${fmtTime(inv.created_at)}</span></div>
    ${inv.customer_name ? `<div>Cliente: ${esc(inv.customer_name)}${inv.customer_nif ? ' · ' + esc(inv.customer_nif) : ''}</div>` : ''}
    <hr>${items}<hr>
    <div class="tl"><span>Subtotal</span><span>${money(inv.subtotal)}</span></div>
    ${inv.discount ? `<div class="tl"><span>Descuento</span><span>-${money(inv.discount)}</span></div>` : ''}
    <div class="tl big"><span>TOTAL</span><span>${money(inv.total)}</span></div>
    ${vat ? `<div class="tl"><span>Base ${money(vat.base)}</span><span>IVA ${vat.rate}% ${money(vat.vat)}</span></div>` : ''}
    <hr>
    ${vat ? '' : '<div class="c">IVA incluido</div>'}
    ${inv.notes ? `<div class="c">${esc(inv.notes)}</div>` : ''}
    ${cfg.footer ? `<div class="c" style="margin-top:4px">${esc(cfg.footer)}</div>` : ''}
    <div class="c" style="margin-top:6px">¡Gracias por su compra!</div>
    ${inv.voided ? '<div class="c big">*** ANULADO ***</div>' : ''}
  </div>`;
}

/** Imprime o guarda en PDF (en el diálogo de impresión elige "Guardar como PDF"). */
export function printDocument(html, { format = 'a4', filename = 'documento' } = {}) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  let pageCss = '@page { size: A4; margin: 0; }';
  if (format === 'ticket') {
    root.style.display = 'block'; // medir el alto real del ticket
    const hmm = Math.ceil(root.firstElementChild.getBoundingClientRect().height * 25.4 / 96) + 6;
    root.style.display = '';
    pageCss = `@page { size: 80mm ${hmm}mm; margin: 0; }`;
  }
  const style = document.createElement('style');
  style.id = 'print-page-style'; style.textContent = pageCss;
  document.head.appendChild(style);
  const oldTitle = document.title;
  document.title = filename; // nombre por defecto del PDF
  document.body.classList.add('printing');
  const cleanup = () => {
    document.body.classList.remove('printing');
    style.remove(); root.innerHTML = ''; document.title = oldTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 50);
}
