// Printable repair receipt: an A4 landscape sheet with two A5 copies, or a thermal ticket.
import { esc, money, fmtDate, fmtTime } from './core.js';
import { thermalClass, documentDesign, documentColors } from './invoice.js';

const PATTERN_DOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// What changes between kinds of device: the wording, which fields apply and which list of usual repairs is offered.
export const DEVICE_TYPES = {
  phone: {
    label: 'Móvil', heading: 'Datos del terminal', serial: 'IMEI', code: 'Código desbloqueo', condition: 'Estado del móvil',
    hasCarrier: true, hasPattern: true, faultsSetting: 'faults',
  },
  laptop: {
    label: 'Portátil', heading: 'Datos del equipo', serial: 'N.º de serie', code: 'Contraseña', condition: 'Estado del equipo',
    hasCarrier: false, hasPattern: false, faultsSetting: 'laptop_faults',
  },
};
export const deviceTypeOf = (repair) => DEVICE_TYPES[repair.device_type] || DEVICE_TYPES.phone;

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
const shopLines = (shop) => [shop.legal_name, shop.nif && `NIF: ${shop.nif}`, shop.address1, shop.address2, shop.phone]
  .filter(Boolean).map(esc).join('<br>');

// "Importe / Señal / Pendiente" when there is a deposit, otherwise just the amount.
function paymentRows(repair) {
  if (repair.amount == null) return [];
  if (!repair.deposit) return [['Importe', money(repair.amount)]];
  return [
    ['Importe', money(repair.amount)],
    ['Señal entregada', `−${money(repair.deposit)}`],
    ['Pendiente', money(repair.amount - repair.deposit)],
  ];
}

// One A5 copy, laid out like the shop's paper receipt book.
// The customer's copy leaves out the unlock code and pattern: if the slip is lost, nobody can open the phone with it.
function sheetCopy(repair, settings, { label, showUnlock }) {
  const { shop, repairs: config } = settings;
  const field = (label, value) => `<div class="sheet-field"><span>${label}</span><b>${esc(value || '')}</b></div>`;
  // Faults saved on the repair are listed even if they were later removed from settings.
  const device = deviceTypeOf(repair);
  const faultNames = [...new Set([...config[device.faultsSetting], ...repair.faults])];
  const faults = faultNames.map(name => `
    <div class="${repair.faults.includes(name) ? 'checked' : ''}"><i></i>${esc(name)}</div>`).join('');
  const conditions = config.conditions.split('\n').filter(Boolean).map(text => `<p>${esc(text)}</p>`).join('');
  const payment = paymentRows(repair);

  return `<section class="sheet-copy layout-${documentDesign(settings)}" style="${documentColors(settings)}">
    ${repair.voided ? '<div class="void-stamp">ANULADA</div>' : ''}
    <header>
      <div>
        ${shop.logo ? `<img class="logo" src="${shop.logo}" alt="">` : ''}
        <h2>${esc(shop.name)}</h2>
        <div class="shop-lines">${shopLines(shop)}</div>
      </div>
      <div class="sheet-id">
        <div class="sheet-title">Resguardo de reparación</div>
        <div class="sheet-number">N.º ${esc(repair.number || '—')}</div>
        <div>${fmtDate(repair.date)} ${fmtTime(repair.created_at)}</div>
        <div class="copy-label">${label}</div>
      </div>
    </header>
    <div class="sheet-columns">
      <div>
        <h4>${device.heading}</h4>
        ${field('Marca', repair.brand)}
        ${field('Modelo', repair.model)}
        ${field(device.serial, repair.imei)}
        ${showUnlock ? field(device.code, repair.unlock_code) : ''}
        ${device.hasCarrier ? field('Compañía', repair.carrier) : ''}
        ${field('Entrega prevista', repair.due_on ? fmtDate(repair.due_on) : '')}
      </div>
      <div>
        <h4>Cliente</h4>
        ${field('Nombre', repair.customer_name)}
        ${field('NIF', repair.customer_nif)}
        ${field('Teléfono', repair.customer_phone)}
        <div class="sheet-amount">
          ${payment.length ? payment.map(([name, value]) => `<div><span>${name}</span><b>${value}</b></div>`).join('') : '<div><span>Importe</span><b></b></div>'}
        </div>
      </div>
    </div>
    <div class="sheet-columns ${showUnlock && device.hasPattern ? '' : 'single'}">
      <div>
        <h4>Reparación</h4>
        <div class="sheet-faults">${faults}</div>
        ${field('Otros', repair.notes)}
        ${field(device.condition, repair.condition)}
      </div>
      ${showUnlock && device.hasPattern ? `<div class="sheet-pattern"><h4>Patrón</h4>${patternGrid(repair.pattern)}</div>` : ''}
    </div>
    ${config.disclaimer ? `<div class="sheet-disclaimer">${esc(config.disclaimer)}</div>` : ''}
    ${conditions ? `<div class="sheet-conditions"><h4>Condiciones del servicio</h4>${conditions}</div>` : ''}
    <div class="sheet-signatures"><div>Recogido</div><div>Firma de conformidad del cliente</div></div>
  </section>`;
}

