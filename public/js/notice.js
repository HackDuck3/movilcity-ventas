// Printable notice (policy, price list, announcement) on the shop's A4 design.
import { esc, fmtDate } from './core.js';
import { documentDesign, documentColors } from './invoice.js';

// ---- Body markup
// Notices are written as plain text with a few marks:
//   # Title        a section heading
//   - text         a bullet
//   | a | b |      a table row (the first row of a table is its header)
//   **text**       bold
// Any other line is a paragraph.
const inline = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

const BLOCKS = [
  {
    matches: (line) => line.startsWith('# '),
    render: (lines) => lines.map(line => `<h3>${inline(line.slice(2))}</h3>`).join(''),
  },
  {
    matches: (line) => line.startsWith('- '),
    render: (lines) => `<ul>${lines.map(line => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`,
  },
  {
    matches: (line) => line.startsWith('|'),
    render: ([header, ...rows]) => `
      <table>
        <thead><tr>${cells(header).map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `<tr>${cells(row).map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`,
  },
];
const PARAGRAPH = { matches: () => true, render: (lines) => lines.map(line => `<p>${inline(line)}</p>`).join('') };

// Groups consecutive lines of the same kind (bullets, table rows...) and renders each group.
export function bodyHtml(text) {
  const groups = [];
  for (const line of String(text || '').split('\n').map(raw => raw.trim()).filter(Boolean)) {
    const block = BLOCKS.find(candidate => candidate.matches(line)) || PARAGRAPH;
    const last = groups[groups.length - 1];
    if (last && last.block === block) last.lines.push(line);
    else groups.push({ block, lines: [line] });
  }
  return groups.map(group => group.block.render(group.lines)).join('');
}

// ---- Page
const NOTICE_DESIGNS = {
  classic: (b) => `<header class="doc-head">${b.brand}${b.heading}</header>${b.body}`,
  sidebar: (b) => `<aside class="doc-side">${b.brand}</aside><div class="doc-main">${b.heading}${b.body}</div>`,
  banner: (b) => `<header class="doc-banner">${b.brand}${b.heading}</header><div class="doc-main">${b.body}</div>`,
};

export function noticeA4(notice, settings) {
  const { shop } = settings;
  const design = documentDesign(settings);
  const shopLines = [shop.legal_name, shop.nif && `NIF: ${shop.nif}`, shop.address1, shop.address2, shop.phone, shop.email]
    .filter(Boolean).map(esc).join('<br>');
  const blocks = {
    brand: `
      <div class="doc-brand">
        ${shop.logo ? `<img class="shop-logo" src="${shop.logo}" alt="">` : ''}
        <h2 class="shop-name">${esc(shop.name)}</h2>
        <div class="shop-lines">${shopLines}</div>
      </div>`,
    heading: `
      <div class="doc-id">
        <div class="doc-title">${esc(notice.title || 'Sin título')}</div>
        ${notice.subtitle ? `<div class="notice-subtitle">${esc(notice.subtitle)}</div>` : ''}
      </div>`,
    body: `
      <div class="notice-body">${bodyHtml(notice.body)}</div>
      <div class="notice-date">${notice.updated_at ? `Actualizado el ${fmtDate(notice.updated_at.slice(0, 10))}` : ''}</div>`,
  };
  return `<div class="invoice-doc notice-doc layout-${design}" style="${documentColors(settings)}">${NOTICE_DESIGNS[design](blocks)}</div>`;
}
