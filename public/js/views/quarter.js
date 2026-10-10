// Quarterly summary for the accountant: documents issued with base and VAT, expenses and second-hand purchases.
import { state, esc, icon, money, fmtDate, today, on, tryApi } from '../core.js';
import { printDocument } from '../invoice.js';

const KIND_LABELS = { ticket: 'Factura simplificada', factura: 'Factura' };
const quarterUrl = (year, quarter) => `#/panel?tab=trimestre&anio=${year}&t=${quarter}`;
const currentQuarter = () => Math.floor((Number(today().slice(5, 7)) - 1) / 3) + 1;

function neighbours(year, quarter) {
  return {
    previous: quarter === 1 ? [year - 1, 4] : [year, quarter - 1],
    next: quarter === 4 ? [year + 1, 1] : [year, quarter + 1],
  };
}

function issuedTable(summary) {
  const row = (label, part, strong = false) => `
    <tr ${strong ? 'style="font-weight:700"' : ''}>
      <td>${label}</td><td class="r num">${part.count}</td>
      <td class="r num">${money(part.base)}</td><td class="r num">${money(part.vat)}</td><td class="r num">${money(part.total)}</td>
    </tr>`;
  return `
    <table class="t">
      <thead><tr><th>Documentos emitidos</th><th class="r">N.º</th><th class="r">Base</th><th class="r">IVA (${summary.vat_rate}%)</th><th class="r">Total</th></tr></thead>
      <tbody>
        ${row('Facturas simplificadas (tickets)', summary.issued.tickets)}
        ${row('Facturas', summary.issued.invoices)}
        ${row('Total', summary.issued.all, true)}
      </tbody>
    </table>`;
}

function expensesTable(summary) {
  if (!summary.expenses.length) return '<div class="empty">Sin gastos en el trimestre</div>';
  return `
    <table class="t">
      <thead><tr><th>Gastos por motivo</th><th>Tipo</th><th class="r">N.º</th><th class="r">Importe</th></tr></thead>
      <tbody>
        ${summary.expenses.map(expense => `
          <tr>
            <td>${esc(expense.name)}</td><td class="muted">${expense.expense_type === 'stock' ? 'Mercancía' : 'Operativo'}</td>
            <td class="r num">${expense.count}</td><td class="r num">${money(expense.amount)}</td>
          </tr>`).join('')}
        <tr style="font-weight:700"><td>Total</td><td></td><td></td><td class="r num">${money(summary.expenses_total)}</td></tr>
      </tbody>
    </table>`;
}

function documentsTable(summary) {
  if (!summary.documents.length) return '<div class="empty">Sin documentos en el trimestre</div>';
  const row = (document) => `
    <tr class="${document.already_declared ? 'muted' : ''}">
      <td class="num">${fmtDate(document.date)}</td>
      <td><b>${esc(document.number)}</b></td>
      <td>${KIND_LABELS[document.kind]}${document.is_refund ? ` rectificativa de ${esc(document.rectifies_number)}` : ''}${document.already_declared ? ' · no suma (sustituye a un ticket de otro trimestre)' : ''}</td>
      <td>${esc([document.customer_name, document.customer_nif].filter(Boolean).join(' · '))}</td>
      <td class="r num">${money(document.base)}</td><td class="r num">${money(document.vat)}</td><td class="r num">${money(document.total)}</td>
    </tr>`;
  return `
    <table class="t">
      <thead><tr><th>Fecha</th><th>N.º</th><th>Tipo</th><th>Cliente</th><th class="r">Base</th><th class="r">IVA</th><th class="r">Total</th></tr></thead>
      <tbody>${summary.documents.map(row).join('')}</tbody>
    </table>`;
}

const title = (summary) => `${summary.quarter}.º trimestre de ${summary.year}`;
const periodText = (summary) => `Del ${fmtDate(summary.from)} al ${fmtDate(summary.to)}`;

