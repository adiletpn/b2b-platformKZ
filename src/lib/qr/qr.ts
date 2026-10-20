/**
 * QR-код рисуется в SVG без внешних зависимостей, как штрихкод на ценнике
 * (`src/lib/stock/barcode.ts`). Нужен для ссылки на оплату (раздел 3.6 ТЗ)
 * и QR проверки на печатной форме (раздел 4.4 ТЗ).
 *
 * Байтовый режим, уровень коррекции M (15 % повреждений), версии 1–10:
 * до 213 байт — с запасом для ссылки на платёж или проверку документа.
 */

type Version = {
  /** Байт коррекции в каждом блоке. */
  ecPerBlock: number;
  /** Группы блоков: [число блоков, байт данных в блоке]. */
  groups: [number, number][];
  /** Центры выравнивающих узоров. */
  alignment: number[];
};

// Таблицы стандарта ISO/IEC 18004 для уровня M.
const VERSIONS: Version[] = [
  { ecPerBlock: 10, groups: [[1, 16]], alignment: [] },
  { ecPerBlock: 16, groups: [[1, 28]], alignment: [6, 18] },
  { ecPerBlock: 26, groups: [[1, 44]], alignment: [6, 22] },
  { ecPerBlock: 18, groups: [[2, 32]], alignment: [6, 26] },
  { ecPerBlock: 24, groups: [[2, 43]], alignment: [6, 30] },
  { ecPerBlock: 16, groups: [[4, 27]], alignment: [6, 34] },
  { ecPerBlock: 18, groups: [[4, 31]], alignment: [6, 22, 38] },
  {
    ecPerBlock: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
    alignment: [6, 24, 42],
  },
  {
    ecPerBlock: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
    alignment: [6, 26, 46],
  },
  {
    ecPerBlock: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
    alignment: [6, 28, 50],
  },
];

/** Биты уровня коррекции M в служебной информации. */
const EC_LEVEL_M = 0b00;

function dataCapacity(version: Version): number {
  return version.groups.reduce((sum, [blocks, size]) => sum + blocks * size, 0);
}

// ---------- Арифметика поля Галуа GF(256) для Рида — Соломона ----------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] = result[index]! ^ gfMultiply(coefficient, factor);
    });
  }
  return result;
}

// ---------- Кодовые слова ----------

function encodeData(bytes: Uint8Array, versionNumber: number, version: Version): number[] {
  const capacityBits = dataCapacity(version) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // байтовый режим
  push(bytes.length, versionNumber <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacityBits - bits.length)); // терминатор
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let pad = 0xec; codewords.length < capacityBits / 8; pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
}

/** Разбивка на блоки, коррекция ошибок и чередование байт. */
function interleave(data: number[], version: Version): number[] {
  const divisor = rsDivisor(version.ecPerBlock);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const [count, size] of version.groups) {
    for (let i = 0; i < count; i += 1) {
      const chunk = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ data: chunk, ec: rsRemainder(chunk, divisor) });
    }
  }

  const result: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.data.length) result.push(block.data[i]!);
  }
  for (let i = 0; i < version.ecPerBlock; i += 1) {
    for (const block of blocks) result.push(block.ec[i]!);
  }
  return result;
}

// ---------- Матрица ----------

class Matrix {
  readonly modules: boolean[][];
  readonly reserved: boolean[][];

  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  /** Служебный модуль: x — столбец, y — строка. */
  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y]![x] = dark;
    this.reserved[y]![x] = true;
  }
}

function drawFinder(matrix: Matrix, cx: number, cy: number) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= matrix.size || y >= matrix.size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      matrix.setFunction(x, y, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(matrix: Matrix, cx: number, cy: number) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      matrix.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawFormatBits(matrix: Matrix, mask: number) {
  const data = (EC_LEVEL_M << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (index: number) => ((bits >>> index) & 1) !== 0;
  const size = matrix.size;

  // Первая копия — вокруг левого верхнего искателя.
  for (let i = 0; i <= 5; i += 1) matrix.setFunction(8, i, bit(i));
  matrix.setFunction(8, 7, bit(6));
  matrix.setFunction(8, 8, bit(7));
  matrix.setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) matrix.setFunction(14 - i, 8, bit(i));

  // Вторая копия — у правого верхнего и левого нижнего искателей.
  for (let i = 0; i < 8; i += 1) matrix.setFunction(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) matrix.setFunction(8, size - 15 + i, bit(i));
  matrix.setFunction(8, size - 8, true); // всегда тёмный модуль
}

function drawVersionBits(matrix: Matrix, versionNumber: number) {
  if (versionNumber < 7) return;
  let remainder = versionNumber;
  for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  const bits = (versionNumber << 12) | remainder;
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = matrix.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    matrix.setFunction(a, b, dark);
    matrix.setFunction(b, a, dark);
  }
}

