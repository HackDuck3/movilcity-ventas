// Minimal QR code generator (byte mode, error correction level M, versions 1-10: up to 213 bytes).
// Enough for a URL. Written in-house so tickets can carry a QR code without any dependency.

// Per version: [error-correction codewords per block, [blocks, data codewords per block], ...]
const BLOCKS = [
  null,
  [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
  [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]],
];
const ALIGNMENT_CENTERS = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MAX_VERSION = 10;
const QUIET_ZONE = 4;

const MASKS = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

// ---- Reed-Solomon error correction over GF(256)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let power = 0, value = 1; power < 255; power++) {
  EXP[power] = EXP[power + 255] = value;
  LOG[value] = power;
  value = (value << 1) ^ (value & 0x80 ? 0x11d : 0);
}
const multiply = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generatorPolynomial(degree) {
  let polynomial = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(polynomial.length + 1).fill(0);
    polynomial.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= multiply(coefficient, EXP[i]);
    });
    polynomial = next;
  }
  return polynomial;
}

function errorCorrection(data, length) {
  const generator = generatorPolynomial(length);
  const remainder = new Array(length).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    for (let i = 0; i < length; i++) remainder[i] ^= multiply(generator[i + 1], factor);
  }
  return remainder;
}

// ---- Data encoding
const dataCapacity = (version) => BLOCKS[version].slice(1).reduce((sum, [count, size]) => sum + count * size, 0);

function chooseVersion(byteCount) {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const headerBits = 4 + (version < 10 ? 8 : 16);
    if (headerBits + byteCount * 8 <= dataCapacity(version) * 8) return version;
  }
  throw new Error('El texto es demasiado largo para el código QR');
}

function dataCodewords(bytes, version) {
  const capacity = dataCapacity(version);
  const bits = [];
  const push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach(byte => push(byte, 8));
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; codewords.length < capacity; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

// Splits the data into blocks, adds error correction to each and interleaves them.
function finalCodewords(data, version) {
  const [ecLength, ...groups] = BLOCKS[version];
  const dataBlocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      dataBlocks.push(data.slice(offset, offset + size));
      offset += size;
    }
  }
  const ecBlocks = dataBlocks.map(block => errorCorrection(block, ecLength));
  const interleave = (blocks) => {
    const result = [];
    const longest = Math.max(...blocks.map(block => block.length));
    for (let i = 0; i < longest; i++) {
      for (const block of blocks) if (i < block.length) result.push(block[i]);
    }
    return result;
  };
  return [...interleave(dataBlocks), ...interleave(ecBlocks)];
}

// ---- Matrix
// Returns { modules, reserved }: reserved marks function patterns that data and masks must not touch.
function emptyMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (row, col, dark) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    modules[row][col] = dark;
    reserved[row][col] = true;
  };

  const finder = (top, left) => {
    for (let row = -1; row <= 7; row++) {
      for (let col = -1; col <= 7; col++) {
        const ring = Math.max(Math.abs(row - 3), Math.abs(col - 3));
        set(top + row, left + col, ring !== 2 && ring !== 4);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  const centers = ALIGNMENT_CENTERS[version];
  const last = centers[centers.length - 1];
  const overlapsFinder = (row, col) => (row === 6 && col === 6) || (row === 6 && col === last) || (row === last && col === 6);
  for (const row of centers) {
    for (const col of centers) {
      if (overlapsFinder(row, col)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) set(row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }

  // Format and version areas are reserved now and filled in once the mask is known.
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) set(8, i, false);
    if (!reserved[i][8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false);
    set(size - 1 - i, 8, false);
  }
  set(size - 8, 8, true);
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      set(size - 11 + (i % 3), Math.floor(i / 3), false);
      set(Math.floor(i / 3), size - 11 + (i % 3), false);
    }
  }
  return { modules, reserved, size };
}

// Data bits zigzag upwards and downwards in two-column strips, starting bottom-right.
function placeData(matrix, codewords) {
  const { modules, reserved, size } = matrix;
  const bits = codewords.flatMap(byte => [7, 6, 5, 4, 3, 2, 1, 0].map(shift => (byte >> shift) & 1));
  let index = 0;
  let upwards = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern takes a whole column
    for (let step = 0; step < size; step++) {
      const row = upwards ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        modules[row][col] = bits[index++] === 1;
      }
    }
    upwards = !upwards;
  }
}

// Remainder of a BCH code, used by the format and version information.
function bchRemainder(value, generator, generatorBits, dataShift) {
  let remainder = value << dataShift;
  for (let bit = generatorBits + dataShift - 1; bit >= dataShift; bit--) {
    if ((remainder >> bit) & 1) remainder ^= generator << (bit - dataShift);
  }
  return remainder;
}

function writeFormatAndVersion(modules, size, version, mask) {
  // Level M is 00, followed by the 3-bit mask number.
  const format = ((mask << 10) | bchRemainder(mask, 0x537, 5, 10)) ^ 0x5412;
  const bit = (index) => ((format >> index) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) modules[8][14 - i] = bit(i);
  for (let i = 0; i <= 7; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) modules[size - 15 + i][8] = bit(i);

  if (version < 7) return;
  const versionBits = (version << 12) | bchRemainder(version, 0x1f25, 6, 12);
  for (let i = 0; i < 18; i++) {
    const dark = ((versionBits >> i) & 1) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    modules[a][b] = dark;
    modules[b][a] = dark;
  }
}

// Lower is better: penalises long runs, 2x2 blocks and an uneven dark/light balance.
function penalty(modules, size) {
  let score = 0;
  const runPenalty = (cellAt) => {
    for (let line = 0; line < size; line++) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && cellAt(line, i) === cellAt(line, i - 1)) {
          run++;
          continue;
        }
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
  };
  runPenalty((row, col) => modules[row][col]);
  runPenalty((col, row) => modules[row][col]);

  let dark = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (modules[row][col]) dark++;
      if (row + 1 < size && col + 1 < size) {
        const cell = modules[row][col];
        if (cell === modules[row][col + 1] && cell === modules[row + 1][col] && cell === modules[row + 1][col + 1]) score += 3;
      }
    }
  }
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

// Returns the QR code as rows of booleans (true = dark module).
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const version = chooseVersion(bytes.length);
  const base = emptyMatrix(version);
  placeData(base, finalCodewords(dataCodewords(bytes, version), version));

  let best = null;
  MASKS.forEach((isMasked, mask) => {
    const modules = base.modules.map((row, rowIndex) =>
      row.map((dark, colIndex) => (base.reserved[rowIndex][colIndex] ? dark : dark !== isMasked(rowIndex, colIndex))));
    writeFormatAndVersion(modules, base.size, version, mask);
    const score = penalty(modules, base.size);
    if (!best || score < best.score) best = { modules, score };
  });
  return best.modules;
}

export function qrSvg(text, sizeMm = 28) {
  const modules = qrMatrix(text);
  const total = modules.length + QUIET_ZONE * 2;
  const squares = [];
  modules.forEach((row, rowIndex) => row.forEach((dark, colIndex) => {
    if (dark) squares.push(`M${colIndex + QUIET_ZONE},${rowIndex + QUIET_ZONE}h1v1h-1z`);
  }));
  return `<svg class="qr" viewBox="0 0 ${total} ${total}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges">
    <rect width="${total}" height="${total}" fill="#fff"/><path d="${squares.join('')}" fill="#000"/></svg>`;
}
