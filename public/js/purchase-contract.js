// Printable contract for buying a used phone from a private seller: two A4 pages, one copy for each party.
// It follows the design chosen for invoices, so all the shop's documents look alike.
import { esc, money, fmtDate } from './core.js';
import { documentDesign, documentColors } from './invoice.js';

const lines = (parts) => parts.filter(Boolean).map(esc).join('<br>');

function contractBlocks(purchase, settings, copyLabel) {
  const { shop, purchases: config } = settings;
  const terms = config.terms.split('\n').filter(Boolean).map(text => `<p>${esc(text)}</p>`).join('');
  const row = (label, value) => `<tr><th>${label}</th><td>${esc(value || '—')}</td></tr>`;
  const price = `${money(purchase.price)}${purchase.payment_method ? ` · pagado en ${purchase.payment_method.toLowerCase()}` : ''}`;
  return {
    voidStamp: purchase.voided ? '<div class="void-stamp">ANULADA</div>' : '',
    // The shop is the buyer.
    brand: `
      <div class="doc-brand">
        ${shop.logo ? `<img class="shop-logo" src="${shop.logo}" alt="">` : ''}
        <h2 class="shop-name">${esc(shop.name)}</h2>
        <div class="shop-lines"><b>Comprador</b><br>${lines([shop.legal_name, shop.nif && `NIF: ${shop.nif}`, shop.address1, shop.address2, shop.phone])}</div>
      </div>`,
    id: `
      <div class="doc-id">
        <div class="doc-title">Contrato de compraventa</div>
        <div class="doc-number">N.º ${esc(purchase.number || '—')}</div>
        <div class="doc-date">${fmtDate(purchase.date)}</div>
        <div class="copy-label">${copyLabel}</div>
      </div>`,
    seller: `
      <section class="doc-customer">
        <h4>Vendedor</h4>${lines([purchase.seller_name, `DNI/NIE: ${purchase.seller_nif}`, purchase.seller_address, purchase.seller_phone])}
      </section>`,
    body: `
      <p class="contract-intro">Compraventa de un teléfono móvil de segunda mano entre el comprador y el vendedor indicados.</p>
      <h4>Terminal que se vende</h4>
      <table class="contract-table">
        ${row('Marca y modelo', [purchase.brand, purchase.model].filter(Boolean).join(' '))}
        ${row('IMEI', purchase.imei)}
        ${row('Estado', purchase.condition)}
        ${row('Precio', price)}
      </table>
      <h4>Cláusulas</h4>
      <div class="contract-terms">${terms}</div>
      <p class="contract-intro">Y en prueba de conformidad, ambas partes firman este contrato por duplicado en la fecha indicada.</p>
      <div class="contract-signatures"><div>El comprador</div><div>El vendedor</div></div>`,
  };
}

// The same arrangements as the invoice (see A4_DESIGNS in invoice.js).
const CONTRACT_DESIGNS = {
  classic: (b) => `<header class="doc-head">${b.brand}${b.id}</header>${b.seller}${b.body}`,
  sidebar: (b) => `<aside class="doc-side">${b.brand}${b.seller}</aside><div class="doc-main">${b.id}${b.body}</div>`,
  banner: (b) => `<header class="doc-banner">${b.brand}${b.id}</header><div class="doc-main">${b.seller}${b.body}</div>`,
};

function contractCopy(purchase, settings, copyLabel) {
  const design = documentDesign(settings);
  const blocks = contractBlocks(purchase, settings, copyLabel);
  return `<div class="invoice-doc contract-doc layout-${design}" style="${documentColors(settings)}">${blocks.voidStamp}${CONTRACT_DESIGNS[design](blocks)}</div>`;
}

export function purchaseContract(purchase, settings) {
  return contractCopy(purchase, settings, 'Copia para el vendedor') + contractCopy(purchase, settings, 'Copia para la tienda');
}
