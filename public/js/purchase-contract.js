// Printable contract for buying a used phone from a private seller: two A4 pages, one copy for each party.
import { esc, money, fmtDate } from './core.js';

const lines = (parts) => parts.filter(Boolean).map(esc).join('<br>');

function contractCopy(purchase, settings, copyLabel) {
  const { shop, purchases: config } = settings;
  const terms = config.terms.split('\n').filter(Boolean).map(text => `<p>${esc(text)}</p>`).join('');
  const row = (label, value) => `<tr><th>${label}</th><td>${esc(value || '—')}</td></tr>`;

  return `<div class="invoice-doc contract-doc">
    ${purchase.voided ? '<div class="void-stamp">ANULADA</div>' : ''}
    <header class="doc-head">
      <div class="doc-brand">
        ${shop.logo ? `<img class="shop-logo" src="${shop.logo}" alt="">` : ''}
        <h2 class="shop-name">${esc(shop.name)}</h2>
      </div>
      <div class="doc-id">
        <div class="doc-title">Contrato de compraventa</div>
        <div class="doc-number">N.º ${esc(purchase.number || '—')}</div>
        <div class="doc-date">${fmtDate(purchase.date)}</div>
        <div class="copy-label">${copyLabel}</div>
      </div>
    </header>

    <p class="contract-intro">Compraventa de un teléfono móvil de segunda mano entre las siguientes partes:</p>
    <div class="contract-parties">
      <section><h4>Comprador</h4>${lines([shop.legal_name || shop.name, shop.nif && `NIF: ${shop.nif}`, shop.address1, shop.address2, shop.phone])}</section>
      <section><h4>Vendedor</h4>${lines([purchase.seller_name, `DNI/NIE: ${purchase.seller_nif}`, purchase.seller_address, purchase.seller_phone])}</section>
    </div>

    <h4>Terminal que se vende</h4>
    <table class="contract-table">
      ${row('Marca y modelo', [purchase.brand, purchase.model].filter(Boolean).join(' '))}
      ${row('IMEI', purchase.imei)}
      ${row('Estado', purchase.condition)}
      ${row('Precio', `${money(purchase.price)}${purchase.payment_method ? ` · pagado en ${purchase.payment_method.toLowerCase()}` : ''}`)}
    </table>

    <h4>Cláusulas</h4>
    <div class="contract-terms">${terms}</div>

    <p class="contract-intro">Y en prueba de conformidad, ambas partes firman este contrato por duplicado en la fecha indicada.</p>
    <div class="contract-signatures">
      <div>El comprador</div>
      <div>El vendedor</div>
    </div>
  </div>`;
}

export function purchaseContract(purchase, settings) {
  return contractCopy(purchase, settings, 'Copia para el vendedor') + contractCopy(purchase, settings, 'Copia para la tienda');
}
