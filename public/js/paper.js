// The shop's security paper: which drawings and colours a printed A4 document gets.
// The drawings themselves are made in security-pattern.js; this file decides what to draw from Settings.
import { esc } from './core.js';
import { guillocheBand, emblem, watermark, pageFrame, microtext } from './security-pattern.js';

// The drawings come from a seed. Left empty in Settings, it is the shop's name and NIF,
// so every shop gets a different paper without doing anything.
export const paperSeed = (settings) => settings.invoice.paper_seed || `${settings.shop.name}|${settings.shop.nif}`;

// "Movil City" → "MC"
export const initialsOf = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('');

// The document colours chosen in Settings, as the CSS variables the templates and drawings use.
export function documentColors(settings) {
  const { color_shop: shop, color_title: title, color_accent: accent } = settings.invoice;
  return `--doc-shop:${esc(shop)};--doc-title:${esc(title)};--doc-accent:${esc(accent)}`;
}

/**
 * The pieces a template needs to print on security paper, or null when Settings ask for plain paper.
 * sheet: 'a4' or 'a5', the size the frame is drawn for.
 */
export function securityPaper(settings, sheet = 'a4') {
  if (settings.invoice.paper_style === 'plain') return null;
  const seed = paperSeed(settings);
  return {
    // Frame and watermark, placed behind the content of the page.
    layer: `<div class="paper-layer">${pageFrame(seed, sheet)}${watermark(seed)}</div>`,
    emblem: emblem(seed, initialsOf(settings.shop.name)),
    // Guilloche pattern between two lines of microtext. `lettering` is the document's own data (number, date…).
    band: (lettering) => `<div class="doc-security">${microtext(lettering)}${guillocheBand(seed)}${microtext(lettering)}</div>`,
    rule: (lettering) => microtext(lettering),
  };
}
