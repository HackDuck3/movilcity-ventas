// Small SVG charts with no library, so they work offline.
import { esc, money, moneyShort } from './core.js';

let tipEl;
function tip() {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tooltip hidden'; document.body.appendChild(tipEl); }
  return tipEl;
}
export function showTip(html, x, y) {
  const t = tip(); t.innerHTML = html; t.classList.remove('hidden');
  const r = t.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  t.style.left = left + 'px'; t.style.top = top + 'px';
}
export function hideTip() { tip().classList.add('hidden'); }

function niceMax(v) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return steps.find(s => n <= s) * p;
}

/**
 * Grouped bars per day or month.
 * opts: { labels: [], titles: [] (tooltip text), series: [{ name, color, values }], height, onClick(i) }
 */
export function groupedBars(container, opts) {
  const { labels, series, height = 240, titles = labels, onClick } = opts;
  if (!series.some(se => se.values.some(v => v))) {
    container.innerHTML = `<div class="empty" style="height:${height}px;display:grid;place-items:center">Sin ventas en este periodo</div>`;
    return;
  }
  const W = Math.max(container.clientWidth || 600, 300), H = height;
  const m = { t: 10, r: 8, b: 26, l: 52 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxV = niceMax(Math.max(20, ...series.flatMap(s => s.values)));
  const minV = Math.min(0, ...series.flatMap(s => s.values));
  const lo = minV < 0 ? -niceMax(-minV) : 0;
  const y = (v) => m.t + ih - ((v - lo) / (maxV - lo)) * ih;
  const n = labels.length || 1;
  const band = iw / n;
  const gap = 2;
  const groupW = Math.min(band * 0.78, 56);
  const bw = Math.max(1.5, (groupW - gap * (series.length - 1)) / series.length);

  let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img">`;
  // grid
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((maxV - lo) * i) / 4, yy = y(v);
    s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    s += `<g class="axis"><text x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${esc(moneyShort(v))}</text></g>`;
  }
  // bars: rounded top, anchored to the baseline
  labels.forEach((_, i) => {
    const gx = m.l + band * i + (band - groupW) / 2;
    series.forEach((se, j) => {
      const v = se.values[i] || 0; if (!v) return;
      const x = gx + j * (bw + gap);
      const y0 = y(0), y1 = y(v);
      const top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
      const r = Math.min(4, bw / 2, h);
      const path = v >= 0
        ? `M${x},${y0} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y0} Z`
        : `M${x},${y0} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + bw - r} Q${x + bw},${top + h} ${x + bw},${top + h - r} V${y0} Z`;
      s += `<path d="${path}" style="fill:${se.color}"/>`;
    });
  });
  s += `<line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  // x-axis labels, skipped when they would overlap
  const every = Math.ceil(n / Math.max(1, Math.floor(iw / 38)));
  labels.forEach((l, i) => {
    if (i % every) return;
    s += `<g class="axis"><text x="${m.l + band * i + band / 2}" y="${H - 8}" text-anchor="middle">${esc(l)}</text></g>`;
  });
  // hover/click areas, larger than the bar itself
  labels.forEach((_, i) => {
    s += `<rect data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent" style="cursor:${onClick ? 'pointer' : 'default'}"/>`;
  });
  s += '</svg>';
  container.innerHTML = `<div class="chart">${s}</div>`;
  const svg = container.querySelector('svg');
  svg.addEventListener('mousemove', (e) => {
    const i = e.target.dataset && e.target.dataset.i; if (i === undefined) return hideTip();
    showTip(`<b>${esc(titles[i])}</b>` + series.map(se =>
      `<div class="tr"><span><i style="background:${se.color}"></i>${esc(se.name)}</span><b class="num">${money(se.values[i] || 0)}</b></div>`).join(''), e.clientX, e.clientY);
  });
  svg.addEventListener('mouseleave', hideTip);
  if (onClick) svg.addEventListener('click', (e) => { const i = e.target.dataset.i; if (i !== undefined) { hideTip(); onClick(Number(i)); } });
}

/** Horizontal ranking bars. items: [{ label, value, extra }] */
export function hBars(container, items, { color = 'var(--series-1)', max = 10, fmt = money } = {}) {
  if (!items.length) { container.innerHTML = '<div class="empty">Sin datos en este periodo</div>'; return; }
  const list = items.slice(0, max);
  const top = Math.max(...list.map(i => Math.abs(i.value)), 1);
  // The remainder is one row without a bar: an "Others" bar would mislead in a ranking.
  if (items.length > max) {
    const rest = items.slice(max);
    list.push({ label: `Otros (${rest.length})`, value: rest.reduce((a, b) => a + b.value, 0), extra: '', other: true });
  }
  container.innerHTML = `<div class="hbars">${list.map(i => `
    <div class="hbar ${i.other ? 'other' : ''}" title="${esc(i.label)}: ${esc(fmt(i.value))}">
      <span class="lab">${esc(i.label)}</span>
      <span class="track">${i.other ? '' : `<span class="fill" style="display:block;width:${Math.max(0, (i.value / top) * 100)}%;background:${color}"></span>`}</span>
      <span class="val">${esc(fmt(i.value))}${i.extra ? `<small>${esc(i.extra)}</small>` : ''}</span>
    </div>`).join('')}</div>`;
}
