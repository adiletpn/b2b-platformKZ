/**
 * Штрихкод EAN-13 рисуется в SVG без внешних зависимостей: ценник печатается
 * через тот же HTML→PDF, что и остальные документы (раздел 4.1 ТЗ).
 */
const LEFT_ODD = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const LEFT_EVEN = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const RIGHT = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
/** Чётность левой половины задаётся первой цифрой. */
const PARITY = [
  'OOOOOO',
  'OOEOEE',
  'OOEEOE',
  'OOEEEO',
  'OEOOEE',
  'OEEOOE',
  'OEEEOO',
  'OEOEOE',
  'OEOEEO',
  'OEEOEO',
];

/** Последовательность модулей EAN-13: 95 штрихов и пробелов. */
export function ean13Modules(barcode: string): string | null {
  if (!/^\d{13}$/.test(barcode)) return null;
  const digits = barcode.split('').map(Number);

  const checksum =
    (10 -
      (digits
        .slice(0, 12)
        .reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 3), 0) %
        10)) %
    10;
  if (checksum !== digits[12]) return null;

  const parity = PARITY[digits[0]!]!;
  let modules = '101';
  for (let index = 1; index <= 6; index += 1) {
    const digit = digits[index]!;
    modules += parity[index - 1] === 'O' ? LEFT_ODD[digit]! : LEFT_EVEN[digit]!;
  }
  modules += '01010';
  for (let index = 7; index <= 12; index += 1) modules += RIGHT[digits[index]!]!;
  return `${modules}101`;
}

/** SVG штрихкода: ширина модуля и высота подобраны под ценник 60 × 40 мм. */
export function barcodeSvg(barcode: string, { width = 1.4, height = 40 } = {}): string {
  const modules = ean13Modules(barcode);
  if (!modules) return '';

  const bars: string[] = [];
  modules.split('').forEach((module, index) => {
    if (module !== '1') return;
    bars.push(
      `<rect x="${(index * width).toFixed(2)}" y="0" width="${width}" height="${height}"/>`,
    );
  });

  const totalWidth = (modules.length * width).toFixed(2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height + 12}"`,
    ` viewBox="0 0 ${totalWidth} ${height + 12}">`,
    `<g fill="#000">${bars.join('')}</g>`,
    `<text x="${Number(totalWidth) / 2}" y="${height + 10}" font-family="monospace"`,
    ` font-size="10" text-anchor="middle">${barcode}</text>`,
    '</svg>',
  ].join('');
}
