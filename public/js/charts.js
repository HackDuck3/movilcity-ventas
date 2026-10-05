// Small SVG charts with no library, so they work offline.
import { esc, money, moneyShort } from './core.js';

const TOOLTIP_OFFSET = 14;
const SCREEN_MARGIN = 8;
const GRID_LINES = 4;
const MIN_LABEL_SPACING = 38;

let tooltip;

function showTooltip(html, pointerX, pointerY) {
  if (!tooltip) {
    tooltip = document.createElement('div');
    document.body.appendChild(tooltip);
  }
  tooltip.className = 'tooltip';
  tooltip.innerHTML = html;
  // Flip to the other side of the pointer when it would leave the screen.
  const { width, height } = tooltip.getBoundingClientRect();
  const fitsRight = pointerX + TOOLTIP_OFFSET + width <= innerWidth - SCREEN_MARGIN;
  const fitsBelow = pointerY + TOOLTIP_OFFSET + height <= innerHeight - SCREEN_MARGIN;
  tooltip.style.left = `${fitsRight ? pointerX + TOOLTIP_OFFSET : pointerX - width - TOOLTIP_OFFSET}px`;
  tooltip.style.top = `${fitsBelow ? pointerY + TOOLTIP_OFFSET : pointerY - height - TOOLTIP_OFFSET}px`;
}

function hideTooltip() {
  if (tooltip) tooltip.classList.add('hidden');
}

// Rounds an axis maximum up to a "nice" number: 1, 1.2, 1.5, 2, 2.5... times a power of ten.
function niceMax(value) {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return steps.find(step => value / magnitude <= step) * magnitude;
}

// A bar with its far end rounded and its base flat on the zero line.
function barPath(x, width, zeroY, valueY) {
  const radius = Math.min(4, width / 2, Math.max(1, Math.abs(valueY - zeroY)));
  const towardsBase = valueY < zeroY ? radius : -radius;
  const right = x + width;
  return `M${x},${zeroY} V${valueY + towardsBase} Q${x},${valueY} ${x + radius},${valueY}
          H${right - radius} Q${right},${valueY} ${right},${valueY + towardsBase} V${zeroY} Z`;
}

/**
 * Grouped vertical bars, one group per label.
 * options: { labels, titles (tooltip headings), series: [{ name, color, values }], height, onClick(index) }
 */