function printableReport(summary) {
  const { shop } = state.settings;
  return `
    <div class="report-doc">
      <h1>Resumen del ${title(summary)}</h1>
      <div class="report-sub">${esc([shop.legal_name || shop.name, shop.nif && `NIF ${shop.nif}`].filter(Boolean).join(' · '))} · ${periodText(summary)}</div>
      ${issuedTable(summary)}
      ${expensesTable(summary)}
      <table class="t"><tbody>
        <tr><td>Compras de segunda mano a particulares</td><td class="r num">${summary.purchases.count}</td><td class="r num">${money(summary.purchases.total)}</td></tr>
      </tbody></table>
      <h2>Detalle de documentos</h2>
      ${documentsTable(summary)}
      <p class="report-note">Importes con IVA incluido; la base se calcula a partir del total al ${summary.vat_rate}%. No incluye documentos anulados.</p>
    </div>`;
}

export async function renderQuarter(body, params) {
  const year = Number(params.get('anio')) || Number(today().slice(0, 4));
  const quarter = Number(params.get('t')) || currentQuarter();
  const summary = await tryApi(`/admin/quarter?year=${year}&quarter=${quarter}`);
  if (!summary) return;
  const { previous, next } = neighbours(summary.year, summary.quarter);
  const csvUrl = (part) => `/api/admin/quarter/${part}.csv?year=${summary.year}&quarter=${summary.quarter}`;
  const kpi = (label, value, footer) => `
    <div class="kpi"><div class="label">${label}</div><div class="value">${money(value)}</div><div class="foot">${footer}</div></div>`;

  body.innerHTML = `
    <div class="filters">
      <div class="row">
        <a class="btn btn-sm" href="${quarterUrl(...previous)}">← T${previous[1]} ${previous[0]}</a>
        <b style="font-size:18px">${title(summary)}</b>
        <a class="btn btn-sm" href="${quarterUrl(...next)}">T${next[1]} ${next[0]} →</a>
      </div>
      <span class="spacer"></span>
      <button class="btn btn-primary" data-print>${icon('print')} Imprimir / Guardar PDF</button>
    </div>
    <div class="kpis">
      ${kpi('Total facturado', summary.issued.all.total, `${summary.issued.all.count} documento(s)`)}
      ${kpi('Base imponible', summary.issued.all.base, 'sin IVA')}
      ${kpi(`IVA repercutido (${summary.vat_rate}%)`, summary.issued.all.vat, 'incluido en los precios')}
      ${kpi('Gastos', summary.expenses_total, 'mercancía y operativos')}
      ${kpi('Compras de segunda mano', summary.purchases.total, `${summary.purchases.count} contrato(s)`)}
    </div>
    <div class="notice" style="margin-bottom:14px">
      Es un resumen para tu gestoría, no una declaración. La base y el IVA se calculan a partir del total al ${summary.vat_rate}%;
      si aplicas recargo de equivalencia o el régimen de bienes usados, tu gestoría sabrá qué cifras usar.
      Las ventas de caja sin ticket ni factura no aparecen aquí: están en el Resumen del panel.
    </div>
    <div class="card" style="margin-bottom:14px"><div class="table-wrap">${issuedTable(summary)}</div></div>
    <div class="card" style="margin-bottom:14px"><div class="table-wrap">${expensesTable(summary)}</div></div>
    <div class="card card-pad" style="margin-bottom:14px">
      <h3 style="margin-top:0">Listados para la gestoría</h3>
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <a class="btn" href="${csvUrl('documentos')}">${icon('download')} Documentos emitidos (CSV)</a>
        <a class="btn" href="${csvUrl('gastos')}">${icon('download')} Gastos (CSV)</a>
        <a class="btn" href="${csvUrl('compras')}">${icon('download')} Compras de segunda mano (CSV)</a>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Detalle de documentos</h3><span class="count">(${summary.documents.length})</span></div>
      <div class="table-wrap">${documentsTable(summary)}</div>
    </div>`;

  on(body, 'click', '[data-print]', () => printDocument(printableReport(summary), { filename: `Resumen-${summary.year}-T${summary.quarter}` }));
}
