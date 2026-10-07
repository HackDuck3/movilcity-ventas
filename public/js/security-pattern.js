// Security-paper graphics for printed documents: guilloche bands, rosettes and microtext, like the line
// work on banknotes and certificates. Everything is drawn from a seed, so each shop gets a paper of its own:
// the same seed always gives the same drawing and a different seed a different one.
// Colours come from the --doc-title and --doc-accent CSS variables of the document.
import { esc } from './core.js';

const TAU = Math.PI * 2;
const TITLE_COLOR = 'var(--doc-title)';
const ACCENT_COLOR = 'var(--doc-accent)';

// Deterministic random numbers (mulberry32) seeded from a string.
function seededRandom(seed) {
  let state = 0;
  for (const character of seed) state = (Math.imul(state, 31) + character.charCodeAt(0)) >>> 0;
  let mixed;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  return {
    between: (min, max) => min + next() * (max - min),
    wholeBetween: (min, max) => Math.floor(min + next() * (max - min + 1)),
  };
}

// The invoice editor redraws its preview on every keystroke; drawings are kept so each is computed once.
const drawings = new Map();
function remembered(key, draw) {
  if (!drawings.has(key)) drawings.set(key, draw());
  return drawings.get(key);
}

// One stroked line through the points. Whole numbers and relative moves keep the markup small,
// so every drawing uses a viewBox fine enough for the rounding not to show.
function line(points, color) {
  let [x, y] = points[0].map(Math.round);
  let path = `M${x},${y}`;
  for (const point of points.slice(1)) {
    const nextX = Math.round(point[0]);
    const nextY = Math.round(point[1]);
    path += `l${nextX - x},${nextY - y}`;
    x = nextX;
    y = nextY;
  }
  return `<path d="${path}" style="stroke:${color}"/>`;
}

// ---- Guilloche bands: identical waves shifted in phase and squeezed by a slower "envelope" wave
function randomWave(random, lines, color) {
  return {
    lines, color,
    wavelength: random.between(130, 230),
    envelopeLength: random.between(520, 1100),
    shift: random.between(0, TAU),
  };
}

// Points of the lines of one band, as [distance along the band, distance across it].
function bandLines(length, thickness, wave, step) {
  const amplitude = thickness / 2 - 3;
  return Array.from({ length: wave.lines }, (_, index) => {
    const phase = (index / wave.lines) * TAU;
    const points = [];
    for (let along = 0; along <= length; along += step) {
      const swing = Math.sin((TAU * along) / wave.wavelength + phase) * Math.cos((TAU * along) / wave.envelopeLength + wave.shift);
      points.push([along, thickness / 2 + amplitude * swing]);
    }
    return points;
  });
}

// Horizontal band for the document header. Units are tenths of a millimetre.
const BAND = { width: 1780, height: 90, step: 8 };

export const guillocheBand = (seed) => remembered(`band:${seed}`, () => {
  const random = seededRandom(`band:${seed}`);
  const waves = [randomWave(random, 9, TITLE_COLOR), randomWave(random, 7, ACCENT_COLOR)];
  const lines = waves.flatMap(wave => bandLines(BAND.width, BAND.height, wave, BAND.step).map(points => line(points, wave.color)));
  return `<svg class="guilloche" viewBox="0 0 ${BAND.width} ${BAND.height}" preserveAspectRatio="none" fill="none" stroke-width="1.5">${lines.join('')}</svg>`;
});

// ---- Rosettes: rings of petal-shaped curves
function randomRings(random, outerRadius, sizes) {
  return sizes.map(([share, minPetals, maxPetals, curves, color]) => ({
    radius: outerRadius * share,
    petals: random.wholeBetween(minPetals, maxPetals),
    depth: random.between(0.16, 0.3),
    curves, color,
  }));
}

function rosetteLines(centerX, centerY, rings, steps) {
  return rings.flatMap(ring => Array.from({ length: ring.curves }, (_, index) => {
    const phase = (index / ring.curves) * TAU;
    const points = [];
    for (let step = 0; step <= steps; step++) {
      const angle = (step / steps) * TAU;
      const radius = ring.radius * (1 - ring.depth + ring.depth * Math.sin(ring.petals * angle + phase));
      points.push([centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)]);
    }
    return line(points, ring.color);
  }).join(''));
}

const ROSETTE = { size: 2000, steps: 240 };