export function groupedBars(container, options) {
  const { labels, series, height = 240, titles = labels, onClick } = options;
  const allValues = series.flatMap(serie => serie.values);
  if (!allValues.some(value => value)) {
    container.innerHTML = `<div class="empty" style="height:${height}px;display:grid;place-items:center">Sin ventas en este periodo</div>`;
    return;
  }

  const width = Math.max(container.clientWidth || 600, 300);
  const margin = { top: 10, right: 8, bottom: 26, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const axisMax = niceMax(Math.max(20, ...allValues));
  const lowest = Math.min(0, ...allValues);
  const axisMin = lowest < 0 ? -niceMax(-lowest) : 0;
  const yOf = (value) => margin.top + plotHeight - ((value - axisMin) / (axisMax - axisMin)) * plotHeight;

  const groupSlot = plotWidth / (labels.length || 1);
  const groupWidth = Math.min(groupSlot * 0.78, 56);
  const barGap = 2;
  const barWidth = Math.max(1.5, (groupWidth - barGap * (series.length - 1)) / series.length);
  const slotX = (index) => margin.left + groupSlot * index;

  const parts = [];
  for (let line = 0; line <= GRID_LINES; line++) {
    const value = axisMin + ((axisMax - axisMin) * line) / GRID_LINES;
    const y = yOf(value);
    parts.push(`<line class="gridline" x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}"/>`);
    parts.push(`<g class="axis"><text x="${margin.left - 8}" y="${y + 4}" text-anchor="end">${esc(moneyShort(value))}</text></g>`);
  }

  labels.forEach((_, index) => {
    const groupX = slotX(index) + (groupSlot - groupWidth) / 2;
    series.forEach((serie, position) => {
      const value = serie.values[index] || 0;
      if (!value) return;
      const x = groupX + position * (barWidth + barGap);
      parts.push(`<path d="${barPath(x, barWidth, yOf(0), yOf(value))}" style="fill:${serie.color}"/>`);
    });
  });
  parts.push(`<line class="baseline" x1="${margin.left}" x2="${width - margin.right}" y1="${yOf(0)}" y2="${yOf(0)}"/>`);

  // Only every n-th label is drawn when they would overlap.
  const labelEvery = Math.ceil(labels.length / Math.max(1, Math.floor(plotWidth / MIN_LABEL_SPACING)));
  labels.forEach((label, index) => {
    if (index % labelEvery) return;
    parts.push(`<g class="axis"><text x="${slotX(index) + groupSlot / 2}" y="${height - 8}" text-anchor="middle">${esc(label)}</text></g>`);
  });

  // Invisible full-height areas make hovering and clicking easy even on thin bars.
  labels.forEach((_, index) => {
    parts.push(`<rect data-index="${index}" x="${slotX(index)}" y="${margin.top}" width="${groupSlot}" height="${plotHeight}"
                      fill="transparent" style="cursor:${onClick ? 'pointer' : 'default'}"/>`);
  });

  container.innerHTML = `<div class="chart"><svg viewBox="0 0 ${width} ${height}" height="${height}" role="img">${parts.join('')}</svg></div>`;

  const svg = container.querySelector('svg');
  const indexOf = (event) => event.target.dataset?.index;
  svg.addEventListener('mousemove', (event) => {
    const index = indexOf(event);
    if (index === undefined) return hideTooltip();
    const rows = series.map(serie => `
      <div class="tr">
        <span><i style="background:${serie.color}"></i>${esc(serie.name)}</span>
        <b class="num">${money(serie.values[index] || 0)}</b>
      </div>`).join('');
    showTooltip(`<b>${esc(titles[index])}</b>${rows}`, event.clientX, event.clientY);
  });
  svg.addEventListener('mouseleave', hideTooltip);
  if (!onClick) return;
  svg.addEventListener('click', (event) => {
    const index = indexOf(event);
    if (index === undefined) return;
    hideTooltip();
    onClick(Number(index));
  });
}

/**
 * Horizontal ranking bars. items: [{ label, value, extra }], already sorted.
 * Items beyond `max` are summed into one row without a bar: an "Others" bar would mislead in a ranking.
 */
export function rankingBars(container, items, { color = 'var(--series-1)', max = 10 } = {}) {
  if (!items.length) {
    container.innerHTML = '<div class="empty">Sin datos en este periodo</div>';
    return;
  }
  const shown = items.slice(0, max);
  const hidden = items.slice(max);
  const largest = Math.max(...shown.map(item => Math.abs(item.value)), 1);

  const row = (item, isRemainder = false) => {
    const fill = isRemainder
      ? ''
      : `<span class="fill" style="display:block;width:${Math.max(0, (item.value / largest) * 100)}%;background:${color}"></span>`;
    return `
      <div class="hbar ${isRemainder ? 'other' : ''}" title="${esc(item.label)}: ${esc(money(item.value))}">
        <span class="lab">${esc(item.label)}</span>
        <span class="track">${fill}</span>
        <span class="val">${esc(money(item.value))}${item.extra ? `<small>${esc(item.extra)}</small>` : ''}</span>
      </div>`;
  };

  const remainder = hidden.length
    ? row({ label: `Otros (${hidden.length})`, value: hidden.reduce((sum, item) => sum + item.value, 0) }, true)
    : '';
  container.innerHTML = `<div class="hbars">${shown.map(item => row(item)).join('')}${remainder}</div>`;
}