// A4 landscape: the customer's copy on the left and the shop's on the right, to cut down the middle.
export function repairSheet(repair, settings) {
  return `<div class="repair-sheet">
    ${sheetCopy(repair, settings, { label: 'Copia para el cliente', showUnlock: false })}
    ${sheetCopy(repair, settings, { label: 'Copia para la tienda', showUnlock: true })}
  </div>`;
}

export function repairReceipt(repair, settings) {
  const { shop, repairs: config } = settings;
  const type = deviceTypeOf(repair);
  const device = [repair.brand, repair.model].filter(Boolean).join(' ');
  const work = [...repair.faults, repair.notes].filter(Boolean);
  const conditions = config.conditions.split('\n').filter(Boolean).map(text => `<p>${esc(text)}</p>`).join('');

  return `<div class="${thermalClass(settings)} repair-receipt">
    ${shop.logo ? `<img class="logo" src="${shop.logo}" alt="">` : ''}
    <div class="c"><h2>${esc(shop.name)}</h2>${shopLines(shop)}</div>
    <hr>
    <div class="c big">RESGUARDO DE REPARACIÓN</div>
    <div class="tl"><b>N.º ${esc(repair.number || '')}</b><span>${fmtDate(repair.date)} ${fmtTime(repair.created_at)}</span></div>
    <hr>
    ${line('Cliente', repair.customer_name)}
    ${line('NIF', repair.customer_nif)}
    ${line('Teléfono', repair.customer_phone)}
    <hr>
    ${line(type.label, device)}
    ${line(type.serial, repair.imei)}
    ${type.hasCarrier ? line('Compañía', repair.carrier) : ''}
    ${line(type.code, repair.unlock_code)}
    ${type.hasPattern && repair.pattern ? `<div><b>Patrón:</b></div>${patternGrid(repair.pattern)}` : ''}
    ${line(type.condition, repair.condition)}
    ${line('Entrega prevista', repair.due_on ? fmtDate(repair.due_on) : '')}
    <hr>
    <div><b>Reparación:</b></div>
    ${work.map(text => `<div>▪ ${esc(text)}</div>`).join('')}
    ${paymentRows(repair).length ? '<hr>' : ''}
    ${paymentRows(repair).map(([name, value], index, rows) => `<div class="tl ${index === rows.length - 1 ? 'big' : ''}"><span>${name.toUpperCase()}</span><span>${value}</span></div>`).join('')}
    <hr>
    ${config.disclaimer ? `<div class="c"><b>${esc(config.disclaimer)}</b></div>` : ''}
    ${conditions ? `<div class="conditions"><div class="c"><b>CONDICIONES DEL SERVICIO</b></div>${conditions}</div>` : ''}
    <div class="signature">Firma de conformidad del cliente</div>
    <div class="signature">Recogido</div>
    ${repair.voided ? '<div class="c big">*** ANULADO ***</div>' : ''}
  </div>`;
}
