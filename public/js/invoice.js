// Printable documents: A4 invoice and thermal ticket (58 or 80 mm paper).
import { state, esc, money, fmtDate, fmtTime } from './core.js';
import { qrSvg } from './qr.js';

const paperWidth = (settings) => (Number(settings.invoice.paper_width) === 80 ? 80 : 58);

// Opening tag shared by everything printed on the thermal printer.
export const thermalClass = (settings) => `ticket-doc paper-${paperWidth(settings)}`;

// Optional QR code (shop review page, WhatsApp...) set in Settings.
function qrBlock(config) {
  if (!config.qr_url) return '';
  try {
    return `<div class="c qr-block">${qrSvg(config.qr_url)}${config.qr_caption ? `<div>${esc(config.qr_caption)}</div>` : ''}</div>`;
  } catch {
    return ''; // text too long for a QR code
  }
}

const lines = (parts) => parts.filter(Boolean).map(esc).join('<br>');

const shopLines = (shop) =>
  lines([shop.legal_name, shop.nif && `NIF: ${shop.nif}`, shop.address1, shop.address2, shop.phone, shop.email]);

const customerLines = (inv) =>
  lines([inv.customer_name, inv.customer_nif && `NIF: ${inv.customer_nif}`, inv.customer_address, inv.customer_phone]);

const documentTitle = (inv, cfg) =>
  (inv.kind === 'ticket' ? cfg.ticket_title || 'Ticket' : cfg.title || 'Factura');

function replacesText(inv) {
  if (!inv.replaces_number) return '';
  const date = inv.replaces_date ? ` de ${fmtDate(inv.replaces_date)}` : '';
  return `Esta factura sustituye a la factura simplificada nº ${inv.replaces_number}${date}.`;
}

// Prices always include VAT; this only splits the total into base + VAT.
function vatBreakdown(inv, cfg) {
  if (!inv.show_vat) return null;
  const rate = Number(cfg.vat_rate) || 0;
  const base = Math.round((inv.total / (1 + rate / 100)) * 100) / 100;
  return { rate, base, vat: Math.round((inv.total - base) * 100) / 100 };
}

// Saved invoices carry their own warranty_text; drafts look it up in settings.
export function warrantyGroups(inv, cfg) {
  const groups = new Map();
  for (const item of inv.items) {
    if (!item.warranty) continue;
    const text = item.warranty_text ?? cfg.warranties.find(w => w.name === item.warranty)?.text ?? '';
    if (!groups.has(item.warranty)) groups.set(item.warranty, { name: item.warranty, text, items: [] });
    groups.get(item.warranty).items.push(item.description);
  }
  const list = [...groups.values()];
  const coversEveryItem = list.length === 1 && list[0].items.length === inv.items.length;
  return list.map(g => ({ ...g, items: coversEveryItem ? [] : g.items.filter(Boolean) }));
}

function itemRows(inv) {
  return inv.items.map(item => {
    const qty = Number(item.qty) || 1;
    const price = Number(item.price) || 0;
    return `<tr>
      <td>
        <div class="item-name">${esc(item.description)}</div>
        ${item.detail ? `<div class="item-detail">${esc(item.detail)}</div>` : ''}
      </td>
      <td class="r">${qty}</td>
      <td class="r">${money(price)}</td>
      <td class="r item-total">${money(qty * price)}</td>
    </tr>`;
  }).join('');
}

function totalsBlock(inv, cfg) {
  const vat = vatBreakdown(inv, cfg);
  const row = (label, value) => `<div class="sum-row"><span>${label}</span><span>${value}</span></div>`;
  return `<div class="doc-totals">
    ${inv.discount ? row('Subtotal', money(inv.subtotal)) + row('Descuento', `−${money(inv.discount)}`) : ''}
    ${vat ? row('Base imponible', money(vat.base)) + row(`IVA (${vat.rate}%)`, money(vat.vat)) : ''}
    <div class="sum-total"><span>Total</span><span>${money(inv.total)}</span></div>
    ${vat || inv.kind === 'ticket' ? '' : '<div class="sum-note">IVA incluido</div>'}
  </div>`;
}

function conditionsBlock(inv, cfg) {
  const warranties = warrantyGroups(inv, cfg).map(g => `
    <div class="warranty">
      <b>${esc(g.name)}</b>${g.items.length ? ` <span class="warranty-items">(${esc(g.items.join(', '))})</span>` : ''}
      <div>${esc(g.text)}</div>
    </div>`).join('');
  const notes = [replacesText(inv), inv.notes].filter(Boolean).map(esc).join('\n');
  return `<div class="doc-conditions">
    ${warranties ? `<h4>Garantía</h4>${warranties}` : ''}
    ${notes ? `<h4>Notas</h4><div class="doc-notes">${notes}</div>` : ''}
  </div>`;
}

// ---- A4 designs
// Every design is built from the same blocks and only arranges them differently.
function a4Blocks(inv, settings) {
  const { shop, invoice: cfg } = settings;
  const customer = customerLines(inv);
  return {
    voidStamp: inv.voided ? '<div class="void-stamp">ANULADA</div>' : '',
    brand: `
      <div class="doc-brand">
        ${shop.logo ? `<img class="shop-logo" src="${shop.logo}" alt="">` : ''}
        <h2 class="shop-name">${esc(shop.name)}</h2>
        <div class="shop-lines">${shopLines(shop)}</div>
      </div>`,
    id: `
      <div class="doc-id">
        <div class="doc-title">${esc(documentTitle(inv, cfg))}</div>
        <div class="doc-number">N.º ${esc(inv.number || '—')}</div>
        <div class="doc-date">${fmtDate(inv.date)}</div>
      </div>`,
    customer: customer ? `<section class="doc-customer"><h4>Cliente</h4>${customer}</section>` : '',
    items: `
      <table class="doc-items">
        <thead><tr><th>Descripción</th><th class="r">Cant.</th><th class="r">Precio</th><th class="r">Importe</th></tr></thead>
        <tbody>${itemRows(inv)}</tbody>
      </table>`,
    bottom: `<div class="doc-bottom">${conditionsBlock(inv, cfg)}${totalsBlock(inv, cfg)}</div>`,
    footer: cfg.footer ? `<footer class="doc-footer">${esc(cfg.footer)}</footer>` : '',
  };
}

