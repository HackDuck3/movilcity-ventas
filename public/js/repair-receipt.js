// Printable repair receipt for the 80 mm thermal printer.
import { esc, money, fmtDate, fmtTime } from './core.js';

const PATTERN_DOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// 3x3 grid where each dot of the unlock pattern shows its position in the sequence.
export function patternGrid(pattern) {
  const sequence = pattern ? pattern.split('-').map(Number) : [];
  const cells = PATTERN_DOTS.map(dot => {
    const step = sequence.indexOf(dot) + 1;
    return `<span class="${step ? 'used' : ''}">${step || '·'}</span>`;
  }).join('');
  return `<div class="pattern-grid">${cells}</div>`;
}

const line = (label, value) => (value ? `<div><b>${label}:</b> ${esc(value)}</div>` : '');

export function repairReceipt(repair, settings) {
  const { shop, repairs: config } = settings;
  const shopLines = [shop.legal_name, shop.nif && `NIF: ${shop.nif}`, shop.address1, shop.address2, shop.phone]
    .filter(Boolean).map(esc).join('<br>');
  const device = [repair.brand, repair.model].filter(Boolean).join(' ');
  const work = [...repair.faults, repair.notes].filter(Boolean);
  const conditions = config.conditions.split('\n').filter(Boolean).map(text => `<p>${esc(text)}</p>`).join('');

  return `<div class="ticket-doc repair-receipt">
    ${shop.logo ? `<img class="logo" src="${shop.logo}" alt="">` : ''}
    <div class="c"><h2>${esc(shop.name)}</h2>${shopLines}</div>
    <hr>
    <div class="c big">RESGUARDO DE REPARACIÓN</div>
    <div class="tl"><b>N.º ${esc(repair.number || '')}</b><span>${fmtDate(repair.date)} ${fmtTime(repair.created_at)}</span></div>
    <hr>
    ${line('Cliente', repair.customer_name)}
    ${line('NIF', repair.customer_nif)}
    ${line('Teléfono', repair.customer_phone)}
    <hr>
    ${line('Terminal', device)}
    ${line('IMEI', repair.imei)}
    ${line('Compañía', repair.carrier)}
    ${line('Código de desbloqueo', repair.unlock_code)}
    ${repair.pattern ? `<div><b>Patrón:</b></div>${patternGrid(repair.pattern)}` : ''}
    ${line('Estado del móvil', repair.condition)}
    <hr>
    <div><b>Reparación:</b></div>
    ${work.map(text => `<div>▪ ${esc(text)}</div>`).join('')}
    ${repair.amount == null ? '' : `<hr><div class="tl big"><span>IMPORTE</span><span>${money(repair.amount)}</span></div>`}
    <hr>
    ${config.disclaimer ? `<div class="c"><b>${esc(config.disclaimer)}</b></div>` : ''}
    ${conditions ? `<div class="conditions"><div class="c"><b>CONDICIONES DEL SERVICIO</b></div>${conditions}</div>` : ''}
    <div class="signature">Firma de conformidad del cliente</div>
    <div class="signature">Recogido</div>
    ${repair.voided ? '<div class="c big">*** ANULADO ***</div>' : ''}
  </div>`;
}
