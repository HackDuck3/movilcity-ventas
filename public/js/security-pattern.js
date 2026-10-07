// Security graphics for printed documents, drawn from the document's verification code.
// The same code always gives the same drawing and a different code a different one, so a forged
// document cannot show the pattern that belongs to its code. Colours come from the --doc-* CSS variables.
import { esc } from './core.js';

const TAU = Math.PI * 2;

// Deterministic random numbers (mulberry32) seeded from a string.
function seededRandom(seed) {
  let state = 0;
  for (const character of seed) state = (Math.imul(state, 31) + character.charCodeAt(0)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// The invoice editor redraws its preview on every keystroke; drawings are kept so they are computed once per code.
const drawings = new Map();
function remembered(key, draw) {
  if (!drawings.has(key)) drawings.set(key, draw());
  return drawings.get(key);
}

const polyline = (points, color) => `<polyline points="${points.join(' ')}" style="stroke:${color}"/>`;

// ---- Guilloche band: interwoven waves, as on banknotes and certificates
const BAND = { width: 1780, height: 90, margin: 4, step: 7 }; // 10 units per millimetre

export const guillocheBand = (code) => remembered(`band:${code}`, () => drawBand(code));

function drawBand(code) {
  const random = seededRandom(`band:${code}`);
  const between = (min, max) => min + random() * (max - min);
  // Each family is a set of identical waves shifted in phase, squeezed by a slower envelope wave.
  const families = [
    { color: 'var(--doc-title)', lines: 9, waves: between(7, 12), envelope: between(1.5, 3.5), shift: between(0, TAU) },
    { color: 'var(--doc-accent)', lines: 7, waves: between(4, 8), envelope: between(2.5, 5), shift: between(0, TAU) },
  ];
  const amplitude = BAND.height / 2 - BAND.margin;

  const lines = families.flatMap(family => Array.from({ length: family.lines }, (_, index) => {
    const phase = (index / family.lines) * TAU;
    const points = [];
    for (let x = 0; x <= BAND.width; x += BAND.step) {
      const progress = x / BAND.width;
      const wave = Math.sin(TAU * family.waves * progress + phase);
      const envelope = Math.cos(TAU * family.envelope * progress + family.shift);
      points.push(`${x},${(BAND.height / 2 + amplitude * wave * envelope).toFixed(1)}`);
    }
    return polyline(points, family.color);
  }));

  return `<svg class="guilloche" viewBox="0 0 ${BAND.width} ${BAND.height}" preserveAspectRatio="none" fill="none" stroke-width="1.5">${lines.join('')}</svg>`;
}

// ---- Rosette seal: rings of petal-shaped curves
const SEAL = { size: 200, steps: 360 };

export const rosetteSeal = (code) => remembered(`seal:${code}`, () => drawSeal(code));

function drawSeal(code) {
  const random = seededRandom(`seal:${code}`);
  const between = (min, max) => min + random() * (max - min);
  const wholeBetween = (min, max) => Math.floor(between(min, max + 1));
  const rings = [
    { color: 'var(--doc-title)', radius: 96, petals: wholeBetween(11, 19), depth: between(0.14, 0.22), curves: 6 },
    { color: 'var(--doc-accent)', radius: 66, petals: wholeBetween(6, 10), depth: between(0.22, 0.32), curves: 5 },
    { color: 'var(--doc-title)', radius: 34, petals: wholeBetween(4, 7), depth: between(0.3, 0.42), curves: 4 },
  ];
  const center = SEAL.size / 2;

  const curves = rings.flatMap(ring => Array.from({ length: ring.curves }, (_, index) => {
    const phase = (index / ring.curves) * TAU;
    const points = [];
    for (let step = 0; step <= SEAL.steps; step++) {
      const angle = (step / SEAL.steps) * TAU;
      const radius = ring.radius * (1 - ring.depth + ring.depth * Math.sin(ring.petals * angle + phase));
      points.push(`${(center + radius * Math.cos(angle)).toFixed(1)},${(center + radius * Math.sin(angle)).toFixed(1)}`);
    }
    return polyline(points, ring.color);
  }));

  return `<svg class="seal" viewBox="0 0 ${SEAL.size} ${SEAL.size}" fill="none" stroke-width="0.9">${curves.join('')}</svg>`;
}

// ---- Microtext: a line of lettering about half a millimetre tall. It reads as a rule to the naked eye,
// can be read with a magnifier on the original and turns into a blur on a photocopy or a scan.
// It is an SVG because browsers refuse to render ordinary text this small.
const MICRO = { width: 3560, height: 16, fontSize: 12, approximateCharacterWidth: 8 }; // 20 units per millimetre

export function microtext(text) {
  const phrase = `${text.toUpperCase()}  ·  `;
  const repeated = phrase.repeat(Math.ceil(MICRO.width / (phrase.length * MICRO.approximateCharacterWidth)) + 1);
  return `<svg class="microtext" viewBox="0 0 ${MICRO.width} ${MICRO.height}" preserveAspectRatio="xMinYMid slice">
    <text x="0" y="${MICRO.fontSize}" font-size="${MICRO.fontSize}" font-family="Arial, Helvetica, sans-serif" font-weight="700"
          letter-spacing="1" style="fill:var(--doc-title)">${esc(repeated)}</text></svg>`;
}