const A4_DESIGNS = {
  // Shop on the left, document on the right, everything else below.
  classic: (b) => `
    <header class="doc-head">${b.brand}${b.id}</header>
    ${b.customer}${b.items}${b.bottom}
    <div class="doc-end">${b.footer}</div>`,

  // A full-height colour column with the shop and the customer; the document itself on white.
  sidebar: (b) => `
    <aside class="doc-side">${b.brand}${b.customer}</aside>
    <div class="doc-main">
      ${b.id}${b.items}${b.bottom}
      <div class="doc-end">${b.footer}</div>
    </div>`,

  // A colour block across the top with the shop and the document title.
  banner: (b) => `
    <header class="doc-banner">${b.brand}${b.id}</header>
    <div class="doc-main">
      ${b.customer}${b.items}${b.bottom}
      <div class="doc-end">${b.footer}</div>
    </div>`,
};

export function invoiceA4(inv, settings) {
  const cfg = settings.invoice;
  const design = A4_DESIGNS[cfg.layout] ? cfg.layout : 'sidebar';
  const colors = `--doc-shop:${esc(cfg.color_shop)};--doc-title:${esc(cfg.color_title)};--doc-accent:${esc(cfg.color_accent)}`;
  const blocks = a4Blocks(inv, settings);
  return `<div class="invoice-doc layout-${design}" style="${colors}">${blocks.voidStamp}${A4_DESIGNS[design](blocks)}</div>`;
}

export function ticket80(inv, settings) {
  const { shop, invoice: cfg } = settings;
  const vat = vatBreakdown(inv, cfg);
  const items = inv.items.map(item => {
    const qty = Number(item.qty) || 1;
    const price = Number(item.price) || 0;
    return `<div>${esc(item.description)}</div>
      ${item.detail ? `<div class="small">${esc(item.detail)}</div>` : ''}
      <div class="tl"><span>${qty} x ${money(price)}</span><span>${money(qty * price)}</span></div>`;
  }).join('');
  const warranties = warrantyGroups(inv, cfg).map(g =>
    `<div class="small">${g.items.length ? `<b>${esc(g.items.join(', '))}:</b> ` : ''}${esc(g.text)}</div>`).join('');

  return `<div class="${thermalClass(settings)}">
    ${shop.logo ? `<img class="logo" src="${shop.logo}" alt="">` : ''}
    <div class="c"><h2>${esc(shop.name)}</h2>${shopLines(shop)}</div>
    <hr>
    <div class="tl"><b>${esc(documentTitle(inv, cfg))} ${esc(inv.number || '')}</b><span>${fmtDate(inv.date)} ${fmtTime(inv.created_at)}</span></div>
    ${inv.customer_name ? `<div>Cliente: ${esc(inv.customer_name)}${inv.customer_nif ? ' · ' + esc(inv.customer_nif) : ''}</div>` : ''}
    <hr>${items}<hr>
    ${inv.discount ? `<div class="tl"><span>Subtotal</span><span>${money(inv.subtotal)}</span></div>
                      <div class="tl"><span>Descuento</span><span>-${money(inv.discount)}</span></div>` : ''}
    <div class="tl big"><span>TOTAL</span><span>${money(inv.total)}</span></div>
    ${vat ? `<div class="tl"><span>Base ${money(vat.base)}</span><span>IVA ${vat.rate}% ${money(vat.vat)}</span></div>` : ''}
    <hr>
    ${warranties}
    ${inv.notes ? `<div class="c">${esc(inv.notes)}</div>` : ''}
    ${cfg.footer ? `<div class="c">${esc(cfg.footer)}</div>` : ''}
    <div class="c thanks">¡Gracias por su compra!</div>
    ${qrBlock(cfg)}
    ${inv.voided ? '<div class="c big">*** ANULADO ***</div>' : ''}
  </div>`;
}

// A ticket page is as wide as the paper roll and exactly as tall as its content.
function pageSize(format, printRoot) {
  if (format === 'a4-landscape') return 'A4 landscape';
  if (format !== 'ticket') return 'A4';
  printRoot.style.display = 'block';
  const heightMm = Math.ceil(printRoot.firstElementChild.getBoundingClientRect().height * 25.4 / 96) + 6;
  printRoot.style.display = '';
  return `${paperWidth(state.settings)}mm ${heightMm}mm`;
}

// The browser print dialog doubles as "Save as PDF".
// format: 'a4' | 'a4-landscape' | 'ticket'
export function printDocument(html, { format = 'a4', filename = 'documento' } = {}) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  const style = document.createElement('style');
  style.textContent = `@page { size: ${pageSize(format, root)}; margin: 0; }`;
  document.head.appendChild(style);
  const previousTitle = document.title;
  document.title = filename;
  document.body.classList.add('printing');
  const cleanup = () => {
    document.body.classList.remove('printing');
    style.remove();
    root.innerHTML = '';
    document.title = previousTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 50);
}