// Emblem for the header: a rosette ring with the shop's initials in the middle.
export const emblem = (seed, initials) => remembered(`emblem:${seed}:${initials}`, () => {
  const random = seededRandom(`emblem:${seed}`);
  const rings = randomRings(random, 980, [[1, 12, 20, 6, TITLE_COLOR], [0.8, 7, 11, 5, ACCENT_COLOR]]);
  const center = ROSETTE.size / 2;
  return `<svg class="emblem" viewBox="0 0 ${ROSETTE.size} ${ROSETTE.size}" fill="none" stroke-width="9">
    ${rosetteLines(center, center, rings, ROSETTE.steps).join('')}
    <text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central" font-size="560" font-weight="800"
          font-family="Inter, Roboto, 'Helvetica Neue', Arial, sans-serif" style="fill:${TITLE_COLOR};stroke:none">${esc(initials)}</text>
  </svg>`;
});

// Large, faint rosette printed behind the content of the page.
export const watermark = (seed) => remembered(`watermark:${seed}`, () => {
  const random = seededRandom(`watermark:${seed}`);
  const rings = randomRings(random, 980, [
    [1, 16, 26, 7, TITLE_COLOR], [0.78, 10, 16, 6, ACCENT_COLOR], [0.55, 7, 11, 5, TITLE_COLOR], [0.32, 4, 7, 4, ACCENT_COLOR],
  ]);
  const center = ROSETTE.size / 2;
  return `<svg class="watermark" viewBox="0 0 ${ROSETTE.size} ${ROSETTE.size}" fill="none" stroke-width="5">${rosetteLines(center, center, rings, ROSETTE.steps).join('')}</svg>`;
});

// ---- Page frame: a guilloche band along the four edges of a sheet, with a rosette on each corner
// Sheets a frame can be drawn for, in tenths of a millimetre. `inset` keeps it inside what printers can reach.
const SHEETS = {
  a4: { width: 2100, height: 2970, inset: 65, thickness: 46, cornerRadius: 52 },
  a5: { width: 1485, height: 2100, inset: 55, thickness: 36, cornerRadius: 42 },
};
const FRAME = { step: 11, cornerSteps: 72 };

export const pageFrame = (seed, sheet = 'a4') => remembered(`frame:${sheet}:${seed}`, () => {
  const random = seededRandom(`frame:${seed}`);
  const wave = randomWave(random, 6, TITLE_COLOR);
  const { width, height, inset, thickness, cornerRadius } = SHEETS[sheet];
  const far = { x: width - inset, y: height - inset };

  // Each side places a band point [along, across] on the page.
  const sides = [
    { length: width - inset * 2, place: ([along, across]) => [inset + along, inset + across] },
    { length: width - inset * 2, place: ([along, across]) => [inset + along, far.y - across] },
    { length: height - inset * 2, place: ([along, across]) => [inset + across, inset + along] },
    { length: height - inset * 2, place: ([along, across]) => [far.x - across, inset + along] },
  ];
  const bands = sides.flatMap(side =>
    bandLines(side.length, thickness, wave, FRAME.step).map(points => line(points.map(side.place), wave.color)));

  const cornerRings = randomRings(random, cornerRadius, [[1, 7, 10, 4, ACCENT_COLOR], [0.55, 4, 6, 3, TITLE_COLOR]]);
  const middle = inset + thickness / 2;
  const corners = [[middle, middle], [width - middle, middle], [middle, height - middle], [width - middle, height - middle]]
    .flatMap(([x, y]) => rosetteLines(x, y, cornerRings, FRAME.cornerSteps));

  return `<svg class="frame" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" fill="none" stroke-width="1.4">${bands.join('')}${corners.join('')}</svg>`;
});

// ---- Microtext: a line of lettering about half a millimetre tall. It looks like a rule to the naked eye,
// can be read with a magnifier on the original and turns into a blur on a photocopy or a scan.
// It is an SVG because browsers refuse to render ordinary text this small.
const MICRO = { width: 3560, height: 16, fontSize: 12, approximateCharacterWidth: 8 }; // 20 units per millimetre

export function microtext(text) {
  const phrase = `${text.toUpperCase()}  ·  `;
  const repeated = phrase.repeat(Math.ceil(MICRO.width / (phrase.length * MICRO.approximateCharacterWidth)) + 1);
  return `<svg class="microtext" viewBox="0 0 ${MICRO.width} ${MICRO.height}" preserveAspectRatio="xMinYMid slice">
    <text x="0" y="${MICRO.fontSize}" font-size="${MICRO.fontSize}" font-family="Arial, Helvetica, sans-serif" font-weight="700"
          letter-spacing="1" style="fill:${TITLE_COLOR}">${esc(repeated)}</text></svg>`;
}