function drawFunctionPatterns(matrix: Matrix, versionNumber: number, version: Version) {
  const size = matrix.size;
  for (let i = 0; i < size; i += 1) {
    matrix.setFunction(6, i, i % 2 === 0);
    matrix.setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(matrix, 3, 3);
  drawFinder(matrix, size - 4, 3);
  drawFinder(matrix, 3, size - 4);

  const positions = version.alignment;
  const last = positions.length - 1;
  positions.forEach((x, i) => {
    positions.forEach((y, j) => {
      // Углы с искателями пропускаются.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      drawAlignment(matrix, x, y);
    });
  });

  drawFormatBits(matrix, 0); // резервирует место, настоящая маска ставится позже
  drawVersionBits(matrix, versionNumber);
}

function drawCodewords(matrix: Matrix, codewords: number[]) {
  const size = matrix.size;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // столбец таймингового узора пропускается
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (matrix.reserved[y]![x] || index >= codewords.length * 8) continue;
        matrix.modules[y]![x] = ((codewords[index >>> 3]! >>> (7 - (index & 7))) & 1) !== 0;
        index += 1;
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(matrix: Matrix, mask: number) {
  const test = MASKS[mask]!;
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.reserved[y]![x] && test(x, y)) matrix.modules[y]![x] = !matrix.modules[y]![x];
    }
  }
}

/** Штраф маски по четырём правилам стандарта: чем меньше, тем легче читать. */
function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i += 1) {
    lines.push(modules[i]!);
    lines.push(modules.map((row) => row[i]!));
  }

  const finderLike = [true, false, true, true, true, false, true];
  for (const line of lines) {
    // Правило 1: пять и более одинаковых подряд.
    let run = 1;
    for (let i = 1; i <= size; i += 1) {
      if (i < size && line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // Правило 3: узор, похожий на искатель, со светлой полосой в четыре модуля.
    for (let i = 0; i + 7 <= size; i += 1) {
      if (!finderLike.every((value, k) => line[i + k] === value)) continue;
      const lightBefore = i >= 4 && [1, 2, 3, 4].every((k) => !line[i - k]);
      const lightAfter = i + 11 <= size && [7, 8, 9, 10].every((k) => !line[i + k]);
      if (lightBefore || lightAfter) score += 40;
    }
  }

  // Правило 2: одноцветные квадраты 2 × 2.
  for (let y = 0; y + 1 < size; y += 1) {
    for (let x = 0; x + 1 < size; x += 1) {
      const color = modules[y]![x];
      if (
        modules[y]![x + 1] === color &&
        modules[y + 1]![x] === color &&
        modules[y + 1]![x + 1] === color
      ) {
        score += 3;
      }
    }
  }

  // Правило 4: баланс тёмных и светлых.
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/**
 * Матрица QR-кода для строки (UTF-8). `null` — строка длиннее, чем помещается в версию 10.
 * `mask` фиксирует маску (для сверки с эталоном), иначе выбирается лучшая.
 */
export function qrMatrix(text: string, { mask }: { mask?: number } = {}): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  const versionIndex = VERSIONS.findIndex(
    (version, index) =>
      4 + (index + 1 <= 9 ? 8 : 16) + bytes.length * 8 <= dataCapacity(version) * 8,
  );
  if (versionIndex < 0) return null;

  const versionNumber = versionIndex + 1;
  const version = VERSIONS[versionIndex]!;
  const codewords = interleave(encodeData(bytes, versionNumber, version), version);

  const base = new Matrix(versionNumber * 4 + 17);
  drawFunctionPatterns(base, versionNumber, version);
  drawCodewords(base, codewords);

  const candidates = mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];
  let best: { modules: boolean[][]; score: number } | null = null;
  for (const candidate of candidates) {
    const matrix = new Matrix(base.size);
    base.modules.forEach((row, y) => row.forEach((dark, x) => (matrix.modules[y]![x] = dark)));
    base.reserved.forEach((row, y) => row.forEach((flag, x) => (matrix.reserved[y]![x] = flag)));
    applyMask(matrix, candidate);
    drawFormatBits(matrix, candidate);
    const score = penalty(matrix.modules);
    if (!best || score < best.score) best = { modules: matrix.modules, score };
  }
  return best!.modules;
}

/** Контур тёмных модулей для `<path d>`: один путь вместо сотен прямоугольников. */
export function qrPath(modules: boolean[][], margin = 4): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + margin} ${y + margin}h1v1h-1z`);
    });
  });
  return parts.join('');
}

/** SVG QR-кода для печатных форм. Пустая строка — текст не поместился. */
export function qrSvg(text: string, { size = 120, margin = 4 } = {}): string {
  const modules = qrMatrix(text);
  if (!modules) return '';
  const side = modules.length + margin * 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`,
    ` viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">`,
    `<rect width="${side}" height="${side}" fill="#fff"/>`,
    `<path fill="#000" d="${qrPath(modules, margin)}"/>`,
    '</svg>',
  ].join('');
}
