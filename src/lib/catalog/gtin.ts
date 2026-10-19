/** Контрольная цифра GTIN (EAN-8, EAN-13, GTIN-12/14): раздел 3.2 ТЗ. */
const ALLOWED_LENGTHS = [8, 12, 13, 14];

export function isValidGtin(value: string): boolean {
  if (!/^\d+$/.test(value) || !ALLOWED_LENGTHS.includes(value.length)) return false;

  const digits = [...value].map(Number);
  const check = digits.pop()!;
  // Веса 3 и 1 чередуются справа налево.
  const sum = digits
    .reverse()
    .reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10 === check;
}
